// mark-no-show.js — flip a consultation to No show from the Calls page and
// send the follow-up straight away.
//
// Before this, marking a no-show meant opening Airtable, finding the row and
// changing Client Pipeline by hand. The Make scenario named "Rescheduling"
// then polled every 30 minutes and sent the email. That works, but it means
// leaving the page you are already on, on the one day you are busiest.
//
// This does both halves in one click, on the record you are already looking at.
//
// The Make scenario stays exactly as it is, deliberately. It looks for
// Client Pipeline = 'No show' AND No Show Email Sent != 'Yes', so:
//
//   email sent here     -> No Show Email Sent = Yes -> Make finds nothing, no
//                          second email
//   email failed here   -> flag left blank          -> Make retries within 30
//                          minutes and covers for us
//
// So the flag is only ever written after Brevo has accepted the send. Writing
// it first would turn a transient Brevo failure into a mentee who is marked as
// emailed and never hears anything.

const { requireOwner } = require("../shared/require-owner");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// Same sender, subject and copy as the Make scenario, so a mentee cannot tell
// which path sent it and the two never drift into two different voices.
const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };
const REBOOK = "https://calendly.com/fidelhon/30min";

/** "Monday 1 September, 2:15 PM" in Sydney, matching the Make formatDate. */
function sydneyWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod || "").toUpperCase()}`;
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function body(firstName, when) {
  const slot = when ? ` set for ${esc(when)}` : "";
  return `Hi ${esc(firstName || "there")},
<br><br>
We had your consultation${slot}, but I didn't manage to catch you. Life gets busy, completely understand.
<br><br>
If you're still keen to get a clear read on what's holding your job search back, you can reschedule here:
<br><br>
${REBOOK}
<br><br>
Genuinely would love to help you get your first job in Australia.
<br><br>
Cheers,<br>
<strong>Fidel</strong>`;
}

async function airtable(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) return json(403, { error: auth.error });

  const recordId = String(p.recordId || "").trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(recordId)) {
    return json(400, { error: "A valid record id is required" });
  }

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTEE_TABLE_ID: table, BREVO_API_KEY: brevo } = process.env;
  if (!token || !base || !table) return json(500, { error: "Airtable env vars are not set" });

  const target = `${base}/${table}/${recordId}`;

  try {
    const before = await airtable(target, {}, token);
    const f = before.fields || {};

    // Already done. Say so rather than sending a second email.
    if ((f["Client Pipeline"] || "") === "No show" && (f["No Show Email Sent"] || "") === "Yes") {
      return json(200, { ok: true, already: true, name: f["Name"] || "", emailed: false });
    }

    await airtable(target, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "Client Pipeline": "No show" } }),
    }, token);

    const to = String(f["Gmail"] || "").trim();
    if (!to) {
      return json(200, { ok: true, name: f["Name"] || "", emailed: false,
                         note: "Marked as no-show. No email address on the record." });
    }
    if (!brevo) {
      return json(200, { ok: true, name: f["Name"] || "", emailed: false,
                         note: "Marked as no-show. BREVO_API_KEY is not set, so no email." });
    }

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevo, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: SENDER,
        replyTo: SENDER,
        to: [{ email: to, name: f["First Name"] || f["Name"] || "" }],
        subject: "Missed you on the Consultation",
        htmlContent: body(f["First Name"], sydneyWhen(f["Meeting Time"])),
      }),
    });

    if (!res.ok) {
      // Marked, but not emailed. The flag stays blank on purpose so the Make
      // scenario picks this up on its next pass.
      return json(200, { ok: true, name: f["Name"] || "", emailed: false,
                         note: "Marked as no-show. The email failed, Make will retry within 30 minutes." });
    }

    await airtable(target, {
      method: "PATCH",
      body: JSON.stringify({ fields: { "No Show Email Sent": "Yes" } }),
    }, token);

    return json(200, { ok: true, name: f["Name"] || "", emailed: true, to });
  } catch (err) {
    return json(502, { error: err.message || "Could not mark as no-show" });
  }
};
