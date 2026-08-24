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

/** "227 linkedin, 98 instagram, 60 untagged" for a given metric. */
function breakdown(channels, pick) {
  const parts = (channels || [])
    .map((c) => ({
      name: (c.source === "(not set)" || c.source === "(unknown)") ? "untagged" : c.source,
      n: pick(c),
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 4);
  if (!parts.length) return "";
  return parts.map((p) => `${p.n} ${p.name}`).join(", ");
}

/** A metric row followed by a muted explanation row. */
function detailTable(rows) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
      style="border-collapse:collapse;margin:0 0 28px;font-size:14px">
    <tr>
      <th align="left" style="padding:8px 10px;border-bottom:2px solid #e6e2d8;color:#6b6455;
        font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase">Metric</th>
      <th align="right" style="padding:8px 10px;border-bottom:2px solid #e6e2d8;color:#6b6455;
        font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase">Last 7 days</th>
      <th align="right" style="padding:8px 10px;border-bottom:2px solid #e6e2d8;color:#6b6455;
        font-weight:600;font-size:11px;letter-spacing:.06em;text-transform:uppercase">vs week before</th>
    </tr>
    ${rows.map((r) => `
      <tr>
        <td style="padding:9px 10px 2px">${esc(r.label)}</td>
        <td align="right" style="padding:9px 10px 2px"><b>${esc(String(r.value))}</b></td>
        <td align="right" style="padding:9px 10px 2px">${r.delta || "—"}</td>
      </tr>
      <tr>
        <td colspan="3" style="padding:0 10px 9px;border-bottom:1px solid #f0ede5;
          font-size:12px;line-height:1.5;color:#8a8a8a">${esc(r.note)}</td>
      </tr>`).join("")}
  </table>`;
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
  // Unique people, not the sum of the channel rows. Summing counts anyone
  // who arrived from two channels twice.
  const sum = (d, f) => (d.channels || []).reduce((s, c) => s + f(c), 0);
  const v = (now.totals || {}).visitors || 0;
  const vPrev = (prev.totals || {}).visitors || 0;
  const b = (now.totals || {}).booked || 0;
  const bPrev = (prev.totals || {}).booked || 0;
  const change = vPrev ? ((v - vPrev) / vPrev) * 100 : 0;

  // Each item carries its own supporting numbers, so a claim in the summary
  // can always be traced without scrolling to the tables.
  const wins = [];
  const watch = [];

  const prevBy = Object.fromEntries((prev.channels || []).map((c) => [c.source, c.visitors]));
  const moves = (now.channels || [])
    .filter((c) => c.source !== "not tagged")
    .map((c) => ({ src: c.source, now: c.visitors, was: prevBy[c.source] || 0,
                   booked: c.booked, forms: c.callForms }))
    .filter((m) => m.was >= 20 || m.now >= 20);

  const risers = moves.filter((m) => m.was && m.now > m.was * 1.2)
    .sort((a, z) => (z.now - z.was) - (a.now - a.was));
  const fallers = moves.filter((m) => m.was && m.now < m.was * 0.75)
    .sort((a, z) => (a.now - a.was) - (z.now - z.was));

  if (b > bPrev) {
    wins.push({
      text: `Bookings up ${bPrev} to ${b}`,
      detail: `From ${v} visitors, so ${((b / v) * 100).toFixed(1)}% booked, against ` +
        `${vPrev ? ((bPrev / vPrev) * 100).toFixed(1) : "0"}% last week. ` +
        (breakdown(now.channels, (c) => c.booked) || "no channel detail") + ".",
    });
  }
  if (risers[0]) {
    const r = risers[0];
    wins.push({
      text: `${r.src} traffic up ${Math.round(((r.now - r.was) / r.was) * 100)}%`,
      detail: `${r.was} visitors last week, ${r.now} this week. ` +
        (r.booked ? `${r.booked} of them booked a call.`
                  : "None of them booked a call yet, so this is reach rather than revenue."),
    });
  }
  const overall = sales.totals && sales.totals.closeRate;
  const best = (sales.bySource || [])
    .filter((s) => s.consulted >= 8 && s.source !== "Others")
    .sort((a, z) => (z.closeRate || 0) - (a.closeRate || 0))[0];
  if (best && best.closeRate) {
    wins.push({
      text: `${best.source} closing at ${rate(best.closeRate)} over 90 days`,
      detail: `${best.signed} signed from ${best.consulted} who showed up, out of ${best.leads} ` +
        `leads. Overall close rate across every source is ${rate(overall)}.`,
    });
  }
  if (!wins.length && v) {
    wins.push({
      text: `${v} visitors, steady on last week`,
      detail: `${vPrev} last week. ${breakdown(now.channels, (c) => c.visitors) || "no channel detail"}.`,
    });
  }

  if (fallers[0]) {
    const f = fallers[0];
    watch.push({
      text: `${f.src} traffic down ${Math.round(((f.was - f.now) / f.was) * 100)}%`,
      detail: `${f.was} visitors last week, ${f.now} this week, a loss of ${f.was - f.now}. ` +
        `At your usual booking rate that is roughly ` +
        `${Math.max(1, Math.round((f.was - f.now) * (v ? b / v : 0)))} call(s) not booked.`,
    });
  }
  if (change < -25 && !fallers.length) {
    watch.push({
      text: `Total traffic down ${Math.abs(Math.round(change))}%`,
      detail: `${vPrev} visitors last week, ${v} this week. No single channel explains it, ` +
        "so check whether posting volume changed.",
    });
  }
  if (b === 0 && v > 50) {
    watch.push({
      text: "No calls booked at all this week",
      detail: `${v} visitors and ${(now.totals || {}).callForms || 0} booking form(s) started. ` +
        "If forms were submitted but nothing booked, the Calendly step is where they are dropping.",
    });
  }
  const dead = (now.channels || []).find((c) => c.visitors >= 100 && c.booked === 0 && c.source !== "not tagged");
  if (dead) {
    watch.push({
      text: `${dead.source} sent ${dead.visitors} visitors and booked nobody`,
      detail: `${dead.signups.job_alerts + dead.signups.audit_roadmap} took a free resource and ` +
        `${dead.callForms} started a booking form. Traffic is arriving but not converting.`,
    });
  }
  const untagged = (now.channels || []).find((c) => c.source === "not tagged");
  if (untagged && v && untagged.visitors / v > 0.25) {
    watch.push({
      text: `${Math.round((untagged.visitors / v) * 100)}% of visitors have no source`,
      detail: `${untagged.visitors} of ${v}. Anything from before 14 Aug 2026 can never carry one. ` +
        "If this stays high once the window clears that date, a link you are posting is untagged.",
    });
  }
  if (!watch.length) {
    watch.push({ text: "Nothing needs attention this week", detail: "Every consistency check passed and no channel moved sharply." });
  }

  const headline = !v
    ? "No traffic recorded. If that looks wrong, check the site is still tagging."
    : `${v} visitors (${change >= 0 ? "+" : ""}${Math.round(change)}% on last week), ${b} calls booked.`;

  return [
    { kind: "Overall", items: [{ text: headline,
        detail: `${(now.totals || {}).callForms || 0} booking form(s) started, ` +
          `${sum(now, (c) => c.signups.job_alerts + c.signups.audit_roadmap)} free resource signup(s). ` +
          `Sales figures below cover 90 days, not this week.` }] },
    { kind: "Working", items: wins.slice(0, 2) },
    { kind: "Watch", items: watch.slice(0, 2) },
  ];
}

/**
 * Sanity checks run before every send.
 *
 * The point is not to hide bad numbers but to label them, so a figure that
 * cannot be true is never presented as though it is. Anything that trips
 * appears in a Data quality block at the bottom of the email.
 */
function auditNumbers(now, prev, sales, airtableBookings) {
  const issues = [];

  // A previous window that failed used to come back empty, so every change
  // read as "new" and every rate as "0% last week". Say so instead.
  if (prev && (prev.errors || []).length) {
    issues.push({ level: "warn",
      text: "Last week's figures could not be loaded (" + prev.errors.join("; ") +
        "), so every comparison on this email is against zero and should be ignored." });
  } else if (prev && (!prev.totals || !prev.totals.visitors)) {
    issues.push({ level: "warn",
      text: "Last week returned no data, so the week-on-week changes here are " +
        "meaningless. The numbers for THIS week are still correct." });
  }

  // Channel rows counting one person under several channels.
  const chSum = (now.channels || []).reduce((s, c) => s + c.booked, 0);
  const trueBooked = now.totals ? now.totals.booked : 0;
  if (trueBooked && chSum > trueBooked * 1.15) {
    issues.push({ level: "check",
      text: `The channel table shows ${chSum} bookings against a true ${trueBooked} people. ` +
        "Someone who arrived from two channels is counted under both, so the rows " +
        "add up higher than the total. Headline figures use the true count." });
  }
  const ch = now.channels || [];
  const sum = (f) => ch.reduce((s, c) => s + f(c), 0);

  // Unique people for every comparison, so the audit never argues with itself.
  const T = now.totals || {};
  const visitors = T.visitors || sum((c) => c.visitors);
  const booked = T.booked || sum((c) => c.booked);
  const forms = T.callForms || sum((c) => c.callForms);

  // 1. You cannot confirm a time without first submitting the form.
  if (booked > forms) {
    issues.push({
      level: "check",
      text: `${booked} calls booked but only ${forms} booking forms. Usually timing: ` +
        "someone filled the form just before this window and picked their slot inside it. " +
        "Airtable is the truth for bookings, and it is cross-checked below.",
    });
  }

  // 2. A conversion firing far more often than there are people means the
  //    same person is being counted repeatedly.
  (now.eventRatios || []).forEach((r) => {
    if (r.people >= 5 && r.events / r.people > 2.5) {
      issues.push({
        level: "warn",
        text: `${r.event} fired ${r.events} times for ${r.people} people ` +
          `(${(r.events / r.people).toFixed(1)}x). Totals here count people so they are ` +
          "still right, but the event count is inflated.",
      });
    }
  });

  // 3. A metric that was healthy and is now flat zero usually means something
  //    broke, not that demand vanished overnight.
  const prevSum = (f) => (prev.channels || []).reduce((s, c) => s + f(c), 0);
  [["Job alerts signups", (c) => c.signups.job_alerts],
   ["Discovery call forms", (c) => c.callForms],
   ["Calls booked", (c) => c.booked]].forEach(([label, pick]) => {
    if (sum(pick) === 0 && prevSum(pick) >= 3) {
      issues.push({
        level: "warn",
        text: `${label} dropped to zero from ${prevSum(pick)} last week. ` +
          "That is usually a broken form or a tracking break rather than real demand.",
      });
    }
  });

  // 4. Cross-check GA4 against Airtable, the source of truth for bookings.
  if (airtableBookings != null && booked > 0) {
    const diff = Math.abs(booked - airtableBookings) / Math.max(booked, airtableBookings);
    if (diff > 0.3) {
      issues.push({
        level: "warn",
        text: `GA4 counted ${booked} bookings, Airtable has ${airtableBookings}. ` +
          "Airtable is the truth. A gap this size means bookings are being missed somewhere.",
      });
    }
  }

  // 5. Attribution coverage. Traffic from before 14 Aug 2026 can never carry
  //    a source, so it is excluded rather than reported as a problem forever.
  const LAUNCH = new Date("2026-08-14T00:00:00+10:00");
  const windowStart = new Date(Date.now() - 7 * 86400000);
  const untagged = ch.find((c) => c.source === "not tagged");
  if (untagged && visitors && windowStart >= LAUNCH && untagged.visitors / visitors > 0.25) {
    issues.push({
      level: "warn",
      text: `${Math.round((untagged.visitors / visitors) * 100)}% of visitors arrived with no ` +
        "source, and all of this week is after tagging went live. That points at untagged " +
        "links being posted rather than old traffic.",
    });
  } else if (untagged && visitors && untagged.visitors / visitors > 0.25) {
    issues.push({
      level: "check",
      text: `${untagged.visitors} visitors have no source because they arrived before tagging ` +
        "went live on 14 Aug. Expected, and it disappears once the window clears that date.",
    });
  }

  return issues;
}

function buildHtml(now, prev, when, sales, audit) {
  // Headline numbers come from the undimensioned totals, never from summing
  // the channel rows: a person who arrives from two channels is counted in
  // both, which nearly doubled the booking figure.
  const sumVisitors = (d) => (d.totals ? d.totals.visitors : 0);
  const sumBooked = (d) => (d.totals ? d.totals.booked : 0);
  const sumSignups = (d) => (d.channels || []).reduce(
    (s, c) => s + c.signups.job_alerts + c.signups.audit_roadmap + c.signups.discovery_call, 0);

  const v = sumVisitors(now), vPrev = sumVisitors(prev);
  const b = sumBooked(now), bPrev = sumBooked(prev);

  // Each signup destination on its own row. A lumped total hides the thing
  // that matters, which is whether they took the free stuff or booked a call.
  const bySignup = (d, k) => (d.channels || []).reduce((s, c) => s + c.signups[k], 0);
  const ja = bySignup(now, "job_alerts"), jaPrev = bySignup(prev, "job_alerts");
  const ar = bySignup(now, "audit_roadmap"), arPrev = bySignup(prev, "audit_roadmap");
  // Counted from the discovery_form_submit event itself. Counting it via
  // signup_type would undercount, because that tag is newer than the event
  // and cached pages still fire the old version.
  const dc = now.totals ? now.totals.callForms : 0;
  const dcPrev = prev.totals ? prev.totals.callForms : 0;

  const ch = now.channels || [];
  const t90 = sales.totals || {};
  const untypedLeads = Math.max(0, (now.leadsTotal || 0) - ja - ar);

  const topline = [
    { label: "Visitors", value: v, delta: delta(v, vPrev),
      note: `People, not sessions, counted once each. ${breakdown(ch, (c) => c.visitors) || "no attributed traffic"}.` },
    { label: "→ Job alerts signups", value: ja, delta: delta(ja, jaPrev),
      note: `Completed the weekly job alerts form. ${breakdown(ch, (c) => c.signups.job_alerts) || "none this week"}.` },
    { label: "→ Offer roadmap signups", value: ar, delta: delta(ar, arPrev),
      note: `Gave their email for the free roadmap. ${breakdown(ch, (c) => c.signups.audit_roadmap) || "none this week"}.` +
        (untypedLeads > 0 ? ` A further ${untypedLeads} signup(s) could not be split by type yet.` : "") },
    { label: "→ Discovery call forms", value: dc, delta: delta(dc, dcPrev),
      note: `Submitted the booking form, before picking a time. ${breakdown(ch, (c) => c.callForms) || "none this week"}.` },
    { label: "Calls booked", value: b, delta: delta(b, bPrev),
      note: `Confirmed a time in Calendly, so this is the real number. ${breakdown(ch, (c) => c.booked) || "none this week"}.` },
    { label: "Close rate (90d)", value: rate(t90.closeRate), delta: "",
      note: t90.consulted
        ? `${t90.signed} signed out of ${t90.consulted} who showed up, over 90 days not 7. ` +
          (t90.consulted < 10 ? "Small sample, treat as directional." : "Enough people to be meaningful.")
        : "Nobody has completed a call in this window yet." },
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
        <td valign="top" style="padding:2px 10px 14px 0;white-space:nowrap;
          font-size:11px;letter-spacing:.07em;text-transform:uppercase;
          color:${s.kind === "Watch" ? "#b3541e" : s.kind === "Working" ? "#2e7d52" : "#a08a4e"};
          font-weight:700">${esc(s.kind)}</td>
        <td style="padding:0 0 14px">
          ${s.items.map((it) => `
            <p style="margin:0 0 3px;font-size:15px;line-height:1.45;color:#2b2721">${esc(it.text)}</p>
            <p style="margin:0 0 10px;font-size:12.5px;line-height:1.5;color:#8a8a8a">${esc(it.detail)}</p>
          `).join("")}
        </td>
      </tr>`).join("")}
    </table>

    <h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Topline</h2>
    ${detailTable(topline)}

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

    ${(audit && audit.length) ? `
    <h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Data quality</h2>
    <div style="background:#fff;border:1px solid #e6e2d8;border-radius:8px;padding:4px 16px;margin:0 0 24px">
      ${audit.map((a) => `<p style="margin:12px 0;font-size:13px;line-height:1.55;color:#4a453c">
        <span style="color:${a.level === "warn" ? "#b3541e" : "#a08a4e"};font-weight:700">
        ${a.level === "warn" ? "Check this" : "Note"}</span> &middot; ${esc(a.text)}</p>`).join("")}
    </div>` : `
    <p style="font-size:13px;color:#2e7d52;margin:0 0 24px">All consistency checks passed.</p>`}

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
    // Sequential on purpose. Three windows at once meant thirty concurrent
    // GA4 queries against a cap of ten, and the loser came back empty, which
    // is how last week silently read as zero.
    const now = await gather(7);
    const prev = await gather(7, 7);
    const quarter = await gather(90);
    const audit = auditNumbers(now, prev, quarter.sales, now.airtableBookings);
    const when = `${syd.day} ${syd.month}`;

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: SENDER,
        to: TO,
        subject: `Headstart weekly — week to ${when}`,
        htmlContent: buildHtml(now, prev, when, quarter.sales, audit),
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
