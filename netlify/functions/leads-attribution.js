// leads-attribution.js
// Owner-only feed for the portal's Leads page. Joins two sources:
//   GA4      - where traffic comes from and what it does on the site
//   Airtable - what happened after the call (consulted, signed, close rate)
//
// GA4 auth is a hand-rolled service-account JWT so this function needs no npm
// dependencies. Node's crypto does the RS256 signing.

const crypto = require("crypto");

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

/* ---------------------------------------------------------------- GA4 --- */

function b64url(input) {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Rebuild a usable PEM from however the key survived being pasted.
 *
 * Environment variable UIs mangle multi-line secrets in several ways: escaping
 * newlines as \n, replacing them with spaces, or stripping them entirely. All
 * three produce "DECODER routines::unsupported" from OpenSSL. Since the body
 * is just base64, throw away all whitespace and re-wrap it at 64 characters.
 */
function normalizePrivateKey(raw) {
  let key = String(raw || "").trim();
  if (!key) throw new Error("GA4_PRIVATE_KEY is empty");

  // A pasted JSON value can arrive still wrapped in quotes.
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");

  const match = key.match(/-----BEGIN ([A-Z ]+?)-----([\s\S]*?)-----END \1-----/);
  if (!match) {
    throw new Error(
      "GA4_PRIVATE_KEY is not a PEM key. It must include the BEGIN and END " +
      `lines. Received ${key.length} characters.`
    );
  }
  const label = match[1];
  const body = match[2].replace(/\s+/g, "");
  if (!body) throw new Error("GA4_PRIVATE_KEY has no key body between BEGIN and END");

  return `-----BEGIN ${label}-----\n${(body.match(/.{1,64}/g) || []).join("\n")}\n-----END ${label}-----\n`;
}

async function ga4Token(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(normalizePrivateKey(privateKey)));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("GA4 auth failed: " + (json.error_description || json.error || "unknown"));
  return json.access_token;
}

async function runReport(token, propertyId, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  if (json.error) throw new Error("GA4: " + json.error.message);
  return (json.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value) || 0),
  }));
}

const dateRange = (days, offset = 0) => [{
  startDate: `${days + offset}daysAgo`,
  endDate: offset ? `${offset}daysAgo` : "today",
}];

const eventFilter = (names) => ({
  filter: { fieldName: "eventName", inListFilter: { values: names } },
});

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

    const [visitors, conversions, campaigns, weekly, sessionRows, sessionWeekly, linkClicks] = await Promise.all([
      // People arriving, by original source
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "customEvent:first_source" }, { name: "customEvent:first_medium" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 100,
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
        limit: 400,
      }),
      // Per-post performance
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "customEvent:first_campaign" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view", ...CONVERSION_EVENTS]),
        limit: 400,
      }),
      // Weekly trend by source
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "week" }, { name: "customEvent:first_source" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 500,
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
        limit: 900,
      }),
      // The /links page: which of the three options people choose, and who
      // sent them. This is the Instagram bio-link question.
      runReport(token, P, {
        dateRanges: dateRange(days, offset),
        dimensions: [{ name: "customEvent:link_id" }, { name: "customEvent:first_source" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["link_click"]),
        limit: 200,
      }),
    ]);

    const channels = {};
    const chan = (k) => (channels[k] = channels[k] || {
      source: k, medium: "", visitors: 0,
      signups: { job_alerts: 0, audit_roadmap: 0, discovery_call: 0 },
      callForms: 0, booked: 0,
    });

    visitors.forEach(({ dims, mets }) => {
      const c = chan(dims[0] || "(unknown)");
      c.visitors += mets[0];
      if (!c.medium) c.medium = dims[1] || "";
    });

    conversions.forEach(({ dims, mets }) => {
      const [src, evName, signupType] = dims;
      const c = chan(src || "(unknown)");
      if (evName === "discovery_form_submit") c.callForms += mets[0];
      if (evName === "invitee_meeting_scheduled") c.booked += mets[0];
      if (Object.prototype.hasOwnProperty.call(c.signups, signupType)) {
        c.signups[signupType] += mets[0];
      }
    });

    out.channels = Object.values(channels)
      .filter((c) => c.visitors || c.booked || c.callForms)
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
    linkClicks.forEach(({ dims, mets }) => {
      const [linkId, src] = dims;
      if (!linkId || linkId === "(not set)") return;
      const l = (links[linkId] = links[linkId] || {
        linkId, label: LINK_LABELS[linkId] || linkId, total: 0, bySource: {},
      });
      l.total += mets[0];
      l.bySource[src || "(unknown)"] = (l.bySource[src || "(unknown)"] || 0) + mets[0];
    });
    out.linksPage = Object.values(links).sort((a, b) => b.total - a.total);

    // Same shape as out.channels, so the page can swap between them.
    const sess = {};
    sessionRows.forEach(({ dims, mets }) => {
      const [rawSrc, evName] = dims;
      const key = normaliseSessionSource(rawSrc);
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
      const key = normaliseSessionSource(rawSrc);
      swk[week] = swk[week] || { week, sources: {} };
      swk[week].sources[key] = (swk[week].sources[key] || 0) + mets[0];
    });
    out.weeklySession = Object.values(swk).sort((a, b) => a.week.localeCompare(b.week));

    const wk = {};
    weekly.forEach(({ dims, mets }) => {
      const [week, src] = dims;
      wk[week] = wk[week] || { week, sources: {} };
      wk[week].sources[src || "(unknown)"] = mets[0];
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
      const b = (bySource[key] = bySource[key] || { source: key, leads: 0, consulted: 0, signed: 0 });

      b.leads++; totals.leads++;
      if (truthy(f["Did Consultation?"]) || f["Showed Up Rate"] === 1) { b.consulted++; totals.consulted++; }
      if (truthy(f["Signed"])) { b.signed++; totals.signed++; }
    });

    // Always show all five dropdown options, even at zero, so a channel that
    // produced nothing is visible rather than silently missing from the table.
    LEAD_SOURCES.forEach((s) => {
      bySource[s] = bySource[s] || { source: s, leads: 0, consulted: 0, signed: 0 };
    });

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
    out.sales = { totals: {}, bySource: [] };
  }

  return out;
}

exports.gather = gather;

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
