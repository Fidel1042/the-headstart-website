// weekly-report.js — Monday morning pilot report.
//
// Scheduled in netlify.toml to fire at 19:15 AND 20:15 UTC every Sunday.
// One of those is 06:15 in Sydney depending on daylight saving; the guard
// below sends on the matching one and exits quietly on the other. That keeps
// the email at 6:15am Sydney all year with no seasonal edits.
//
// Reuses leads-attribution.js so the email and the portal can never disagree.

const { gather } = require("./leads-attribution.js");

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TO = [{ email: "fidelhon@gmail.com", name: "Fidel" }];

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");
const rate = (r) => (r == null ? "—" : `${(r * 100).toFixed(0)}%`);

/** Sydney wall-clock hour right now, daylight saving handled by the runtime. */
function sydneyParts() {
  const fmt = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney",
    hour: "numeric", hour12: false, weekday: "short", day: "numeric", month: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { hour: Number(parts.hour), weekday: parts.weekday, day: parts.day, month: parts.month };
}

/** Arrow + colour for a week-on-week change. */
function delta(now, before) {
  if (!before) return now ? `<span style="color:#2e7d52">new</span>` : "—";
  const change = ((now - before) / before) * 100;
  if (Math.abs(change) < 5) return `<span style="color:#8a8a8a">flat</span>`;
  const up = change > 0;
  return `<span style="color:${up ? "#2e7d52" : "#c0392b"}">${up ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}%</span>`;
}

function table(headers, rows) {
  if (!rows.length) return `<p style="color:#8a8a8a;font-size:14px;margin:0 0 24px">Nothing recorded this week.</p>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="border-collapse:collapse;margin:0 0 28px;font-size:14px">
    <tr>${headers.map((h, i) => `<th align="${i ? "right" : "left"}"
      style="padding:8px 10px;border-bottom:2px solid #e6e2d8;color:#6b6455;font-weight:600;
      font-size:11px;letter-spacing:.06em;text-transform:uppercase">${esc(h)}</th>`).join("")}</tr>
    ${rows.map((r) => `<tr>${r.map((c, i) => `<td align="${i ? "right" : "left"}"
      style="padding:9px 10px;border-bottom:1px solid #f0ede5">${c}</td>`).join("")}</tr>`).join("")}
  </table>`;
}

/**
 * Three bullets: what happened, then the wins, then what to watch.
 * Derived from the numbers rather than written by hand, so it cannot drift
 * out of step with the tables underneath it.
 */
function execSummary(now, prev, sales) {
  const sum = (d, f) => (d.channels || []).reduce((s, c) => s + f(c), 0);
  const v = sum(now, (c) => c.visitors), vPrev = sum(prev, (c) => c.visitors);
  const b = sum(now, (c) => c.booked), bPrev = sum(prev, (c) => c.booked);
  const change = vPrev ? ((v - vPrev) / vPrev) * 100 : 0;

  const wins = [];
  const watch = [];

  // Movement per channel, biggest mover each way.
  const prevBy = Object.fromEntries((prev.channels || []).map((c) => [c.source, c.visitors]));
  const moves = (now.channels || [])
    .filter((c) => c.source !== "(not set)" && c.source !== "(unknown)")
    .map((c) => ({ src: c.source, now: c.visitors, was: prevBy[c.source] || 0, booked: c.booked }))
    .filter((m) => m.was >= 20 || m.now >= 20);

  const risers = moves.filter((m) => m.was && m.now > m.was * 1.2)
    .sort((a, b2) => (b2.now - b2.was) - (a.now - a.was));
  const fallers = moves.filter((m) => m.was && m.now < m.was * 0.75)
    .sort((a, b2) => (a.now - a.was) - (b2.now - b2.was));

  if (b > bPrev) wins.push(`Bookings up ${bPrev} to ${b}`);
  if (risers[0]) wins.push(`${risers[0].src} traffic up ${Math.round(((risers[0].now - risers[0].was) / risers[0].was) * 100)}%`);
  const best = (sales.bySource || []).filter((s) => s.consulted >= 3)
    .sort((a, b2) => (b2.closeRate || 0) - (a.closeRate || 0))[0];
  if (best && best.closeRate) wins.push(`${best.source} closing at ${rate(best.closeRate)} over 90 days`);
  if (!wins.length && v) wins.push(`${v} visitors, steady on last week`);

  if (fallers[0]) watch.push(`${fallers[0].src} traffic down ${Math.round(((fallers[0].was - fallers[0].now) / fallers[0].was) * 100)}%, was ${fallers[0].was} now ${fallers[0].now}`);
  if (change < -25 && !fallers.length) watch.push(`Total traffic down ${Math.abs(Math.round(change))}%`);
  if (b === 0 && v > 50) watch.push("No calls booked at all this week");
  const dead = (now.channels || []).find((c) => c.visitors >= 100 && c.booked === 0 &&
    c.source !== "(not set)" && c.source !== "(unknown)");
  if (dead) watch.push(`${dead.src || dead.source} sent ${dead.visitors} visitors and booked nobody`);
  const untagged = (now.channels || []).find((c) => c.source === "(not set)" || c.source === "(unknown)");
  if (untagged && v && untagged.visitors / v > 0.4) {
    watch.push(`${Math.round((untagged.visitors / v) * 100)}% of traffic still arriving untagged`);
  }
  if (!watch.length) watch.push("Nothing needs attention this week");

  const headline = !v
    ? "No traffic recorded. If that looks wrong, check the site is still tagging."
    : `${v} visitors (${change >= 0 ? "+" : ""}${Math.round(change)}% on last week), ${b} calls booked.`;

  return [
    { kind: "Overall", text: headline },
    { kind: "Working", text: wins.slice(0, 2).join(". ") + "." },
    { kind: "Watch", text: watch.slice(0, 2).join(". ") + "." },
  ];
}

function buildHtml(now, prev, when, sales) {
  const sumVisitors = (d) => (d.channels || []).reduce((s, c) => s + c.visitors, 0);
  const sumBooked = (d) => (d.channels || []).reduce((s, c) => s + c.booked, 0);
  const sumSignups = (d) => (d.channels || []).reduce(
    (s, c) => s + c.signups.job_alerts + c.signups.audit_roadmap + c.signups.discovery_call, 0);

  const v = sumVisitors(now), vPrev = sumVisitors(prev);
  const b = sumBooked(now), bPrev = sumBooked(prev);

  // Each signup destination on its own row. A lumped total hides the thing
  // that matters, which is whether they took the free stuff or booked a call.
  const bySignup = (d, k) => (d.channels || []).reduce((s, c) => s + c.signups[k], 0);
  const ja = bySignup(now, "job_alerts"), jaPrev = bySignup(prev, "job_alerts");
  const ar = bySignup(now, "audit_roadmap"), arPrev = bySignup(prev, "audit_roadmap");
  const dc = bySignup(now, "discovery_call"), dcPrev = bySignup(prev, "discovery_call");

  const topline = [
    ["Visitors", v, delta(v, vPrev)],
    ["→ Job alerts signups", ja, delta(ja, jaPrev)],
    ["→ Offer roadmap signups", ar, delta(ar, arPrev)],
    ["→ Discovery call forms", dc, delta(dc, dcPrev)],
    ["Calls booked", b, delta(b, bPrev)],
  ];

  // Channel rows, week on week, so a channel falling off is obvious.
  // Traffic with no source is shown rather than hidden, otherwise the rows
  // would not add up to the topline. It shrinks on its own as tagging spreads.
  const prevByChannel = Object.fromEntries((prev.channels || []).map((c) => [c.source, c]));
  const channelRows = (now.channels || [])
    .slice(0, 9)
    .map((c) => {
      const unattributed = c.source === "(not set)" || c.source === "(unknown)";
      const name = unattributed ? "Not yet tagged" : esc(c.source);
      return [
        unattributed ? `<span style="color:#8a8a8a">${name}</span>` : `<b>${name}</b>`,
        c.visitors,
        delta(c.visitors, (prevByChannel[c.source] || {}).visitors || 0),
        c.signups.job_alerts + c.signups.audit_roadmap,
        Math.max(c.signups.discovery_call, c.callForms),
        c.booked,
        pct(c.booked, c.visitors),
      ];
    });

  const salesRows = (sales.bySource || [])
    .map((s) => [esc(s.source), s.leads, s.consulted, `<b>${s.signed}</b>`, rate(s.closeRate)]);

  const linkTotal = (now.linksPage || []).reduce((s, r) => s + r.total, 0);
  const linkRows = (now.linksPage || []).map((r) =>
    [esc(r.label), r.total, pct(r.total, linkTotal)]);

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f4ef">
  <div style="max-width:640px;margin:0 auto;padding:28px 20px 44px;
    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#14110c">

    <p style="font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#a08a4e;margin:0 0 4px">
      Headstart weekly</p>
    <h1 style="font-size:21px;margin:0 0 6px">Week to ${esc(when)}</h1>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="border-collapse:collapse;margin:0 0 30px">
      ${execSummary(now, prev, sales).map((s) => `<tr>
        <td valign="top" style="padding:0 10px 12px 0;white-space:nowrap;
          font-size:11px;letter-spacing:.07em;text-transform:uppercase;
          color:${s.kind === "Watch" ? "#b3541e" : s.kind === "Working" ? "#2e7d52" : "#a08a4e"};
          font-weight:700;padding-top:2px">${esc(s.kind)}</td>
        <td style="padding:0 0 12px;font-size:15px;line-height:1.5;color:#2b2721">${esc(s.text)}</td>
      </tr>`).join("")}
    </table>

    <h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Topline</h2>
    ${table(["Metric", "Last 7 days", "vs week before"],
      topline.map(([k, val, d]) => [esc(k), `<b>${esc(String(val))}</b>`, d || "—"]))}

    <h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Where they came from</h2>
    ${table(["Channel", "Visitors", "vs", "Free stuff", "Discovery", "Booked", "Rate"], channelRows)}

    <h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">After the call — rolling 90 days</h2>
    ${table(["Source", "Leads", "Showed", "Signed", "Close"], salesRows)}

    <h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Links page</h2>
    ${table(["Option", "Clicks", "Share"], linkRows)}

    <p style="margin:8px 0 0">
      <a href="https://theheadstartmentoring.com/mentor-portal/leads.html"
         style="display:inline-block;background:#c79b3b;color:#10100e;text-decoration:none;
         padding:13px 24px;border-radius:9px;font-weight:700;font-size:14px">Open the dashboard</a>
    </p>

    <p style="font-size:12px;color:#8a8a8a;line-height:1.6;margin:26px 0 0">
      Traffic and signups are the last 7 days against the 7 before.
      Sales are a rolling 90 days, because a call booked this week often
      happens next week and a 7 day close rate would punish you for that.
      Figures count people, not events.
      "Not yet tagged" is traffic that arrived without a source; it shrinks as
      more of your posted links carry tags.
      ${now.errors && now.errors.length ? `<br><b>Warnings:</b> ${esc(now.errors.join(" · "))}` : ""}
    </p>
  </div></body></html>`;
}

exports.handler = async (event) => {
  const force = String((event && event.queryStringParameters &&
    event.queryStringParameters.force) || "") === "1";

  // Two crons fire; only the one that lands on 6am Sydney should send.
  const syd = sydneyParts();
  if (!force && syd.hour !== 6) {
    return { statusCode: 200, body: `Skipped, Sydney hour is ${syd.hour}, waiting for 6.` };
  }

  if (!process.env.BREVO_API_KEY) {
    return { statusCode: 500, body: "BREVO_API_KEY is not set" };
  }

  try {
    const [now, prev, quarter] = await Promise.all([gather(7), gather(7, 7), gather(90)]);
    const when = `${syd.day} ${syd.month}`;

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: SENDER,
        to: TO,
        subject: `Headstart weekly — week to ${when}`,
        htmlContent: buildHtml(now, prev, when, quarter.sales),
      }),
    });
    if (!res.ok) {
      return { statusCode: 502, body: "Brevo rejected the email: " + (await res.text()).slice(0, 300) };
    }
    return { statusCode: 200, body: `Sent weekly report for week to ${when}` };
  } catch (err) {
    return { statusCode: 500, body: "Failed: " + err.message };
  }
};
