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

const REMINDERS = [
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
    // Price came off the site 2026-08-24. Fidel stayed on $55 for a month on
    // purpose, so the close rate has one cause instead of two: a drop in the
    // same window as both changes could not be blamed on either.
    id: "price-55-hold-ends",
    date: "2026-09-24",
    subject: "Your month on $55 is done",
    async build() {
      const pages = await landingStats(28);
      const home = pages["/"] || {};
      const landed = home.page_view || 0;
      const forms = home.discovery_form_submit || 0;

      return shell("Hold expired", "You held $55 for the month, that month is done",
        "Pricing came off the site on 24 August and you stayed on $55 so the close rate would " +
        "have one cause, not two. You are now free to move the price if you want to.",
        callout("Baseline to beat, frozen 24 August",
          "Sign-up rate <b>3.69%</b> of homepage visitors. Close rate <b>38.7%</b> at $55. " +
          "Combined, <b>1.34 to 1.43 signed clients per 100 homepage visitors</b>.") +
        tbl(["Metric", "Since the price came off", ""], [
          ["Homepage visitors", landed, ""],
          ["Discovery form submits", `<b>${forms}</b>`, ""],
          ["Sign-up rate", `<b>${pctStr(forms, landed)}</b>`, "was 3.69%"],
        ]) +
        callout("Before you move off $55",
          "The sign-up number above is the clean one, since a hidden price cannot be affected " +
          "by the level you charge. Read it now and write it down, because the moment you leave " +
          "$55 the close rate carries both changes and stops being readable on its own.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        Close rate is in Airtable, not here, and it needs a maturity cutoff. Anyone consulted in
        the last fortnight has not had time to sign, so counting them drags the recent cohort
        down. Compare at 14 days matured or you will scare yourself with a fake drop.</p>`);
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
  {
    // Two weeks into the shorter discovery-call form. Far too early to read a
    // rate, but a form that silently stopped submitting would cost eight weeks
    // of the test, so this checks the plumbing and nothing else.
    id: "discovery-form-sanity",
    date: "2026-09-10",
    subject: "Discovery form: is it still submitting?",
    async build() {
      const now = await discoveryPageStats(SHIPPED, "today");
      const dead = now.forms === 0 && now.opened > 20;
      return shell("Plumbing check", "Two weeks on the shorter form",
        "You cut the form from 8 required fields to 5 on 27 August and changed the page copy " +
        "at the same time. This is not a result, it is a check that submissions are still " +
        "reaching Netlify and Airtable.",
        callout(dead ? "Nothing has submitted, go and test the form yourself today"
                     : "Submissions are coming through",
          `<b>${now.forms}</b> submits from <b>${now.opened}</b> people who opened the page ` +
          `since 27 August.` + (dead
            ? " People are opening the page and nobody is getting through. Fill the form in " +
              "yourself and check the Netlify form log before anything else."
            : " That is enough to say the form works. It is nowhere near enough to say " +
              "whether it works <i>better</i>.")) +
        callout("Do not read the rate below",
          `It will say something like <b>${pct1(now.rate)}</b> against a ${FORM_BASE_RATE}% ` +
          `baseline. On two weeks of traffic that number swings by 10 points on chance alone. ` +
          `The real read is <b>26 October</b>, at roughly 320 page opens.`) +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        Also worth remembering: <b>LinkedIn profile URL</b> and <b>where did you find out about
        us</b> are both still required. Those were ranked #1 and #2 for expected effect and
        neither was touched. They are the next change if October comes back flat.</p>`);
    },
  },
  {
    // Midpoint of the 5x/week month. The only honest questions at two weeks are
    // "did the cadence actually happen" and "did per-post reach collapse".
    id: "linkedin-cadence-midpoint",
    date: "2026-09-14",
    subject: "5x/week: are you actually doing it?",
    async build() {
      const li = await linkedinWindow(LI_START, "today");
      return shell("Midpoint", "Two weeks of 5 posts a week",
        "You moved from ~3 posts a week to 5 on 31 August. This is a compliance check, not a " +
        "verdict. Nothing about client numbers can be read for another ten weeks.",
        callout("Question 1: have you published 10 posts since 31 August?",
          "Only you can answer this, it is not in GA4. A cadence test where the cadence never " +
          "happened is the single most likely way this dies. If you are behind, the honest move " +
          "is to reset the start date rather than pretend.") +
        callout("Question 2: did per-post reach collapse?",
          `Baseline median is <b>${LI_MEDIAN_IMPRESSIONS.toLocaleString()} impressions per post</b> ` +
          `across your last 20 posts. Open LinkedIn analytics and take the median of the posts ` +
          `since 31 August. <b>Below ~2,700</b> means the extra posts are cannibalising each ` +
          `other and total reach will not move however many you publish. Use the median, not the ` +
          `average, or one viral post will hide the problem.`) +
        tbl(["LinkedIn traffic", "Since 31 Aug", "Same length before"], [
          ["Visitors", `<b>${li.visitors}</b>`, `${LI_BASE_4WK.visitors} over 4 weeks`],
          ["Discovery form submits", `<b>${li.forms}</b>`, LI_BASE_4WK.forms],
          ["Calendly bookings", `<b>${li.booked}</b>`, LI_BASE_4WK.booked],
        ]) +
        `<p style="font-size:13px;color:#8a8a8a;line-height:1.6">Those traffic numbers are here
        for early warning only. Two weeks against a four-week baseline is not a comparison. The
        verdict email is 28 September.</p>`);
    },
  },
  {
    // Four weeks, ~20 posts. Traffic is readable at this volume. Sign-ups are
    // not, and clients are nowhere close, so the email says so loudly.
    id: "linkedin-cadence-verdict",
    date: "2026-09-28",
    subject: "5x/week: the four-week verdict",
    async build() {
      const li = await linkedinWindow(LI_START, "today");
      const v = li.visitors;
      const verdict = v > LI_WIN ? "Cadence is working on reach, keep going"
        : v < LI_LOSS ? "Posting more made it worse, go back to 3x"
        : "Inside the noise band, no signal, keep going";
      const delta = v - LI_BASE_4WK.visitors;
      return shell("Verdict", "Four weeks at 5 posts a week",
        "Bands were set on 27 August, before you started, so this cannot be rationalised now. " +
        "Traffic is the only thing four weeks can settle.",
        callout(verdict,
          `<b>${v}</b> LinkedIn visitors against a matched four-week baseline of ` +
          `<b>${LI_BASE_4WK.visitors}</b> (${delta >= 0 ? "+" : ""}${delta}). ` +
          `Bands: above ${LI_WIN} is a win, below ${LI_LOSS} is a loss, ` +
          `anything between is noise.`) +
        tbl(["Metric", "31 Aug to 27 Sep", "Baseline (27 Jul to 23 Aug)"], [
          ["LinkedIn visitors", `<b>${v}</b>`, LI_BASE_4WK.visitors],
          ["Discovery form submits", `<b>${li.forms}</b>`, LI_BASE_4WK.forms],
          ["Calendly bookings", `<b>${li.booked}</b>`, LI_BASE_4WK.booked],
          ["Visitor to form rate", `<b>${pctStr(li.forms, v)}</b>`, `${LI_BASE_RATE}% over 11 wks`],
        ]) +
        callout("Do not call the sign-up question today",
          `Your baseline is <b>${LI_BASE_4WK.forms} form submits in four weeks</b>. Even a ` +
          `doubling of that sits around p = 0.15, which is not a result. And at roughly one ` +
          `LinkedIn client a fortnight, four weeks is two clients. There is no arithmetic that ` +
          `makes "did it bring more clients" answerable in September. That read is ` +
          `<b>23 November</b>.`) +
        callout("Two things that could be faking this number",
          "LinkedIn traffic was already falling ~4x, from ~290/week in late June to ~76/week in " +
          "August. A rebound towards June levels is just as easily regression to the mean as it " +
          "is your cadence. And the discovery-call form changed on 27 August, so form submits " +
          "carry both changes. Visitors is the clean metric; submits is not.") +
        `<p style="font-size:14px;line-height:1.65;color:#4a453c;margin:0 0 8px">
        <b>Also take the median impressions per post</b> from LinkedIn analytics and write it
        down. Baseline is ${LI_MEDIAN_IMPRESSIONS.toLocaleString()}. If total traffic rose but the
        median halved, you are buying reach with volume and that does not scale past 5.</p>`);
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

  // All reminders due today, not just the first. Two tests landing on the same
  // date is a normal thing to happen, and a silently dropped reminder is the
  // worst possible failure here: nobody finds out until the window has closed.
  const due = force
    ? REMINDERS.filter((r) => r.id === force)
    : (Number(parts.hour) === 6 ? REMINDERS.filter((r) => r.date === today) : []);

  if (!due.length) return { statusCode: 200, body: `Nothing due (${today}, hour ${parts.hour}).` };
  if (!process.env.BREVO_API_KEY) return { statusCode: 500, body: "BREVO_API_KEY missing" };

  const sent = [], failed = [];
  for (const r of due) {
    try {
      const html = await r.build();
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
      (failed.length ? ` Failed: ${failed.join(" | ")}` : ""),
  };
};
