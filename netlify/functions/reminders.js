// reminders.js — dated one-off emails to Fidel.
//
// Runs daily (see netlify.toml). Each morning it checks whether today's date
// in Sydney matches a reminder below and sends that one. Everything else is a
// no-op, so adding a future reminder means adding one entry to REMINDERS.
//
// The cron fires twice, at 23:00 and 00:00 UTC, because 10:00 in Sydney is one
// or the other depending on daylight saving. This hour guard is what makes the
// second firing a no-op, so it and the cron in netlify.toml must agree: change
// one and you must change the other.
const SEND_HOUR = 10;   // Sydney local
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
    const c = (out[k] = out[k] || { visitors: 0, booked: 0, forms: 0 });
    if (dims[1] === "page_view") c.visitors += mets[0];
    if (dims[1] === "invitee_meeting_scheduled") c.booked += mets[0];
    if (dims[1] === "discovery_form_submit") c.forms += mets[0];
  });
  return out;
}

// People who opened the discovery-call page and people who submitted its form,
// over an explicit date window. pagePath rather than landingPage, because the
// question is "of everyone who reached the page", not "of everyone who arrived
// on the site there". The legacy /html/ path is folded in so the denominator
// matches the frozen baseline of 323.
async function discoveryPageStats(startDate, endDate) {
  const rows = await ga4({
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "pagePath" }, { name: "eventName" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: { filter: { fieldName: "eventName",
      inListFilter: { values: ["page_view", "discovery_form_submit"] } } },
    limit: 500,
  });
  let opened = 0, forms = 0;
  rows.forEach(({ dims, mets }) => {
    const [path, ev] = dims;
    if (!String(path).includes("discovery-call")) return;
    if (ev === "page_view") opened += mets[0];
    if (ev === "discovery_form_submit") forms += mets[0];
  });
  return { opened, forms, rate: opened ? (forms / opened) * 100 : 0 };
}

// LinkedIn visitors / form submits / bookings between two dates.
async function linkedinWindow(startDate, endDate) {
  const rows = await ga4({
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "sessionSource" }, { name: "eventName" }],
    metrics: [{ name: "totalUsers" }],
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: EVENTS } } },
    limit: 400,
  });
  const out = { visitors: 0, forms: 0, booked: 0 };
  rows.forEach(({ dims, mets }) => {
    const s = String(dims[0] || "").toLowerCase();
    if (!(s.includes("linkedin") || s.includes("lnkd"))) return;
    if (dims[1] === "page_view") out.visitors += mets[0];
    if (dims[1] === "discovery_form_submit") out.forms += mets[0];
    if (dims[1] === "invitee_meeting_scheduled") out.booked += mets[0];
  });
  return out;
}

/* -------------------------------------------------- consultations --- */

async function consultRows() {
  const fields = ["Name", "Meeting Time", "Raw Notes", "Client Pipeline", "Meeting Link"];
  const out = [];
  let offset = null;
  do {
    const q = `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      `&pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const res = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_CORE_BASE_ID}/${process.env.AIRTABLE_MENTEE_TABLE_ID}${q}`,
      { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_TOKEN}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable failed");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out.map((r) => r.fields).filter((f) => f["Meeting Time"]);
}

// A show-up is a record that moved off "Initial Consultation Booked", or has
// notes. Airtable's own Showed Up Rate formula reads notes alone, which
// under-reads whenever the transcript automation missed a call.
const MOVED = ["Waiting on Contract", "Acquired", "Dropped"];
const isTest = (f) => ["test", "testing"].includes(String(f["Name"] || "").trim().toLowerCase());

function showUp(rows, fromISO, toISO) {
  const now = new Date();
  const s = rows.filter((f) => {
    const d = new Date(f["Meeting Time"]);
    return d <= now && d >= new Date(fromISO) && (!toISO || d < new Date(toISO)) && !isTest(f);
  });
  const showed = s.filter((f) => (f["Raw Notes"] || "").trim() || MOVED.includes(f["Client Pipeline"])).length;
  return { n: s.length, showed, rate: s.length ? (showed / s.length) * 100 : 0 };
}

// Did the link actually reach people? At three weeks this matters more than
// the outcome, because a link nobody received cannot have moved anything.
function linkFill(rows, fromISO) {
  const s = rows.filter((f) => new Date(f["Meeting Time"]) >= new Date(fromISO) && !isTest(f));
  const withLink = s.filter((f) => String(f["Meeting Link"] || "").includes("zoom.us")).length;
  return { n: s.length, withLink, rate: s.length ? (withLink / s.length) * 100 : 0 };
}

const SHIPPED = "2026-08-27";      // join link went into both reminder emails
const BASE_RATE = 75.0;            // 51/68 since 2026-07-09, frozen 27 Aug
const pct1 = (n) => `${n.toFixed(1)}%`;

/* ---- A/B test constants, all frozen 2026-08-27, do not recompute ---- */

// LinkedIn cadence test: 3 posts/week -> 5 posts/week from Mon 31 Aug.
// Detail in Operations/analytics/linkedin-cadence-test.md.
const LI_START = "2026-08-31";
// Measured as ONE aggregate window (27 Jul - 23 Aug), not as summed weeks.
// GA4 totalUsers dedupes inside whatever window you ask for, so summing the
// weekly rows gives 314 while the same span queried whole gives 295. The
// reminders below query one whole window, so the baseline must match that.
const LI_BASE_4WK = { visitors: 295, forms: 5, booked: 5 };
const LI_BASE_RATE = 3.32;         // 51 forms / 1,536 visitors, 15 Jun - 27 Aug
const LI_WIN = 440;                // +50% on 295, the "it worked" line
const LI_LOSS = 235;               // -20% on 295, the "it backfired" line
const LI_MEDIAN_IMPRESSIONS = 5371; // last 20 logged posts, weeks 17-20

// Discovery-call form: 8 required fields -> 5, plus copy, shipped 27 Aug.
// Detail in Operations/analytics/discovery-form-test.md.
const FORM_BASE_RATE = 32.8;       // 106 of 323 over the 60 days to 27 Aug
const FORM_BAND = [25.5, 40.1];    // 95% noise band at n ~ 320 per side


// Morning-of consultation email, 10:00 -> 11:30, shipped 19 Aug.
const MORNING_BASE = 39;           // proxy-corrected, 37 sends to 17 Aug
const MORNING_BAND = [29, 49];

// The Make cap is read live from the API (used + unused), so it is not hardcoded.


// Operations used so far this billing period, from the Make API.
//
// Deliberately the organization endpoint, not /usage: /usage returns one row
// per DAY, so reading its last row gives yesterday's operations and would
// silently understate the month by ~30x. The organization object carries the
// running total and the remainder, and the two add up to the plan's cap, so
// the cap does not have to be hardcoded and cannot drift if the plan changes.
//
// Returns null when Make cannot be reached; the caller treats that as "stay
// quiet" rather than inventing a number.
const MAKE_ORG_ID = process.env.MAKE_ORG_ID || "5933217";

async function makeOps() {
  try {
    const res = await fetch(
      `https://eu1.make.com/api/v2/organizations/${MAKE_ORG_ID}`,
      { headers: { Authorization: `Token ${process.env.MAKE_API_TOKEN}` } });
    if (!res.ok) return null;
    const org = (await res.json()).organization || {};
    const used = Number(org.operations);
    const left = Number(org.unusedOperations);
    if (!Number.isFinite(used) || !Number.isFinite(left)) return null;
    return { used, cap: used + left };
  } catch (err) {
    return null;
  }
}

// /links page: job alerts button removed, LinkedIn promoted to slot two.
// Baseline and bands in Operations/analytics/links-page-test.md. The email
// bodies live in shared/links-test-emails.js to keep this file from growing.
const { gather, buildLinksTestEmail } = require("../shared/links-test-emails");

const LINKS_TEST = (id, date, subject, from, days, verdict) => ({
  id, date, subject,
  async build() {
    const now = await gather(ga4, from, date);
    return buildLinksTestEmail({ verdict, now, days, t: { shell, callout, tbl } });
  },
});

const REMINDERS = [
  LINKS_TEST("links-test-verdict", "2026-09-29",
    "/links verdict: keep or revert", "2026-09-01", 28, true),
  {
    // The join link went into the day-of and 2-hour emails on 27 Aug. Three
    // weeks is ~30 calls, far too few to read the outcome, so this email asks
    // the question that IS answerable: is the link reaching anyone?
    id: "join-link-early",
    date: "2026-09-17",
    subject: "Join link: three-week check",
    async build() {
      const rows = await consultRows();
      const fill = linkFill(rows, SHIPPED);
      const su = showUp(rows, SHIPPED);
      const broken = fill.rate < 80;
      return shell("Early look", "Is the join link actually reaching people?",
        "The link went into the morning-of and 2-hour emails on 27 August. This is a " +
        "three-week check, not a verdict. The show-up number below is on too few calls to " +
        "mean anything yet.",
        callout(broken ? "Fill rate is below 80%, fix this first" : "Fill rate looks healthy",
          `<b>${fill.withLink} of ${fill.n}</b> bookings since 27 August have a real Zoom link ` +
          `on the record (<b>${pct1(fill.rate)}</b>). The link only renders when one is present, ` +
          `so this is the ceiling on how many people could have received it.` +
          (broken ? " The Meeting Time scenario scrapes it off Google Calendar; check module 14's " +
            "<i>parameters</i>, not its mapper." : "")) +
        tbl(["Metric", "Since 27 Aug", "Baseline"], [
          ["Consultations held", su.n, "—"],
          ["Showed up", `<b>${su.showed}</b>`, "—"],
          ["Show-up rate", `<b>${pct1(su.rate)}</b>`, `${BASE_RATE}%`],
        ]) +
        callout("Do not act on that show-up number",
          `At ~10 calls a week this window holds about 30 consultations. That gives a 34% chance ` +
          `of detecting even a +15 point improvement. Anything between <b>60% and 88%</b> is noise. ` +
          `Below 60% means something broke and is worth investigating today. The real read is ` +
          `19 November.`));
    },
  },
  {
    // Twelve weeks, ~120 calls. This is the one that can actually be read.
    id: "join-link-read",
    date: "2026-11-19",
    subject: "Join link: did show-up rate move?",
    async build() {
      const rows = await consultRows();
      const su = showUp(rows, SHIPPED);
      const fill = linkFill(rows, SHIPPED);
      const delta = su.rate - BASE_RATE;
      return shell("The real read", "Twelve weeks of the join link",
        "The Zoom link went into the morning-of and 2-hour reminder emails on 27 August. " +
        "This window is large enough to read.",
        tbl(["Metric", "Since 27 Aug", "Baseline (9 Jul to 27 Aug)"], [
          ["Consultations held", su.n, "68"],
          ["Show-up rate", `<b>${pct1(su.rate)}</b>`, `${BASE_RATE}%`],
          ["Change", `<b>${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts</b>`, "—"],
          ["Bookings with a link on file", `${fill.withLink} of ${fill.n} (${pct1(fill.rate)})`, "15 of 124"],
        ]) +
        callout("Read it against the power, not against zero",
          `At this volume a +10 point move has roughly a 50% chance of showing up as significant, ` +
          `and +15 points about 88%. A small positive that is not significant is still probably ` +
          `real; the test simply cannot prove it. If show-up has dropped below 65%, that is worth ` +
          `taking seriously.`) +
        callout("The confound you agreed to accept",
          "The consultation dropped from 20 minutes to 15 on the same day the link shipped. A " +
          "shorter, lower-commitment call could lift show-up on its own. These two cannot be " +
          "separated after the fact, so treat any gain as the pair of them together."));
    },
  },
  {
    id: "price-hide-review",
    date: "2026-10-19",
    subject: "Eight weeks without a price on the site",
    async build() {
      const pages = await landingStats(56);
      const chans = await channelStats(56);
      const home = pages["/"] || {};
      const landed = home.page_view || 0;
      const forms = home.discovery_form_submit || 0;
      const rate = landed ? forms / landed : 0;

      const chanRows = ["LinkedIn", "Instagram", "Direct", "Other"]
        .filter((k) => chans[k])
        .map((k) => [k, chans[k].visitors,
          pctStr(chans[k].visitors, Object.values(chans).reduce((s, c) => s + c.visitors, 0))]);

      // 602 homepage visitors per arm is the smallest readable effect at this
      // baseline, and it only detects a doubling. Below that, any verdict is
      // a story told about noise.
      const readable = landed >= 602;
      const verdict = !readable
        ? "Not enough traffic to call it — leave the price off and stop watching"
        : rate >= 0.0554 ? "Clear lift, keep the price off"
        : rate <= 0.0246 ? "Clear drop, put the price back"
        : "Inside the noise band, no verdict";

      return shell("Decision", "Did hiding the price do anything?",
        "You removed pricing on 24 August against a baseline of 3.69%. Here is the after-period.",
        callout(verdict,
          `${forms} submits from ${landed} homepage visitors, <b>${pctStr(forms, landed)}</b>, ` +
          `against a 3.69% baseline.`) +
        tbl(["Metric", "Last 8 weeks", "Baseline"], [
          ["Homepage visitors", landed, "2,007 over 10 wks"],
          ["Discovery form submits", `<b>${forms}</b>`, "74"],
          ["Sign-up rate", `<b>${pctStr(forms, landed)}</b>`, "3.69%"],
        ]) +
        `<h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Traffic mix, check this before believing the number</h2>` +
        tbl(["Channel", "Visitors", "Share"], chanRows) +
        callout("How to read it honestly",
          "This is a before-and-after, not a randomised test. At this baseline only a doubling " +
          "or a halving is statistically readable, so the bands above are deliberately wide. " +
          "If the channel mix has shifted much since August the comparison is worthless, because " +
          "LinkedIn and Instagram visitors convert at completely different rates.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        <b>The number that actually decides it</b> is signed clients per 100 homepage visitors,
        baseline 1.34 to 1.43. Sign-up rate alone can rise while the extra people are all
        unqualified. Pull the close rate from Airtable at 14 days matured and multiply.</p>`);
    },
  },
  {
    // Two weeks into the shorter discovery-call form. Far too early to read a
    // rate, so this checks the plumbing and nothing else. Silent unless the
    // form is actually broken: Fidel only wants to hear about a failure, and a
    // reassuring "all fine" email every time trains him to ignore the sender.
    id: "discovery-form-sanity",
    date: "2026-09-10",
    subject: "Discovery form has stopped submitting",
    async build() {
      const now = await discoveryPageStats(SHIPPED, "today");
      // Only a real failure sends. People arriving and nobody getting through
      // is the one thing worth interrupting him for; 20 opens is enough that
      // zero submits cannot be explained by a quiet fortnight.
      if (!(now.forms === 0 && now.opened > 20)) return null;
      return shell("Something is broken", "Nobody has submitted the form in two weeks",
        "You cut the form from 8 required fields to 5 on 27 August. Since then people have " +
        "been opening the page and none of them have got through it.",
        callout("Test the form yourself today",
          `<b>${now.opened}</b> people have opened the page since 27 August and <b>zero</b> ` +
          `have submitted. Fill it in yourself, then check the Netlify form log and the ` +
          `Airtable record it should create. Until this is fixed the 26 October read is dead.`));
    },
  },
  {
    // Twelve weeks, ~60 posts. The only read that touches the real question.
    id: "linkedin-cadence-clients",
    date: "2026-11-23",
    subject: "5x/week: did it actually bring clients?",
    async build() {
      const li = await linkedinWindow(LI_START, "today");
      const rows = await consultRows();
      const su = showUp(rows, LI_START);
      const weeks = 12;
      return shell("The real read", "Twelve weeks of 5 posts a week",
        "This is the question you actually asked in August: more posts, more clients. Twelve " +
        "weeks and roughly 60 posts is the first window where it means anything.",
        tbl(["Metric", "Since 31 Aug (12 wks)", "Baseline rate"], [
          ["LinkedIn visitors", `<b>${li.visitors}</b>`, "~74/week"],
          ["Per week", `<b>${(li.visitors / weeks).toFixed(0)}</b>`, "74"],
          ["Discovery form submits", `<b>${li.forms}</b>`, "~1.3/week (15 expected)"],
          ["Visitor to form rate", `<b>${pctStr(li.forms, li.visitors)}</b>`, `${LI_BASE_RATE}%`],
          ["Calendly bookings", `<b>${li.booked}</b>`, "—"],
        ]) +
        callout("Judge it on form submits per week, not on signed clients",
          `At baseline twelve weeks gives about 15 submits, so a doubling to 30 is readable and ` +
          `anything smaller is not. Signed clients will still be too few to test, which is why ` +
          `submits is the decision metric and clients is the sanity check.`) +
        callout("The sanity check that stops you celebrating junk",
          `LinkedIn consultations closed at <b>44.4%</b> before this test. Pull the current ` +
          `LinkedIn close rate from Airtable at 14 days matured. If volume went up and close ` +
          `rate fell below ~35%, the extra posts bought worse leads and the win is fake. ` +
          `${su.n} consultations have been held since 31 August in total, across all channels.`) +
        callout("What you agreed to accept back in August",
          "The form changed on 27 August, pricing came off the site on 24 August and the price " +
          "was free to move from 24 September. Any sign-up move over this window carries all of " +
          "those. You took that trade knowingly because running them separately would have cost " +
          "a year. Do not relitigate it now, just do not claim cadence caused it on its own."));
    },
  },
  {
    // Sixty days and ~320 page opens on the shorter form. This one is readable.
    id: "discovery-form-read",
    date: "2026-10-26",
    subject: "Shorter form: did sign-up rate move?",
    async build() {
      const now = await discoveryPageStats(SHIPPED, "today");
      const chans = await channelStats(60);
      const [lo, hi] = FORM_BAND;
      const thin = now.opened < 200;
      const verdict = thin ? "Not enough traffic to call it, leave it and check again in a month"
        : now.rate > hi ? "The shorter form worked, keep it"
        : now.rate < lo ? "It got worse, roll the copy back first, not the form"
        : "Inside the noise band, no signal";
      const total = Object.values(chans).reduce((s, c) => s + c.visitors, 0);
      const chanRows = ["LinkedIn", "Instagram", "Direct", "Other"]
        .filter((k) => chans[k])
        .map((k) => [k, chans[k].visitors, pctStr(chans[k].visitors, total)]);

      return shell("Decision", "Sixty days on the shorter discovery-call form",
        "On 27 August the form went from 8 required fields to 5 and the page copy changed. " +
        "Bands below were set that day.",
        callout(verdict,
          `<b>${now.forms}</b> submits from <b>${now.opened}</b> page opens, ` +
          `<b>${pct1(now.rate)}</b>, against a <b>${FORM_BASE_RATE}%</b> baseline. ` +
          `The 95% noise band is <b>${lo}% to ${hi}%</b>.`) +
        tbl(["Metric", "Since 27 Aug", "Baseline (60 days to 27 Aug)"], [
          ["Opened the page", now.opened, "323"],
          ["Submitted", `<b>${now.forms}</b>`, "106"],
          ["Sign-up rate", `<b>${pct1(now.rate)}</b>`, `${FORM_BASE_RATE}%`],
          ["Change", `<b>${now.rate >= FORM_BASE_RATE ? "+" : ""}${(now.rate - FORM_BASE_RATE).toFixed(1)} pts</b>`, "—"],
        ]) +
        callout("If this came back flat, here is the next change",
          "<b>LinkedIn profile URL</b> and <b>where did you find out about us</b> are both still " +
          "required. They were ranked #1 and #2 for expected effect and neither was touched in " +
          "August. The LinkedIn URL makes a mobile user leave the page mid-form, and 60% of this " +
          "traffic is mobile. Drop that one on its own so the result is attributable.") +
        `<h2 style="font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:#6b6455;margin:0 0 10px">Check the mix before believing it</h2>` +
        tbl(["Channel", "Visitors", "Share"], chanRows) +
        callout("Two reasons this could be lying to you",
          "Cold arrivals straight onto the page converted at 26.2%, homepage-warmed at 36.6%. " +
          "The 5x/week LinkedIn test ran over this exact window and changes that mix. Second, " +
          "cross-check against Airtable record creation, since the job-alerts modal also creates " +
          "records and GA4 alone has undercounted before."));
    },
  },
  {
    // Only speaks up if the month is tracking to blow the 10,000 cap. Fidel
    // asked not to be emailed otherwise, so a healthy month is silent.
    id: "make-credits",
    date: "2026-09-24",
    subject: "Make credits are tracking over the cap",
    async build() {
      if (!process.env.MAKE_API_TOKEN) {
        return shell("Cannot check", "Make credits need a manual look this month",
          "This check is meant to stay silent unless you are heading over the cap, but it " +
          "cannot reach Make.",
          callout("Add MAKE_API_TOKEN to the Netlify environment",
            "The token is in <code>~/.headstart/make-api-token.txt</code>. Until it is set, " +
            "open Make and check the operations counter yourself. The cap is 10,000."));
      }
      const usage = await makeOps();
      if (!usage) return null;
      const { used, cap } = usage;
      // Straight-line the month. The period resets on the 1st, so day-of-month
      // is the fraction of the window already consumed.
      const now = new Date();
      const day = now.getUTCDate();
      const inMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
      const projected = Math.round((used / day) * inMonth);
      if (projected <= cap) return null;   // healthy, stay quiet

      return shell("Heading over", "Make is tracking past its operations cap",
        "You asked only to hear about this when it is going to be a problem. It is.",
        callout(`Projected ${projected.toLocaleString()} operations this month`,
          `<b>${used.toLocaleString()}</b> used by day ${day} of ${inMonth}, which straight-lines ` +
          `to <b>${projected.toLocaleString()}</b> against a cap of ` +
          `<b>${cap.toLocaleString()}</b>.`) +
        callout("What worked last time",
          "In August this hit 10,179 and came down to ~8,260 by lengthening polling intervals " +
          "on the scenarios that poll most often. That is the first place to look again."));
    },
  },
  {
    // Two months of the 11:30 send. One month is +/- 14 points at this volume,
    // wide enough that a real improvement and no change look identical.
    id: "morning-email-review",
    date: "2026-10-19",
    subject: "Morning email at 11:30: did opens move?",
    async build() {
      return shell("Decision", "Two months of the 11:30 morning email",
        "The day-of consultation email moved from 10:00 to 11:30 on 19 August, on the theory " +
        "that 10am lands in a pile of overnight mail students skim and forget.",
        callout("Baseline to beat, frozen 19 August",
          `<b>${MORNING_BASE}% open rate</b>, proxy-corrected, over 37 sends from 24 July to ` +
          `17 August. Raw opened/delivered was 33%. Verdict band is ` +
          `<b>${MORNING_BAND[0]}% to ${MORNING_BAND[1]}%</b>; inside it means no signal.`) +
        tbl(["Email", "Open rate", "Note"], [
          ["Consultation: 2 hours before", "88%", "for scale"],
          ["Consultation: booking confirmation", "62%", "for scale"],
          ["<b>Consultation: morning of</b>", `<b>${MORNING_BASE}%</b>`, "the one being tested"],
        ]) +
        callout("Pull the number the same way it was frozen",
          "Use the proxy-corrected figure from the Brevo snapshot tool, not Brevo's headline " +
          "open rate. Apple and corporate scanners open mail nobody read, and the baseline " +
          "excluded them. Comparing a proxy-inflated number against a proxy-excluded baseline " +
          "manufactures a win.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        Detail and the raw events are in <code>Operations/brevo/morning-email-test.md</code>.
        At ~44 sends a month, two months is the first window where a real move is separable
        from noise, so this is a genuine read rather than an early look.</p>`);
    },
  },
  {
    // Six weeks of the "2 posts must cross a top-5 topic with a top-5 hook"
    // rule. Compliance first: a rule nobody followed cannot be judged.
    id: "content-rule-review",
    date: "2026-10-19",
    subject: "LinkedIn content rule: the six-week report",
    async build() {
      return shell("Report", "Six weeks of the two-on-list rule",
        "From Week 23, at least 2 posts a week had to cross a top-5 topic with a top-5 hook. " +
        "This is the review of Weeks 23 to 28.",
        callout("Answer compliance before anything else",
          "Of the 6 weeks, how many actually shipped 2 on-list posts? If the answer is fewer " +
          "than 4, the rule was not tested and the only finding is that it was not followed. " +
          "Do not read performance into a rule that was not run.") +
        tbl(["Frozen baseline", "Value"], [
          ["Median profile views per post", "<b>84</b>"],
          ["Posts in the baseline", "62"],
          ["Mindset + applications + networking share", "<b>58%</b>"],
          ["Target for that share", "under 40%"],
        ]) +
        callout("The three questions this report answers",
          "<b>1.</b> Did the on-list posts beat the 84-view median, and by how much? " +
          "<b>2.</b> Did the topic mix actually move, or is it still 58% concentrated in three " +
          "topics? <b>3.</b> What gets promoted onto the list, and what drops off it?") +
        callout("The caveat that applies to the whole thing",
          "62 posts split across 10 topics and 8 hooks leaves very few posts per cell. Treat a " +
          "topic or hook ranking as a working hypothesis, not a finding, and never kill a topic " +
          "on a single bad week.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        Lists, evidence and the full rule are in
        <code>LinkedIn post execution/weekly-content-rule.md</code>.</p>`);
    },
  },
  {
    // A quarter of mentor-side posts. Deliberately not a page A/B: 5 clicks
    // has no power and the posts differ in everything, not just destination.
    id: "mentor-recruitment-read",
    date: "2026-11-30",
    subject: "Mentor recruitment: the quarter read",
    async build() {
      return shell("Quarter read", "Did mentor posts bring mentors?",
        "First quarter of mentor-side LinkedIn content, measured the only way it can be: " +
        "applications submitted across the quarter against how many mentor posts ran.",
        callout("Count applications, never page against page",
          "Week 21 pointed at <code>/mentor-application</code> and Week 22 at " +
          "<code>/mentor-role</code>, which looks like an A/B and is not one. The posts differ " +
          "in hook, image, copy, week and CTA as well as destination, and the first produced " +
          "5 link clicks. No arrangement of two posts at that volume separates a landing-page " +
          "effect from noise.") +
        tbl(["Baseline, first mentor post ever", "Value"], [
          ["Impressions", "1,497"],
          ["Members reached", "868"],
          ["Link clicks", "<b>5</b>"],
          ["Click rate on reached", "0.58%"],
          ["Followers gained", "0"],
        ]) +
        callout("What a good answer looks like",
          "Applications per post run, across the whole quarter, from any linkedin/post UTM. If " +
          "that number is still near zero after a quarter, the problem is the offer to mentors " +
          "rather than which page they land on."));
    },
  },
  {
    // Three months of /links traffic quality. Underpowered on purpose: this
    // is a baseline that gets watched, not a test with a verdict.
    id: "links-quality-read",
    date: "2026-12-01",
    subject: "/links traffic: is it any good?",
    async build() {
      return shell("Observation", "Three months of /links traffic quality",
        "Not a test and it has no verdict band. Detecting a move from 6.7% to 9% needs about " +
        "three months, which is exactly how long this has run, so this is the first look worth " +
        "taking.",
        callout("Baseline: 6.7% of /links visitors sign up",
          "Anything between roughly 4% and 10% is consistent with no change at all. Resist " +
          "reading a number inside that range as a result, in either direction.") +
        callout("The question underneath it",
          "Instagram converts at 20% against LinkedIn's 44%, and the mix of who arrives " +
          "explains only 3% of that gap. The other 97% is that the same student converts worse " +
          "when they came from Instagram. If /links quality has not moved, that is the finding: " +
          "routing changes do not fix a trust problem."));
    },
  },
  {
    // Fortnightly, not dated: the sales review is a standing habit rather
    // than a one-off decision, and the log has one row per fortnight.
    id: "sales-review",
    every: 14,
    from: "2026-09-17",
    subject: "Sales review: your fortnight is up",
    async build() {
      return shell("Fortnightly", "Time to review the last fortnight of calls",
        "Run the review on Opus. It needs judgement over long transcripts and Sonnet is not " +
        "reliable on them.",
        callout("Start here",
          "<code>python3 \"Operations/sales/pull-consults.py\" --days 14</code><br>" +
          "Then say <b>\"sales review\"</b> in Claude Code and it will follow " +
          "<code>Skills/sales-call-review.md</code>.") +
        callout("Check last fortnight's one change before anything else",
          "The log sets exactly one change each time and the next review's first job is to ask " +
          "whether it actually happened. The baseline change, set on 3 September, was: " +
          "<b>ask for the commitment out loud before any logistics</b>.") +
        tbl(["Baseline, fortnight to 3 Sep", "Value"], [
          ["Consultations held", "15"],
          ["Closed", "4"],
          ["Close rate", "<b>27%</b>"],
          ["Talk time, converted", "52%"],
          ["Talk time, not converted", "65%"],
          ["Target talk time", "<b>30%</b>"],
        ]) +
        callout("The finding the baseline turned up",
          "No assumptive close in any of 15 calls. Every one ended with logistics narrated as a " +
          "fact, so the prospect never had to say yes or no and the decision drifted to " +
          "WhatsApp. 11 of 15 sat in Waiting on Contract.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        Append one row to <code>Operations/sales/review-log.md</code> when you are done. One row
        per fortnight, appended, never rewritten.</p>`);
    },
  },
];

/* ---------------------------------------------------------- handler --- */

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const force = q.force;   // pass ?force=<id> to send one immediately
  const dry = q.dry === "1"; // build the email and return it, send nothing

  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "numeric", hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;

  // A reminder is due either on a fixed `date`, or every `every` days counting
  // from `from` (the fortnightly sales review). Recurrence is computed in whole
  // Sydney days so daylight saving cannot shift it by one.
  const DAY = 86400000;
  const isDue = (r) => {
    if (r.date) return r.date === today;
    if (!r.every || !r.from) return false;
    const days = Math.round((Date.parse(today) - Date.parse(r.from)) / DAY);
    return days >= 0 && days % r.every === 0;
  };

  // All reminders due today, not just the first. Two tests landing on the same
  // date is a normal thing to happen, and a silently dropped reminder is the
  // worst possible failure here: nobody finds out until the window has closed.
  const due = force
    ? REMINDERS.filter((r) => r.id === force)
    : (Number(parts.hour) === SEND_HOUR ? REMINDERS.filter(isDue) : []);

  if (!due.length) return { statusCode: 200, body: `Nothing due (${today}, hour ${parts.hour}).` };
  if (!process.env.BREVO_API_KEY) return { statusCode: 500, body: "BREVO_API_KEY missing" };

  // ?force=<id>&dry=1 renders the email and returns it without sending, so a
  // new reminder can be proof-read against live data before its date arrives.
  if (dry) {
    const r = due[0];
    try {
      return { statusCode: 200, headers: { "Content-Type": "text/html" }, body: await r.build() };
    } catch (err) {
      return { statusCode: 500, body: `${r.id} failed to build: ${err.message}` };
    }
  }

  const sent = [], failed = [], quiet = [];
  for (const r of due) {
    try {
      const html = await r.build();
      // A build() may return null to mean "checked, nothing worth an email".
      // Used by the checks Fidel only wants to hear about when they fail, so
      // silence is the healthy state and the inbox stays worth reading.
      if (!html) { quiet.push(r.id); continue; }
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ sender: SENDER, to: TO, subject: r.subject, htmlContent: html }),
      });
      if (!res.ok) failed.push(`${r.id}: Brevo rejected ${(await res.text()).slice(0, 120)}`);
      else sent.push(r.id);
    } catch (err) {
      failed.push(`${r.id}: ${err.message}`);
    }
  }

  // One reminder failing must not stop the others, but it still has to be a
  // visible failure so a broken GA4 query does not pass as a quiet success.
  return {
    statusCode: failed.length ? 502 : 200,
    body: `Sent: ${sent.join(", ") || "none"}.` +
      (quiet.length ? ` Checked, nothing to report: ${quiet.join(", ")}.` : "") +
      (failed.length ? ` Failed: ${failed.join(" | ")}` : ""),
  };
};
