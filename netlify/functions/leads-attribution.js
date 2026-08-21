// leads-attribution.js
// Owner-only feed for the portal's Leads page. Joins two sources:
//   GA4      - where traffic comes from and what it does on the site
//   Airtable - what happened after the call (consulted, signed, close rate)
//
// GA4 auth is a hand-rolled service-account JWT so this function needs no npm
// dependencies. Node's crypto does the RS256 signing.

const {
  ga4Token, runReport, dateRange, eventFilter, normalizePrivateKey,
} = require("../shared/ga4");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Fidel only. The nav hides this page from Koko; this is the matching
// server-side check so hiding the link is not the only thing protecting it.
const OWNERS = ["fidelhon@gmail.com"];

const CONVERSION_EVENTS = ["generate_lead", "discovery_form_submit", "invitee_meeting_scheduled"];

/* ----------------------------------------------------------- Airtable --- */

async function fetchAll(baseId, tableId, token) {
  const records = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?pageSize=100` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) throw new Error("Airtable: " + (data.error.message || data.error));
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

// The five options on the Airtable Lead Source dropdown. Every historical
// free-text value is folded into one of these so old and new records can be
// compared. Records with no source at all are dropped from the breakdown
// entirely: they are pre-dropdown history, not a channel worth a row.
const LEAD_SOURCES = ["LinkedIn", "Instagram", "Referral", "SEO", "Others"];

function bucketSource(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "Unattributed";
  if (s.includes("linkedin")) return "LinkedIn";
  if (s.includes("insta") || s === "ig") return "Instagram";
  if (s.includes("refer") || s.includes("friend") || s.includes("recommend")) return "Referral";
  if (s.includes("seo") || s.includes("google") || s.includes("search") || s.includes("bing")) return "SEO";
  return "Others";
}

/**
 * One canonical channel name from whatever the source string happens to be.
 *
 * Applied to BOTH first-touch and session data, and applied at report time
 * rather than only at capture, so rows recorded before the tracker learned an
 * alias still merge correctly instead of sitting as a separate line forever.
 */
function canonicalChannel(raw) {
  const s = String(raw || "").trim().toLowerCase();

  if (!s || s === "(not set)" || s === "(unknown)" || s === "(direct)") {
    return s === "(direct)" ? "direct" : "not tagged";
  }
  // com.linkedin.android is the LinkedIn phone app; lnkd.in is their shortener.
  if (s.includes("linkedin") || s.includes("lnkd")) return "linkedin";
  if (s === "ig" || s.includes("instagram")) return "instagram";
  if (s.includes("facebook")) return "facebook";
  if (s.includes("tiktok")) return "tiktok";
  if (s.includes("whatsapp")) return "whatsapp";
  // sendibm*.sendinblue/brevo tracking domains, e.g. nqpeh.r.ag.d.sendibm3.com
  if (s.includes("brevo") || s.includes("sendib") || s.includes("sendinblue")) return "brevo";
  if (s.includes("chatgpt") || s.includes("openai")) return "chatgpt";
  if (s.includes("perplexity")) return "perplexity";
  if (s.includes("gemini")) return "gemini";
  if (s.includes("copilot")) return "copilot";
  if (s.includes("claude")) return "claude";
  if (s.includes("google")) return "google";
  if (s.includes("bing")) return "bing";
  if (s.includes("duckduckgo")) return "duckduckgo";
  if (s === "lead_magnet") return "lead magnet";
  if (s === "direct") return "direct";
  // Mid-flow redirects: someone bounced through Stripe or an auth screen and
  // came back. That is your own funnel, not an acquisition source.
  if (s.includes("stripe.com") || s.includes("accounts.google") ||
      s.includes("calendly.com") || s.includes("netlify.app")) return "direct";
  // Job boards are outbound destinations from the job alerts page. A referral
  // FROM one means someone clicked a listing and came back, so it is a return
  // visit rather than a channel. LinkedIn stays a real channel: the Alex
  // account posts legitimately drive to the job alerts page.
  // GA4 tidies known referrers to a plain name, so this arrives as "seek" or
  // "Seek" rather than "au.seek.com". Match both the name and the domain.
  const JOB_BOARDS = ["seek", "indeed", "jora", "glassdoor", "adzuna",
                      "gradconnection", "prosple", "grad connection"];
  if (JOB_BOARDS.some((b) => s === b || s.includes(b + ".com") || s.includes(b + ".com.au"))) {
    return "direct";
  }
  return s;
}

/**
 * GA4's own sessionSource is fragmented: LinkedIn arrives as "linkedin.com",
 * "LinkedIn" and "lnkd.in"; Instagram as "ig", "instagram.com",
 * "l.instagram.com" and "instagram_bio". Collapse them so the historical view
 * uses the same channel names as the first-touch view.
 */
function normaliseSessionSource(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s === "(direct)" || s === "(none)") return "direct";
  if (s.includes("linkedin") || s.includes("lnkd")) return "linkedin";
  if (s === "ig" || s.includes("instagram")) return "instagram";
  if (s.includes("facebook")) return "facebook";
  if (s.includes("google")) return "google";
  if (s.includes("bing")) return "bing";
  if (s.includes("chatgpt") || s.includes("openai")) return "chatgpt";
  if (s.includes("perplexity")) return "perplexity";
  if (s.includes("brevo") || s.includes("sendib")) return "brevo";
  return s;
}

const truthy = (v) => v === 1 || v === true || v === "Yes" || v === "yes";

// Platform reach, imported from the LinkedIn export by
// Operations/analytics/import-channel-stats.py. LinkedIn has no API for a
// personal profile, so this is the only way to get impressions.
function instagramPosts() {
  try { return require("../data/instagram-posts.json").posts || {}; }
  catch (e) { return {}; }
}

/**
 * Best posts in the window, both platforms side by side.
 *
 * Archived locally rather than fetched live: the Instagram API only serves a
 * rolling window, so anything not captured before it rolls past is gone.
 */
function topPosts(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const ig = Object.values(instagramPosts())
    .filter((p) => p.date && p.date >= since)
    .sort((a, b) => (b.reach || 0) - (a.reach || 0))
    .slice(0, 5)
    .map((p) => ({
      channel: "instagram", date: p.date, permalink: p.permalink,
      title: p.caption || "(no caption)", type: p.type,
      reach: p.reach || 0, engagements: p.total_interactions || 0,
      profileVisits: p.profile_visits || 0, saves: p.saved || 0, shares: p.shares || 0,
    }));

  const stats = channelStats();
  const li = Object.values(stats.posts_linkedin || {})
    .filter((p) => p.date && p.date >= since)
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, 5)
    .map((p) => ({
      channel: "linkedin", date: p.date, permalink: p.permalink,
      title: p.title || `LinkedIn post ${p.date}`,
      approx: Boolean(p.title_approx), type: "POST",
      reach: p.impressions || 0, engagements: p.engagements || 0,
      profileVisits: null, saves: null, shares: null,
    }));

  // Kept apart rather than merged: Instagram out-reaches LinkedIn several
  // times over, so one combined list would be almost all Instagram and hide
  // the best LinkedIn post entirely.
  return { instagram: ig, linkedin: li };
}

function channelStats() {
  try {
    return require("../data/channel-stats.json");
  } catch (e) {
    return { linkedin: {}, instagram: {}, updated: null };
  }
}

/**
 * How much of a channel GA4 actually catches, graded against Fidel's own
 * labelling in Airtable.
 *
 * Airtable is the better source for WHERE a lead came from, because he asks
 * them. GA4 has to infer it, and loses LinkedIn whenever the in-app browser
 * strips the referrer or the link was posted untagged.
 *
 * This never rewrites GA4's numbers. It publishes the gap so a low number can
 * be read as "GA4 is undercounting this" rather than "this channel is weak".
 */
function confidence(channels, salesBySource) {
  const labelled = {};
  (salesBySource || []).forEach((s) => {
    labelled[s.source.toLowerCase()] = s.booked || 0;
  });
  return channels.map((c) => {
    const theirs = labelled[c.source];
    // Bookings against bookings. Below 3 the ratio swings on one record, so
    // it is left blank rather than shown as a precise-looking number.
    if (!theirs || theirs < 3) return { ...c, confidence: null, labelledBookings: theirs || 0 };
    return {
      ...c,
      labelledBookings: theirs,
      confidence: Math.min(1, (c.booked || 0) / theirs),
    };
  });
}

/* ------------------------------------------------------------ handler --- */

/**
 * Pull everything for a window. `offset` shifts the window back, so
 * gather(7) is the last 7 days and gather(7, 7) is the 7 days before that.
 * Both the portal page and the Monday email call this, so they can never
 * show different numbers.
 */
async function gather(days, offset = 0) {
  const {
    GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY,
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
  } = process.env;

  const out = { days, generatedAt: new Date().toISOString(), errors: [] };

  /* ---- GA4 side ---- */
  try {
    if (!GA4_PROPERTY_ID || !GA4_CLIENT_EMAIL || !GA4_PRIVATE_KEY) {
      throw new Error("GA4 environment variables are not set in Netlify");
    }
    const token = await ga4Token(GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY);
    const P = GA4_PROPERTY_ID;

    const [visitors, conversions, campaigns, weekly, linkUrlRows, ratioRows, sessionRows, sessionWeekly, linkClicks] = await Promise.all([
      // People arriving, by original source
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "customEvent:first_source" }, { name: "customEvent:first_medium" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 1000,
      }),
      // Conversions, by source and by which of the three things they signed up for
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [
          { name: "customEvent:first_source" },
          { name: "eventName" },
          { name: "customEvent:signup_type" },
        ],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(CONVERSION_EVENTS),
        limit: 2000,
      }),
      // Per-post performance
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "customEvent:first_campaign" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view", ...CONVERSION_EVENTS]),
        limit: 2000,
      }),
      // Weekly trend by source
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "week" }, { name: "customEvent:first_source" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 2000,
      }),
      // link_id only exists from 14 Aug, but GA4's built-in linkUrl has always
      // recorded the destination, which identifies the option just as well.
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "linkUrl" }, { name: "customEvent:first_source" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["link_click"]),
        limit: 1000,
      }),
      // Events vs people, so the audit can spot anything firing repeatedly
      // for the same person.
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
        dimensionFilter: eventFilter(CONVERSION_EVENTS),
        limit: 20,
      }),
      // GA4's own session attribution. Rougher than first-touch, but it goes
      // back a year, so the page has something to show before the new
      // dimensions have accumulated.
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "sessionSource" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view", ...CONVERSION_EVENTS]),
        limit: 600,
      }),
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "week" }, { name: "sessionSource" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 2000,
      }),
      // The /links page: which of the three options people choose, and who
      // sent them. This is the Instagram bio-link question.
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "customEvent:link_id" }, { name: "customEvent:first_source" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["link_click"]),
        limit: 1000,
      }),
    ]);

    const channels = {};
    const chan = (k) => (channels[k] = channels[k] || {
      source: k, medium: "", mediums: {}, visitors: 0,
      signups: { job_alerts: 0, audit_roadmap: 0, discovery_call: 0 },
      callForms: 0, booked: 0,
    });

    visitors.forEach(({ dims, mets }) => {
      const c = chan(canonicalChannel(dims[0]));
      c.visitors += mets[0];
      const med = dims[1] && dims[1] !== "(not set)" ? dims[1] : "";
      if (med) c.mediums[med] = (c.mediums[med] || 0) + mets[0];
    });

    // Show the mediums that actually carried traffic, biggest first.
    Object.values(channels).forEach((c) => {
      c.medium = Object.entries(c.mediums)
        .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => m).join(", ");
    });

    conversions.forEach(({ dims, mets }) => {
      const [src, evName, signupType] = dims;
      const c = chan(canonicalChannel(src));
      if (evName === "discovery_form_submit") c.callForms += mets[0];
      if (evName === "invitee_meeting_scheduled") c.booked += mets[0];
      if (Object.prototype.hasOwnProperty.call(c.signups, signupType)) {
        c.signups[signupType] += mets[0];
      }
    });

    out.eventRatios = ratioRows.map(({ dims, mets }) => ({
      event: dims[0], events: mets[0], people: mets[1],
    }));

    out.leadsTotal = conversions
      .filter(({ dims }) => dims[1] === "generate_lead")
      .reduce((sum, { mets }) => sum + mets[0], 0);

    // Fill the gap using GA4's own session attribution.
    //
    // Deliberately NOT done by querying "first_source = (not set)": GA4 limits
    // how far back any query touching a custom dimension can see, so that
    // approach silently returns the same rows for 90 days and a year. Working
    // from the difference between the session totals and the first-touch
    // totals avoids the custom dimension entirely and stays correct at any range.
    const sessionTotals = {};
    sessionRows.forEach(({ dims, mets }) => {
      const [rawSrc, evName] = dims;
      const key = canonicalChannel(rawSrc);
      const s = (sessionTotals[key] = sessionTotals[key] || {
        visitors: 0, booked: 0, callForms: 0, leads: 0,
      });
      if (evName === "page_view") s.visitors += mets[0];
      if (evName === "invitee_meeting_scheduled") s.booked += mets[0];
      if (evName === "discovery_form_submit") s.callForms += mets[0];
      if (evName === "generate_lead") s.leads += mets[0];
    });

    delete channels["not tagged"];
    let recovered = 0;
    Object.entries(sessionTotals).forEach(([key, s]) => {
      if (key === "not tagged") return;
      const c = chan(key);
      // Only the part session data can see that first-touch cannot.
      const extraVisitors = Math.max(0, s.visitors - c.visitors);
      const extraBooked = Math.max(0, s.booked - c.booked);
      const extraForms = Math.max(0, s.callForms - c.callForms);
      if (extraVisitors) {
        c.backfilled = (c.backfilled || 0) + extraVisitors;
        c.visitors += extraVisitors;
        recovered += extraVisitors;
      }
      c.booked += extraBooked;
      c.callForms += extraForms;
    });
    out.recoveredFromSession = recovered;
    out.stillUnknown = (sessionTotals["not tagged"] || {}).visitors || 0;

    out.channels = Object.values(channels)
      .filter((c) => c.visitors || c.booked || c.callForms)
      .map(({ mediums, ...c }) => c)
      .sort((a, b) => b.visitors - a.visitors);

    const camp = {};
    campaigns.forEach(({ dims, mets }) => {
      const [name, evName] = dims;
      if (!name || name === "none" || name === "(not set)") return;
      const c = (camp[name] = camp[name] || { campaign: name, visitors: 0, conversions: 0 });
      if (evName === "page_view") c.visitors += mets[0];
      else c.conversions += mets[0];
    });
    out.campaigns = Object.values(camp).sort((a, b) => b.visitors - a.visitors).slice(0, 25);

    // Which of the three /links options gets picked, split by who sent them.
    const LINK_LABELS = {
      offer_roadmap: "Offer roadmap",
      mentoring_landing: "Mentoring (main site)",
      job_alerts: "Job alerts",
    };
    // Seed all three so an option nobody picked shows as 0 rather than
    // vanishing, which would read as "there are only two options".
    const links = {};
    Object.entries(LINK_LABELS).forEach(([id, label]) => {
      links[id] = { linkId: id, label, total: 0, bySource: {} };
    });
    // Destination URL -> which of the three options it is. Lets clicks from
    // before link_id existed be counted instead of discarded.
    const urlToOption = (url) => {
      const u = String(url || "").toLowerCase();
      if (u.includes("job-search-audit")) return "offer_roadmap";
      if (u.includes("job-alerts")) return "job_alerts";       // incl. -signup
      if (/theheadstartmentoring\.com\/?$/.test(u.replace(/[?#].*$/, ""))) return "mentoring_landing";
      return null;
    };
    linkUrlRows.forEach(({ dims, mets }) => {
      const opt = urlToOption(dims[0]);
      if (!opt) return;
      const l = links[opt];
      l.recovered = (l.recovered || 0) + mets[0];
      l.total += mets[0];
      const s = canonicalChannel(dims[1]);
      l.bySource[s] = (l.bySource[s] || 0) + mets[0];
    });

    linkClicks.forEach(({ dims, mets }) => {
      const [linkId] = dims;
      if (!linkId || linkId === "(not set)") return;
      const l = (links[linkId] = links[linkId] || {
        linkId, label: LINK_LABELS[linkId] || linkId, total: 0, bySource: {},
      });
      // linkUrl already counted every click, including these, so only record
      // the medium detail here rather than adding to the total again.
      l.hasLinkId = true;
    });
    out.linksPage = Object.values(links).sort((a, b) => b.total - a.total);

    // Same shape as out.channels, so the page can swap between them.
    const sess = {};
    sessionRows.forEach(({ dims, mets }) => {
      const [rawSrc, evName] = dims;
      const key = canonicalChannel(rawSrc);
      const c = (sess[key] = sess[key] || {
        source: key, medium: "", visitors: 0,
        signups: { job_alerts: 0, audit_roadmap: 0, discovery_call: 0 },
        callForms: 0, booked: 0,
      });
      if (evName === "page_view") c.visitors += mets[0];
      if (evName === "discovery_form_submit") { c.callForms += mets[0]; c.signups.discovery_call += mets[0]; }
      if (evName === "invitee_meeting_scheduled") c.booked += mets[0];
      if (evName === "generate_lead") c.signups.job_alerts += mets[0];
    });
    out.channelsSession = Object.values(sess)
      .filter((c) => c.visitors || c.booked)
      .sort((a, b) => b.visitors - a.visitors);

    const swk = {};
    sessionWeekly.forEach(({ dims, mets }) => {
      const [week, rawSrc] = dims;
      const key = canonicalChannel(rawSrc);
      swk[week] = swk[week] || { week, sources: {} };
      swk[week].sources[key] = (swk[week].sources[key] || 0) + mets[0];
    });
    out.weeklySession = Object.values(swk).sort((a, b) => a.week.localeCompare(b.week));

    // Reach -> visits, per week. The impressions come from the platform
    // export; the visits from GA4. Click rate is the honest measure of
    // whether content moved anyone, separate from how many saw it.
    const stats = channelStats();
    out.statsUpdated = stats.updated || null;
    out.topPosts = topPosts(days);
    const byMonday = {};
    sessionWeekly.forEach(({ dims, mets }) => {
      const [week, rawSrc] = dims;
      const key = canonicalChannel(rawSrc);
      if (key !== "linkedin" && key !== "instagram") return;
      byMonday[week] = byMonday[week] || {};
      byMonday[week][key] = (byMonday[week][key] || 0) + mets[0];
    });
    // GA4 "week" is an ISO week number; convert to the Monday date so it can
    // join to the export, which is keyed by date.
    const yr = new Date().getUTCFullYear();
    const mondayOfIsoWeek = (w) => {
      const simple = new Date(Date.UTC(yr, 0, 1 + (Number(w) - 1) * 7));
      const dow = simple.getUTCDay() || 7;
      simple.setUTCDate(simple.getUTCDate() - dow + 1);
      return simple.toISOString().slice(0, 10);
    };
    out.reach = Object.entries(byMonday).map(([w, visitsByCh]) => {
      const monday = mondayOfIsoWeek(w);
      const row = { week: w, monday, channels: {} };
      ["linkedin", "instagram"].forEach((ch) => {
        const s = (stats[ch] || {})[monday];
        const visits = visitsByCh[ch] || 0;
        row.channels[ch] = {
          impressions: s ? s.impressions : null,
          engagements: s ? s.engagements : null,
          partial: s ? Boolean(s.partial) : false,
          visits,
          ctr: s && s.impressions ? visits / s.impressions : null,
        };
      });
      return row;
    }).sort((a, b) => a.monday.localeCompare(b.monday));

    const wk = {};
    weekly.forEach(({ dims, mets }) => {
      const [week, src] = dims;
      const key = canonicalChannel(src);
      wk[week] = wk[week] || { week, sources: {} };
      wk[week].sources[key] = (wk[week].sources[key] || 0) + mets[0];
    });
    out.weekly = Object.values(wk).sort((a, b) => a.week.localeCompare(b.week));
  } catch (err) {
    out.errors.push("GA4: " + err.message);
    out.channels = [];
    out.campaigns = [];
    out.weekly = [];
    out.linksPage = [];
    out.channelsSession = [];
    out.weeklySession = [];
  }

  /* ---- Airtable side: what happened after the call ---- */
  try {
    const recs = await fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_API_TOKEN);
    const until = new Date(Date.now() - offset * 86400000);
    const since = new Date(Date.now() - (days + offset) * 86400000);

    const bySource = {};
    let totals = { leads: 0, consulted: 0, signed: 0 };

    recs.forEach((r) => {
      const f = r.fields || {};
      // Date the call happened; fall back to record creation for pure leads.
      const when = new Date(f["Meeting Time"] || f["Created"] || 0);
      if (!when || isNaN(when) || when < since || when > until) return;

      const key = bucketSource(f["Lead Source"]);
      const b = (bySource[key] = bySource[key] || { source: key, leads: 0, booked: 0, consulted: 0, signed: 0 });

      b.leads++; totals.leads++;
      if (f["Meeting Time"]) { b.booked = (b.booked || 0) + 1; totals.booked = (totals.booked || 0) + 1; }
      if (truthy(f["Did Consultation?"]) || f["Showed Up Rate"] === 1) { b.consulted++; totals.consulted++; }
      if (truthy(f["Signed"])) { b.signed++; totals.signed++; }
    });

    // Always show all five dropdown options, even at zero, so a channel that
    // produced nothing is visible rather than silently missing from the table.
    LEAD_SOURCES.forEach((s) => {
      bySource[s] = bySource[s] || { source: s, leads: 0, booked: 0, consulted: 0, signed: 0 };
    });

    // Airtable is the source of truth for bookings; the audit compares it
    // against what GA4 saw.
    out.airtableBookings = recs.filter((r) => {
      const mt = (r.fields || {})["Meeting Time"];
      if (!mt) return false;
      const d = new Date(mt);
      return !isNaN(d) && d >= since && d <= until;
    }).length;

    out.sales = {
      totals: {
        ...totals,
        showUpRate: totals.leads ? totals.consulted / totals.leads : null,
        closeRate: totals.consulted ? totals.signed / totals.consulted : null,
      },
      bySource: LEAD_SOURCES
        .map((s) => bySource[s])
        .map((b) => ({ ...b, closeRate: b.consulted ? b.signed / b.consulted : null })),
    };
  } catch (err) {
    out.errors.push("Airtable: " + err.message);
    // Airtable is the source of truth for bookings; the audit compares it
    // against what GA4 saw.
    out.airtableBookings = recs.filter((r) => {
      const mt = (r.fields || {})["Meeting Time"];
      if (!mt) return false;
      const d = new Date(mt);
      return !isNaN(d) && d >= since && d <= until;
    }).length;

    out.sales = { totals: {}, bySource: [] };
  }

  if (out.channels && out.sales) {
    out.channels = confidence(out.channels, out.sales.bySource);
  }

  return out;
}

exports.gather = gather;
// Re-exported because reminders.js imports it from here. It now lives in
// shared/ga4.js; this line is the shim that keeps that import working.
exports.normalizePrivateKey = normalizePrivateKey;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const ownerEmail = (payload.ownerEmail || "").toLowerCase().trim();
  if (!OWNERS.includes(ownerEmail)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Owners only" }) };
  }

  const days = Math.min(Math.max(parseInt(payload.days, 10) || 90, 1), 365);
  const out = await gather(days);
  return { statusCode: 200, headers, body: JSON.stringify(out) };
};
