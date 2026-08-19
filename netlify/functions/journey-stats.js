// journey-stats.js — every number in the customer journey, in one call.
//
// Four stages, one per circle on the journey page: traffic, consultation,
// close, continuity. Three sources behind them, and any one may be missing
// without taking the page down: GA4 needs its service-account env vars, Brevo
// needs its key, Airtable is the only hard requirement.

const {
  sessionsByMentee, traffic, consultation, close, continuity, ymd,
} = require("../shared/journey-stages");
const { ga4Token, runReport, dateRange, eventFilter } = require("../shared/ga4");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];
const WINDOW_DAYS = 28;
const TARGET_GAP_DAYS = 7;

const KEY_EVENTS = ["generate_lead", "discovery_form_submit", "invitee_meeting_scheduled"];

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
async function ga4Block(env) {
  const { GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY } = env;
  if (!GA4_PROPERTY_ID || !GA4_CLIENT_EMAIL || !GA4_PRIVATE_KEY) return null;
  const token = await ga4Token(GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY);
  const range = dateRange(WINDOW_DAYS);

  const [totals, events, sources] = await Promise.all([
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range, metrics: [{ name: "totalUsers" }, { name: "sessions" }],
    }),
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range, dimensions: [{ name: "eventName" }], metrics: [{ name: "eventCount" }],
      dimensionFilter: eventFilter(KEY_EVENTS),
    }),
    runReport(token, GA4_PROPERTY_ID, {
      dateRanges: range, dimensions: [{ name: "sessionSource" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }], limit: 10,
    }),
  ]);

  return {
    windowDays: WINDOW_DAYS,
    users: totals[0] ? totals[0].mets[0] : 0,
    sessions: totals[0] ? totals[0].mets[1] : 0,
    events: events.map((r) => ({ name: r.dims[0], count: r.mets[0] })),
    sources: sources.map((r) => ({ source: r.dims[0] || "(direct)", users: r.mets[0], sessions: r.mets[1] })),
  };
}

/** Open rates for the three reminder emails. Returns [] if Brevo is not set up. */
async function emailBlock(apiKey) {
  if (!apiKey) return [];
  // Brevo reads dates as UTC, so "today" in Melbourne reads as the future.
  const end = ymd(Date.now() - 86400000);
  const start = ymd(Date.now() - 86400000 - 89 * 86400000);
  const pull = async (event) => {
    const url = `https://api.brevo.com/v3/smtp/statistics/events` +
      `?limit=2500&startDate=${start}&endDate=${end}&event=${event}`;
    const res = await fetch(url, { headers: { "api-key": apiKey, accept: "application/json" } });
    const data = await res.json();
    return data.code ? [] : (data.events || []);
  };
  const [delivered, opened, proxy] = await Promise.all(
    ["delivered", "opened", "loadedByProxy"].map(pull));

  const idsFor = (rows, re) =>
    new Set(rows.filter((x) => re.test(String(x.subject || "").trim())).map((x) => x.messageId));

  return EMAILS.map(([name, re]) => {
    const d = idsFor(delivered, re);
    const o = idsFor(opened, re);
    const p = idsFor(proxy, re);
    const clean = [...o].filter((id) => !p.has(id)).length;
    const base = d.size || 1;
    return {
      name, delivered: d.size, opened: o.size,
      openRate: Math.round((o.size / base) * 100),
      provenRate: Math.round((clean / base) * 100),
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

  const {
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_SESSION_TABLE_ID, BREVO_API_KEY,
  } = process.env;

  try {
    const [clientRecs, sessionRecs] = await Promise.all([
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Meeting Time", "Client Pipeline", "Raw Notes"], AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
        ["Date", "Mentee Name", "Mentee Record ID", "Payment Status", "Amount Charged"],
        AIRTABLE_API_TOKEN),
    ]);

    // GA4 and Brevo are each allowed to fail on their own. A missing key
    // should grey out one circle, not break the page.
    const notes = [];
    const [ga, email] = await Promise.all([
      ga4Block(process.env).catch((e) => { notes.push(`GA4: ${e.message}`); return null; }),
      emailBlock(BREVO_API_KEY).catch((e) => { notes.push(`Brevo: ${e.message}`); return []; }),
    ]);

    const clients = clientRecs.map((r) => ({
      id: r.id,
      name: r.fields["Name"] || "",
      meeting: r.fields["Meeting Time"] ? ymd(r.fields["Meeting Time"]) : "",
      pipeline: r.fields["Client Pipeline"] || "",
      // A transcript is the evidence the call happened, and the same test the
      // Airtable "Showed Up Rate" formula uses.
      transcript: String(r.fields["Raw Notes"] || "").trim() !== "",
    }));
    const byMentee = sessionsByMentee(sessionRecs);
    const today = ymd(Date.now());

    const stages = [
      ga ? traffic(ga) : {
        key: "traffic", label: "Traffic", headline: "Not connected",
        sub: "GA4 env vars missing", stats: [], unavailable: true,
      },
      consultation(clients, email, today),
      close(clients, byMentee, today),
      continuity(byMentee, `${TARGET_GAP_DAYS} days`),
    ];

    return json(200, { stages, notes, generatedAt: new Date().toISOString() });
  } catch (err) {
    return json(502, { error: err.message || "Could not build the journey" });
  }
};
