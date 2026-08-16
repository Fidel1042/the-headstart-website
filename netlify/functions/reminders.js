// reminders.js — dated one-off emails to Fidel.
//
// Runs daily (see netlify.toml). Each morning it checks whether today's date
// in Sydney matches a reminder below and sends that one. Everything else is a
// no-op, so adding a future reminder means adding one entry to REMINDERS.
//
// Deliberately one function rather than one per reminder: the schedule, the
// timezone guard and the Brevo call are identical every time.

const crypto = require("crypto");
const { normalizePrivateKey } = require("./leads-attribution.js");

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TO = [{ email: "fidelhon@gmail.com", name: "Fidel" }];

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pctStr = (n, d) => (d ? `${((n / d) * 100).toFixed(2)}%` : "—");

/* ------------------------------------------------------------- GA4 --- */

async function ga4(body) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (i) => Buffer.from(i).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const head = b64(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64(JSON.stringify({
    iss: process.env.GA4_CLIENT_EMAIL,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${head}.${claim}`);
  const jwt = `${head}.${claim}.${b64(signer.sign(normalizePrivateKey(process.env.GA4_PRIVATE_KEY)))}`;

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt,
    }),
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error("GA4 auth failed");

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`,
    { method: "POST",
      headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body) });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return (json.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value) || 0),
  }));
}

const EVENTS = ["page_view", "generate_lead", "discovery_form_submit", "invitee_meeting_scheduled"];

/* ------------------------------------------------------- templating --- */

const shell = (eyebrow, title, intro, body) => `<!doctype html><html><body style="margin:0;background:#f6f4ef">
<div style="max-width:620px;margin:0 auto;padding:28px 20px 44px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#14110c">
  <p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#a08a4e;margin:0 0 4px">${esc(eyebrow)}</p>
  <h1 style="font-size:21px;margin:0 0 10px">${esc(title)}</h1>
  <p style="font-size:14px;line-height:1.6;color:#4a453c;margin:0 0 24px">${intro}</p>
  ${body}
  <p style="margin:24px 0 0">
    <a href="https://theheadstartmentoring.com/mentor-portal/leads.html"
      style="display:inline-block;background:#c79b3b;color:#10100e;text-decoration:none;
      padding:13px 24px;border-radius:9px;font-weight:700;font-size:14px">Open the dashboard</a></p>
  <p style="font-size:12px;color:#8a8a8a;line-height:1.6;margin:22px 0 0">
    One-off reminder, it will not repeat. Counts people, not events.</p>
</div></body></html>`;

const callout = (heading, text) => `<div style="background:#fff;border:1px solid #e6e2d8;
  border-left:4px solid #c79b3b;border-radius:8px;padding:16px 18px;margin:0 0 24px">
  <p style="margin:0 0 6px;font-size:16px;font-weight:700">${esc(heading)}</p>
  <p style="margin:0;font-size:14px;line-height:1.6;color:#4a453c">${text}</p></div>`;

const tbl = (headers, rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="border-collapse:collapse;font-size:14px;margin:0 0 24px">
  <tr>${headers.map((h, i) => `<th align="${i ? "right" : "left"}" style="padding:8px 10px;
    border-bottom:2px solid #e6e2d8;font-size:11px;letter-spacing:.06em;text-transform:uppercase;
    color:#6b6455">${esc(h)}</th>`).join("")}</tr>
  ${rows.map((r) => `<tr>${r.map((c, i) => `<td align="${i ? "right" : "left"}"
    style="padding:9px 10px;border-bottom:1px solid #f0ede5">${c}</td>`).join("")}</tr>`).join("")}
</table>`;

/* -------------------------------------------------------- reminders --- */

async function landingStats(days) {
  const rows = await ga4({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "landingPage" }, { name: "eventName" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: EVENTS } } },
    limit: 300,
  });
  const byPage = {};
  rows.forEach(({ dims, mets }) => {
    const [page, ev] = dims;
    const p = (byPage[page] = byPage[page] || {});
    p[ev] = (p[ev] || 0) + mets[0];
  });
  return byPage;
}

async function mediumStats(days) {
  const rows = await ga4({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "customEvent:first_medium" }, { name: "eventName" },
                 { name: "customEvent:signup_type" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: EVENTS } } },
    limit: 400,
  });
  const out = {};
  rows.forEach(({ dims, mets }) => {
    const [medium, ev, type] = dims;
    const m = (out[medium] = out[medium] || { visitors: 0, audit: 0, booked: 0, callForms: 0 });
    if (ev === "page_view") m.visitors += mets[0];
    if (ev === "invitee_meeting_scheduled") m.booked += mets[0];
    if (ev === "discovery_form_submit") m.callForms += mets[0];
    if (ev === "generate_lead" && type === "audit_roadmap") m.audit += mets[0];
  });
  return out;
}

async function channelStats(days) {
  const rows = await ga4({
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "sessionSource" }, { name: "eventName" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: EVENTS } } },
    limit: 400,
  });
  const norm = (s) => {
    s = String(s || "").toLowerCase();
    if (s.includes("linkedin") || s.includes("lnkd")) return "LinkedIn";
    if (s === "ig" || s.includes("instagram")) return "Instagram";
    if (s.includes("direct") || s === "(none)") return "Direct";
    return "Other";
  };
  const out = {};
  rows.forEach(({ dims, mets }) => {
    const k = norm(dims[0]);
    const c = (out[k] = out[k] || { visitors: 0, booked: 0 });
    if (dims[1] === "page_view") c.visitors += mets[0];
    if (dims[1] === "invitee_meeting_scheduled") c.booked += mets[0];
  });
  return out;
}

const REMINDERS = [
  {
    id: "price-hide-test",
    date: "2026-08-31",
    subject: "Starting today: the hide-the-price test",
    async build() {
      const pages = await landingStats(28);
      const chans = await channelStats(28);
      const home = pages["/"] || {};
      const landed = home.page_view || 0;
      const booked = home.invitee_meeting_scheduled || 0;

      const chanRows = ["LinkedIn", "Instagram", "Direct", "Other"]
        .filter((k) => chans[k])
        .map((k) => [k, chans[k].visitors,
          pctStr(chans[k].visitors, Object.values(chans).reduce((s, c) => s + c.visitors, 0))]);

      return shell("Test starting", "Hide-the-price test: your baseline",
        "You wanted a nudge to start this. Here is the last 28 days, frozen as your before-period. " +
        "Screenshot this email; it is the number you will compare against.",
        callout(`Baseline: ${pctStr(booked, landed)} of homepage visitors book a call`,
          `${booked} bookings from ${landed} homepage visitors over 28 days.`) +
        tbl(["Metric", "Last 28 days", ""], [
          ["Homepage visitors", landed, ""],
          ["Booked a call", `<b>${booked}</b>`, ""],
          ["Booking rate", `<b>${pctStr(booked, landed)}</b>`, ""],
        ]) +
        `<h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Traffic mix right now</h2>` +
        tbl(["Channel", "Visitors", "Share"], chanRows) +
        callout("Read this before you start",
          "This is a before-and-after, not a randomised test, so anything else that changes in " +
          "the window will contaminate it. Three rules. One: run it four full weeks, do not peek and stop early. " +
          "Two: change nothing else on the site or in your posting rhythm. " +
          "Three: check the traffic mix above at the end. If your LinkedIn share moves much, the " +
          "comparison is worthless because those visitors convert differently.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        <b>What would count as a real result?</b> At roughly ${Math.round(landed / 28 * 30)} homepage
        visitors a month, only a very large swing is readable. Under about a 50% change either way,
        treat it as noise and keep the price visible, since visible pricing also filters out people
        who were never going to pay.</p>`);
    },
  },
  {
    id: "lead-magnet-review",
    date: "2026-09-07",
    subject: "Decision: keep the lead magnet on your Featured slot?",
    async build() {
      const mediums = await mediumStats(24);
      const pages = await landingStats(24);
      const featured = mediums.featured || { visitors: 0, audit: 0, booked: 0 };
      const profile = mediums.profile || { visitors: 0, audit: 0, booked: 0 };
      const home = pages["/"] || {};
      const homeV = home.page_view || 0, homeB = home.invitee_meeting_scheduled || 0;

      const fRate = featured.visitors ? featured.booked / featured.visitors : null;
      const hRate = homeV ? homeB / homeV : null;

      let verdict, why;
      if (featured.visitors < 25) {
        verdict = "Not enough data yet — leave it alone";
        why = `Only ${featured.visitors} people clicked the Featured link since it was tagged. ` +
          "Any conclusion off that is noise. Give it another month, or check the link is actually tagged.";
      } else if (featured.audit === 0) {
        verdict = "Switch it to the discovery call";
        why = `${featured.visitors} clicked through and nobody took the roadmap. The offer is not landing.`;
      } else if (fRate != null && hRate != null && fRate >= hRate) {
        verdict = "Keep it on the lead magnet";
        why = `It books at ${pctStr(featured.booked, featured.visitors)} against the homepage's ` +
          `${pctStr(homeB, homeV)}. The roadmap is feeding calls.`;
      } else if (featured.booked === 0) {
        verdict = "Switch it to the discovery call";
        why = `${featured.audit} people took the roadmap and none booked. You are collecting emails ` +
          "from your best channel instead of conversations.";
      } else {
        verdict = "Lean towards switching to the discovery call";
        why = `Featured books at ${pctStr(featured.booked, featured.visitors)}, homepage at ` +
          `${pctStr(homeB, homeV)}.`;
      }

      return shell("Decision due", "Is the lead magnet earning your Featured slot?",
        "You asked me to check back. Last 24 days since the Featured link was tagged.",
        callout(verdict, esc(why)) +
        tbl(["Source", "Clicked", "Took roadmap", "Booked"], [
          ["Featured section", featured.visitors, featured.audit, `<b>${featured.booked}</b>`],
          ["Profile link", profile.visitors, profile.audit, `<b>${profile.booked}</b>`],
          ["Homepage (all)", homeV, "—", `<b>${homeB}</b>`],
        ]) +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">If you switch:<br>
        <code style="background:#efece4;padding:3px 6px;border-radius:4px;font-size:12px">
        https://theheadstartmentoring.com/discovery-call?utm_source=linkedin&amp;utm_medium=featured&amp;utm_campaign=book-call</code></p>
        <p style="font-size:13px;color:#8a8a8a;line-height:1.6">Anyone who took the roadmap and books
        later will not show here, so treat a close call as a reason to wait rather than to switch.</p>`);
    },
  },
];

/* ---------------------------------------------------------- handler --- */

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const force = q.force;   // pass ?force=<id> to send one immediately

  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "numeric", hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;

  const due = force
    ? REMINDERS.find((r) => r.id === force)
    : (Number(parts.hour) === 6 ? REMINDERS.find((r) => r.date === today) : null);

  if (!due) return { statusCode: 200, body: `Nothing due (${today}, hour ${parts.hour}).` };
  if (!process.env.BREVO_API_KEY) return { statusCode: 500, body: "BREVO_API_KEY missing" };

  try {
    const html = await due.build();
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ sender: SENDER, to: TO, subject: due.subject, htmlContent: html }),
    });
    if (!res.ok) return { statusCode: 502, body: "Brevo rejected: " + (await res.text()).slice(0, 200) };
    return { statusCode: 200, body: `Sent reminder: ${due.id}` };
  } catch (err) {
    return { statusCode: 500, body: `Failed (${due.id}): ${err.message}` };
  }
};
