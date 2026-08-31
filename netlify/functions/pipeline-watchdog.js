// pipeline-watchdog.js — watches the lead pipeline end to end and emails only
// when something is actually broken.
//
// Why this exists. On 26 August 2026 Netlify auto-disabled the outgoing
// webhook on the mentee-signup form. Make never saw another submission, so the
// "Mentee SignUps Form" scenario simply stopped being triggered. It did not
// error, because it never ran. Make can only tell you about a scenario that
// failed while running, so nothing was reported, and six people booked
// consultations that never reached the CRM. It was found five days later by
// noticing the Calls page was empty.
//
// The lesson is that watching the automations is the wrong thing to watch. A
// scenario that never fires looks exactly like a quiet week. So this watches
// the OUTCOME instead: every signup that arrived should have a client record.
// If one does not, something in the chain is broken and it does not matter
// which link it was.
//
// Four checks, cheapest first:
//
//   A  Netlify form webhooks that Netlify has disabled or marked failing.
//      This is the exact failure above, caught directly.
//   B  Reconciliation. Signups on the form in the last 48 hours with no
//      matching client record in Airtable. Catches a break anywhere in the
//      chain, including ones nobody has thought of yet.
//   C  Make scenarios that have been deactivated or are invalid.
//   D  Make executions that errored in the last 24 hours.
//
// Costs no Make operations. Reading the Make API is not an operation, and
// nothing here runs inside Make.
//
// Manual run, always reports:  /.netlify/functions/pipeline-watchdog?force=1

const SITE_ID = "0d9f1de6-3df0-4cbc-822e-efa03a90cb64";
const SIGNUP_FORM_ID = "6933e1e062ef24000841d165";
const MAKE_BASE = "https://eu1.make.com/api/v2";
const MAKE_TEAM_ID = 610179;

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TO = [{ email: "fidelhon@gmail.com", name: "Fidel" }];

// Scenarios that are meant to be switched off. Anything else found inactive is
// a problem worth an email.
const KNOWN_INACTIVE = new Set(["Integration Netlify, Gmail", "Integration Webhooks"]);

// How far back reconciliation looks. Longer than the gap between runs so a
// problem is not missed if one run fails.
const RECON_HOURS = 48;

// A submission needs time to travel the chain before it counts as missing.
// Make is usually sub-second, but a queued run or a retry can take minutes.
const GRACE_MINUTES = 20;

const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body) });

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function getJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} on ${url.split("?")[0]}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON reply from ${url.split("?")[0]}: ${text.slice(0, 120)}`);
  }
}

const netlify = (path) =>
  getJson(`https://api.netlify.com/api/v1${path}`, {
    Authorization: `Bearer ${process.env.NETLIFY_API_TOKEN}`,
  });

const make = (path) =>
  getJson(`${MAKE_BASE}${path}`, {
    Authorization: `Token ${process.env.MAKE_API_TOKEN}`,
  });

/**
 * A: form webhooks Netlify has given up on.
 *
 * Netlify disables an outgoing webhook after repeated failed deliveries and
 * tells nobody. A dead hook here means submissions are landing in Netlify and
 * going nowhere.
 *
 * A form can legitimately carry a dead hook alongside a live replacement, so a
 * broken one is only reported when no healthy hook covers the same form.
 */
async function checkWebhooks() {
  const hooks = await netlify(`/hooks?site_id=${SITE_ID}`);
  const formHooks = hooks.filter(
    (h) => h.event === "submission_created" && h.type === "url");

  const healthyForms = new Set(
    formHooks
      .filter((h) => !h.disabled && h.success !== false)
      .map((h) => h.form_id || "all"));

  return formHooks
    .filter((h) => (h.disabled || h.success === false) &&
                   !healthyForms.has(h.form_id || "all"))
    .map((h) => ({
      title: `Form webhook dead: ${h.form_name || h.form_id || "all forms"}`,
      detail: `Netlify ${h.disabled ? "disabled" : "is failing to deliver"} this hook` +
              `${h.updated_at ? ` (since ${h.updated_at.slice(0, 16).replace("T", " ")} UTC)` : ""}. ` +
              `Submissions to this form are not reaching ${h.data && h.data.url ? h.data.url : "its destination"}. ` +
              `Fix: delete the hook and recreate it, a disabled hook cannot be re-enabled.`,
    }));
}

/**
 * B: the reconciliation, and the check that actually matters.
 *
 * Every mentee-signup submission should produce a client record keyed on the
 * email. Anything sitting on the form with no record behind it fell through a
 * gap, whichever gap that was.
 */
async function checkSignupRecon() {
  const since = Date.now() - RECON_HOURS * 3600 * 1000;
  const cutoff = Date.now() - GRACE_MINUTES * 60 * 1000;

  const subs = await netlify(`/forms/${SIGNUP_FORM_ID}/submissions?per_page=100`);

  // One person submitting three times is one person, not three problems.
  const recent = new Map();
  for (const s of subs) {
    const at = Date.parse(s.created_at);
    if (!(at >= since && at <= cutoff)) continue;
    const email = String((s.data && s.data.email) || "").trim().toLowerCase();
    if (!email) continue;
    if (!recent.has(email)) {
      recent.set(email, { email, name: (s.data && s.data.name) || "", at: s.created_at });
    }
  }
  if (!recent.size) return [];

  const emails = [...recent.keys()];
  const formula = `OR(${emails.map((e) => `LOWER({Gmail})="${e.replace(/"/g, '\\"')}"`).join(",")})`;
  const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_CORE_BASE_ID}/` +
    `${process.env.AIRTABLE_MENTEE_TABLE_ID}?pageSize=100` +
    `&fields%5B%5D=Gmail&filterByFormula=${encodeURIComponent(formula)}`;
  const found = await getJson(url, { Authorization: `Bearer ${process.env.AIRTABLE_API_TOKEN}` });

  const have = new Set((found.records || [])
    .map((r) => String(r.fields.Gmail || "").trim().toLowerCase()));

  const missing = [...recent.values()].filter((p) => !have.has(p.email));
  if (!missing.length) return [];

  return [{
    title: `${missing.length} signup${missing.length > 1 ? "s" : ""} never reached the CRM`,
    detail:
      `These people filled in the signup form but have no client record, so they ` +
      `will not appear on the Calls page even after they book:<br><br>` +
      missing.map((p) =>
        `&nbsp;&nbsp;• <strong>${esc(p.name || "(no name)")}</strong> — ${esc(p.email)} ` +
        `<span style="color:#777">(${esc(p.at.slice(0, 16).replace("T", " "))} UTC)</span>`
      ).join("<br>"),
  }];
}

/** C: scenarios switched off or broken. */
async function checkScenarios() {
  const data = await make(`/scenarios?teamId=${MAKE_TEAM_ID}&pg%5Blimit%5D=100`);
  const out = [];
  for (const s of data.scenarios || []) {
    if (s.isinvalid) {
      out.push({
        title: `Make scenario is invalid: ${s.name}`,
        detail: "Make has flagged this scenario as misconfigured, so it will not run.",
      });
    }
    if (!s.isActive && !KNOWN_INACTIVE.has(s.name)) {
      out.push({
        title: `Make scenario is switched off: ${s.name}`,
        detail: "This scenario should be running and is not. Turn it back on in Make, " +
                "then work out what switched it off.",
      });
    }
  }
  return out;
}

/** D: runs that errored in the last day. */
async function checkErrors() {
  const data = await make(`/scenarios?teamId=${MAKE_TEAM_ID}&pg%5Blimit%5D=100`);
  const active = (data.scenarios || []).filter((s) => s.isActive);
  const since = Date.now() - 24 * 3600 * 1000;
  const out = [];

  const results = await Promise.allSettled(
    active.map(async (s) => {
      const logs = await make(`/scenarios/${s.id}/logs?pg%5Blimit%5D=20`);
      // status 1 is a clean run. Anything else ran and went wrong.
      const bad = (logs.scenarioLogs || []).filter(
        (l) => l.status != null && l.status !== 1 && Date.parse(l.timestamp) >= since);
      return { name: s.name, bad };
    }));

  for (const r of results) {
    if (r.status !== "fulfilled" || !r.value.bad.length) continue;
    const { name, bad } = r.value;
    out.push({
      title: `${bad.length} failed run${bad.length > 1 ? "s" : ""} in 24h: ${name}`,
      detail: `Most recent ${esc(bad[0].timestamp.slice(0, 16).replace("T", " "))} UTC. ` +
              `Open the scenario history in Make to see the error.`,
    });
  }
  return out;
}

function buildHtml(problems, ran) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f7;
    font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1d1f">
    <div style="max-width:640px;margin:0 auto;padding:28px 22px">
      <p style="margin:0 0 4px;font-size:13px;color:#86868b;letter-spacing:.04em;
        text-transform:uppercase">Pipeline watchdog</p>
      <h1 style="margin:0 0 18px;font-size:23px;line-height:1.25">
        ${problems.length} problem${problems.length > 1 ? "s" : ""} in the lead pipeline</h1>
      ${problems.map((p) => `
        <div style="background:#fff;border:1px solid #e4e4e7;border-left:3px solid #d13b3b;
          border-radius:8px;padding:15px 17px;margin:0 0 11px">
          <p style="margin:0 0 7px;font-size:15px;font-weight:600">${esc(p.title)}</p>
          <p style="margin:0;font-size:14px;line-height:1.55;color:#3c3c43">${p.detail}</p>
        </div>`).join("")}
      <p style="margin:20px 0 0;font-size:12px;line-height:1.6;color:#86868b">
        Checked ${esc(ran)} UTC. This email is only sent when something is wrong, and
        repeats every 2 hours until it is fixed.</p>
    </div></body></html>`;
}

exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const force = String(q.force || "") === "1";

  for (const key of ["NETLIFY_API_TOKEN", "MAKE_API_TOKEN", "AIRTABLE_API_TOKEN",
                     "AIRTABLE_CORE_BASE_ID", "AIRTABLE_MENTEE_TABLE_ID", "BREVO_API_KEY"]) {
    if (!process.env[key]) return json(500, { error: `${key} is not set` });
  }

  const problems = [];

  // A failing check is itself worth knowing about, so it is reported rather
  // than allowed to take the whole run down with it.
  const checks = [
    ["webhooks", checkWebhooks],
    ["signup reconciliation", checkSignupRecon],
    ["scenario status", checkScenarios],
    ["scenario errors", checkErrors],
  ];
  for (const [name, fn] of checks) {
    try {
      problems.push(...(await fn()));
    } catch (err) {
      problems.push({
        title: `Watchdog check failed: ${name}`,
        detail: `The check itself could not run, so this area is currently unwatched. ` +
                `${esc(err.message)}`,
      });
    }
  }

  const ran = new Date().toISOString().slice(0, 16).replace("T", " ");

  // force=1 posts a fake problem so the whole path, including Brevo delivery,
  // can be proven end to end without waiting for something to actually break.
  if (force && !problems.length) {
    problems.push({
      title: "Test alert, nothing is wrong",
      detail: "You triggered this with ?force=1. Seeing it means the watchdog can " +
              "reach Netlify, Make, Airtable and Brevo, and that a real alert would " +
              "arrive the same way.",
    });
  }

  if (!problems.length) {
    return json(200, { ok: true, problems: 0, ran });
  }

  if (String(q.dryRun || "") === "1") {
    return json(200, { ok: false, problems: problems.length, ran, detail: problems });
  }

  const subject = problems.length === 1
    ? `Pipeline problem: ${problems[0].title}`
    : `Pipeline: ${problems.length} problems need you`;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: SENDER, to: TO, subject, htmlContent: buildHtml(problems, ran) }),
  });
  if (!res.ok) {
    return json(502, { error: "Brevo rejected the email: " + (await res.text()).slice(0, 300) });
  }
  return json(200, { ok: false, problems: problems.length, ran, emailed: true, force });
};
