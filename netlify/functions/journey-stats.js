const { searchStats } = require("../shared/search-console");
// journey-stats.js — every number in the customer journey, in one call.
//
// Four stages, one per circle on the journey page: traffic, consultation,
// close, continuity. Three sources behind them, and any one may be missing
// without taking the page down: GA4 needs its service-account env vars, Brevo
// needs its key, Airtable is the only hard requirement.

const {
  sessionsByMentee, traffic, signup, consultation, close, continuity, midpoints, ymd, reach,
} = require("../shared/journey-stages");
const { signupFunnel } = require("../shared/signup-funnel");

function channelStats() {
  try { return require("../data/channel-stats.json"); }
  catch (e) { return { linkedin: {}, instagram: {} }; }
}

/**
 * Instagram reach, live from the Graph API, keyed by the Monday of each week so
 * it drops straight into the same shape as the static file.
 *
 * The static channel-stats.json is only written by a script Fidel runs by hand,
 * so Instagram sat as stale as LinkedIn even though it has an API. LinkedIn has
 * no equivalent, which is why that half stays manual.
 */
async function instagramWeeks(fromYmd, toYmd) {
  const token = process.env.IG_TOKEN;
  if (!token) return null;
  // The API caps a single insights query at 30 days, and only serves the last
  // two years, so ask for the window plus a little slack and no more.
  const since = Math.floor(new Date(`${fromYmd}T00:00:00Z`).getTime() / 1000);
  const until = Math.floor(new Date(`${toYmd}T00:00:00Z`).getTime() / 1000);
  const span = (until - since) / 86400;
  if (span <= 0 || span > 30) return null;

  try {
    const url = `https://graph.instagram.com/v21.0/me/insights` +
      `?metric=reach&period=day&since=${since}&until=${until}&access_token=${token}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) return null;
    const values = ((data.data || [])[0] || {}).values || [];

    const weeks = {};
    for (const v of values) {
      const d = new Date(v.end_time);
      // Monday of that day's week, matching how the static file is keyed.
      const day = (d.getUTCDay() + 6) % 7;
      const monday = new Date(d.getTime() - day * 86400000).toISOString().slice(0, 10);
      weeks[monday] = weeks[monday] || { impressions: 0 };
      weeks[monday].impressions += v.value || 0;
    }
    return weeks;
  } catch (e) { return null; }
}

function instagramPosts() {
  try { return require("../data/instagram-posts.json").posts || {}; }
  catch (e) { return {}; }
}
const { ga4Token, runReport, dateRange, eventFilter } = require("../shared/ga4");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];
// The windows the page offers. 7 for "what happened this week", 90 for a
// trend that survives a quiet fortnight.
const WINDOWS = [7, 28, 90];
const DEFAULT_WINDOW = 28;
const TARGET_GAP_DAYS = 7;

const KEY_EVENTS = ["generate_lead", "discovery_form_submit", "invitee_meeting_scheduled"];

// Where a signup actually went. Allocated by pagePath, which is a built-in
// GA4 dimension: form_id and signup_type are custom dimensions, they are not
// retroactive, and roughly two thirds of generate_lead rows carry no form_id
// at all. The page the event fired on has no such gap.
//
// Each entry names the event that counts as the finish line for that
// destination, so the numbers are completions and not intentions.
const DESTINATIONS = [
  { key: "free_call", label: "Free call booked",
    pages: [/^\/free-call-submitted/], event: "invitee_meeting_scheduled",
    startPages: [/^\/discovery-call/], startEvent: "discovery_form_submit" },
  { key: "audit", label: "Lead magnet (job search audit)",
    pages: [/^\/job-search-audit/], event: "generate_lead" },
  { key: "job_alerts", label: "Job alerts",
    pages: [/^\/job-alerts/], event: "generate_lead" },
  { key: "community", label: "Community question",
    pages: [/^\/ask/], event: "generate_lead" },
];
const SIGNUP_EVENTS = ["generate_lead", "discovery_form_submit", "invitee_meeting_scheduled"];

// The reminder emails, matched by shape because the subject carries a date.
const EMAILS = [
  ["Booking confirmation", /^(subject:\s*)?locked in: your headstart consultation/i],
  ["Morning of", /^initial consultation: see you today/i],
  ["2 hours before", /^initial consultation: see you in 2 hours/i],
];

async function fetchAll(baseId, tableId, fields, token) {
  const out = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

/** GA4 totals, key events and top sources. Returns null if it is not set up. */
async function ga4Block(env, windowDays, offsetDays) {
  const { GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY } = env;
  if (!GA4_PROPERTY_ID || !GA4_CLIENT_EMAIL || !GA4_PRIVATE_KEY) return null;
  const token = await ga4Token(GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY);
  // dateRange(28, 28) is "56 days ago to 28 days ago": the 28 days before the
  // 28 being viewed.
  const range = dateRange(windowDays, offsetDays);

  const [totals, events, sources, forms] = await Promise.all([
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range, metrics: [{ name: "totalUsers" }, { name: "sessions" }],
    }),
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range, dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: eventFilter(KEY_EVENTS),
    }),
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range, dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }], limit: 50,
    }),
    // Signup completions by page. The limit is deliberately generous: a row
    // cap tuned for a week silently truncates over ninety days.
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range,
      dimensions: [{ name: "pagePath" }, { name: "eventName" }], metrics: [{ name: "totalUsers" }],
      dimensionFilter: eventFilter(SIGNUP_EVENTS),
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }], limit: 300,
    }).catch(() => []),
  ]);

  return {
    windowDays,
    users: totals[0] ? totals[0].mets[0] : 0,
    sessions: totals[0] ? totals[0].mets[1] : 0,
    // users, not eventCount: one booking fires the Calendly event many times.
    events: events.map((r) => ({ name: r.dims[0], count: r.mets[0], users: r.mets[1] })),
    sources: sources.map((r) => ({ source: r.dims[0] || "(direct)", users: r.mets[0], sessions: r.mets[1] })),
    signups: allocate(forms),
  };
}

/** Roll the page-and-event rows into one line per signup destination. */
function allocate(rows) {
  const tally = (pages, event) => rows
    .filter((r) => r.dims[1] === event && pages.some((re) => re.test(String(r.dims[0] || "").replace(/\/$/, "") || "/")))
    .reduce((a, r) => a + r.mets[0], 0);

  const out = DESTINATIONS.map((d) => ({
    key: d.key, label: d.label,
    people: tally(d.pages, d.event),
    started: d.startPages ? tally(d.startPages, d.startEvent) : null,
  }));

  // Anything that fired a signup event on a page no destination claims. Shown
  // rather than dropped, so the rows still add up to the total.
  const claimed = DESTINATIONS.flatMap((d) => d.pages.concat(d.startPages || []));
  const other = rows
    .filter((r) => r.dims[1] !== "discovery_form_submit")
    .filter((r) => !claimed.some((re) => re.test(String(r.dims[0] || "").replace(/\/$/, "") || "/")))
    .reduce((a, r) => a + r.mets[0], 0);
  if (other) out.push({ key: "other", label: "Other pages", people: other, started: null });
  return out.filter((d) => d.people || d.started);
}

/** Open rates for the three reminder emails. Returns [] if Brevo is not set up. */
async function emailBlock(apiKey, windowDays, offsetDays) {
  if (!apiKey) return [];
  // Brevo reads dates as UTC, so "today" in Melbourne reads as the future.
  // Capped at 89: Brevo refuses a range wider than 90 days.
  const span = Math.min(windowDays, 89);
  const end = ymd(Date.now() - 86400000 - offsetDays * 86400000);
  const start = ymd(new Date(end + "T00:00:00Z").getTime() - span * 86400000);
  const pull = async (event) => {
    const url = `https://api.brevo.com/v3/smtp/statistics/events` +
      `?limit=2500&startDate=${start}&endDate=${end}&event=${event}`;
    const res = await fetch(url, { headers: { "api-key": apiKey, accept: "application/json" } });
    const data = await res.json();
    return data.code ? [] : (data.events || []);
  };
  const [delivered, opened, proxy, clicked] = await Promise.all(
    ["delivered", "opened", "loadedByProxy", "clicks"].map(pull));

  const idsFor = (rows, re) =>
    new Set(rows.filter((x) => re.test(String(x.subject || "").trim())).map((x) => x.messageId));

  return EMAILS.map(([name, re]) => {
    const d = idsFor(delivered, re);
    const o = idsFor(opened, re);
    const p = idsFor(proxy, re);
    const c = idsFor(clicked, re);

    // One open rate, measured only on the people a mail-app proxy never
    // touched. Among them an open means a person, and a non-open means nobody
    // read it, so the rate is clean. It is then taken as the rate for
    // everybody.
    //
    // The raw "opened / delivered" is not a ceiling to sit under: Apple's
    // pre-fetch suppresses the real open event as often as it fabricates one,
    // so the raw figure is biased downward for proxy-heavy audiences and this
    // estimate can sit slightly above it.
    // Numerator and denominator must describe the same population. An email
    // delivered before the window but opened inside it used to count as an
    // open with no recipient behind it, which is how a 104% open rate got on
    // screen. Only opens on messages delivered in this window count.
    const cleanOpens = [...o].filter((id) => d.has(id) && !p.has(id)).length;
    const cleanRecipients = d.size - [...p].filter((id) => d.has(id)).length;
    const base = d.size || 1;
    return {
      name, delivered: d.size, opened: o.size, clicked: c.size, proxy: p.size,
      // Clamped as well as fixed: a rate above 100% is always a bug, and it
      // should never be the thing a reader has to notice.
      openRate: Math.min(100, cleanRecipients
        ? Math.round((cleanOpens / cleanRecipients) * 100)
        : Math.round((o.size / base) * 100)),
      clickRate: Math.round((c.size / base) * 100),
    };
  }).filter((e) => e.delivered > 0);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  if (!OWNERS.includes((payload.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }
  // Only the offered windows, so a hand-edited request cannot ask GA4 for two
  // years of data and time the function out.
  const windowDays = WINDOWS.includes(Number(payload.windowDays))
    ? Number(payload.windowDays) : DEFAULT_WINDOW;
  // Shift the whole window back by one of its own lengths, for "vs the period
  // before". Only ever 0 or one window, so the two spans sit end to end.
  const offsetDays = payload.previousPeriod ? windowDays : 0;

  const {
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_SESSION_TABLE_ID, BREVO_API_KEY,
  } = process.env;

  try {
    const [clientRecs, sessionRecs] = await Promise.all([
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Meeting Time", "Client Pipeline", "Raw Notes", "Pipeline Changed"],
        AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
        ["Date", "Mentee Name", "Mentee Record ID", "Payment Status", "Amount Charged"],
        AIRTABLE_API_TOKEN),
    ]);

    // GA4 and Brevo are each allowed to fail on their own. A missing key
    // should grey out one circle, not break the page.
    const notes = [];
    const [ga, email, funnel] = await Promise.all([
      ga4Block(process.env, windowDays, offsetDays).catch((e) => { notes.push(`GA4: ${e.message}`); return null; }),
      emailBlock(BREVO_API_KEY, windowDays, offsetDays).catch((e) => { notes.push(`Brevo: ${e.message}`); return []; }),
      // Returns null rather than throwing, so a GA4 outage greys this circle
      // out instead of taking the page down.
      signupFunnel(process.env, windowDays, offsetDays),
    ]);

    const clients = clientRecs.map((r) => ({
      id: r.id,
      name: r.fields["Name"] || "",
      meeting: r.fields["Meeting Time"] ? ymd(r.fields["Meeting Time"]) : "",
      pipeline: r.fields["Client Pipeline"] || "",
      // A transcript is the evidence the call happened, and the same test the
      // Airtable "Showed Up Rate" formula uses.
      transcript: String(r.fields["Raw Notes"] || "").trim() !== "",
      // When the label last moved. A close is dated from here, not from the
      // call and not from the first lesson.
      changed: r.fields["Pipeline Changed"] ? ymd(r.fields["Pipeline Changed"]) : "",
    }));
    const byMentee = sessionsByMentee(sessionRecs);
    // "to" is the end of the window being asked for, which is today unless the
    // previous period was requested. Every stage treats it as its upper bound.
    const to = ymd(Date.now() - offsetDays * 86400000);
    const from = ymd(Date.now() - (offsetDays + windowDays) * 86400000);

    // Live Instagram where the API can answer, the stored file where it cannot.
    const stats = channelStats();
    const [igLive, search] = await Promise.all([
      instagramWeeks(from, to),
      // Search impressions are reach in the same sense as a LinkedIn view:
      // somebody saw Headstart. Clicks are traffic, and GA4 already counts
      // those, so only impressions are added here.
      searchStats(process.env, windowDays, offsetDays),
    ]);
    const merged = igLive
      ? { ...stats, instagram: { ...(stats.instagram || {}), ...igLive } }
      : stats;

    const stages = [
      reach(merged, ga, instagramPosts(), from, to, search),
      ga ? traffic(ga) : {
        key: "traffic", label: "Traffic", headline: "Not connected",
        sub: "GA4 env vars missing", stats: [], unavailable: true,
      },
      signup(funnel),
      consultation(clients, email, to, from),
      close(clients, byMentee, to, from),
      continuity(byMentee, `${TARGET_GAP_DAYS} days`, from, to),
    ];

    return json(200, {
      stages, links: midpoints(email),
      notes, windowDays, windows: WINDOWS, from, to,
      previousPeriod: Boolean(payload.previousPeriod),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not build the journey" });
  }
};
