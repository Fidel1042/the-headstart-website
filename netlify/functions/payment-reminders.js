// payment-reminders.js — scheduled nudge for declined cards.
// Emails Fidel once a day, the morning after a charge fails, listing every
// mentee still sitting at "Failed" so he can chase them and retry.
//
// Runs hourly (netlify.toml) but only sends in the Melbourne 9am window, so a
// failure from yesterday's 5:15pm charge run lands first thing the next day.
// Manual dry run (no email, ignores the time window):
//   /.netlify/functions/payment-reminders?dryRun=1

const { fetchByStatus, groupByMentee } = require("../shared/charge-engine");
const { chaseMessage } = require("../shared/chase-message");

const TZ = "Australia/Sydney";
const SEND_HOUR = 9;
const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TO = { email: "fidelhon@gmail.com", name: "Fidel" };

function melbNow() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  return { hour: parseInt(get("hour"), 10) % 24, minute: parseInt(get("minute"), 10) };
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function buildEmail(groups, total) {
  const rows = groups.map((g) => `
    <tr>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${esc(g.name)}</td>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">$${g.total.toFixed(2)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e6e1d5;color:#c62828">${esc(g.reason || "declined")}</td>
    </tr>`).join("");

  return `<p>Hi Fidel,</p>` +
    `<p><strong>${groups.length} card${groups.length === 1 ? "" : "s"} still declined</strong>, $${total.toFixed(2)} outstanding.</p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    `<tr><th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Mentee</th>` +
    `<th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Amount</th>` +
    `<th align="left" style="padding:0 0 8px;border-bottom:2px solid #d9d3c4">Reason</th></tr>` +
    rows + `</table>` +
    `<p>Chase them from the billing page, then hit "Retry all now" once they've topped up.</p>` +
    `<p style="font-size:13px;color:#777">Message to send:<br>` +
    `<span style="display:block;margin-top:6px;padding:10px 12px;border:1px solid #d9d3c4;border-radius:8px;background:#faf8f2;white-space:pre-wrap">${esc(chaseMessage(groups[0].name, groups[0].total, groups[0].reason))}</span></p>`;
}

exports.handler = async (event) => {
  const dryRun = Boolean(event && event.queryStringParameters && event.queryStringParameters.dryRun);
  const m = melbNow();
  if (!dryRun && !(m.hour === SEND_HOUR && m.minute === 0)) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, melb: m }) };
  }

  try {
    const groups = groupByMentee(await fetchByStatus("Failed"));
    if (!groups.length) {
      return { statusCode: 200, body: JSON.stringify({ dryRun, failed: 0, sent: false }) };
    }

    const total = groups.reduce((s, g) => s + g.total, 0);
    let sent = false;
    if (!dryRun && process.env.BREVO_API_KEY) {
      await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: SENDER, to: [TO],
          subject: `${groups.length} declined card${groups.length === 1 ? "" : "s"} to chase — $${total.toFixed(2)}`,
          htmlContent: buildEmail(groups, total),
        }),
      });
      sent = true;
    }

    return { statusCode: 200, body: JSON.stringify({
      dryRun, sent, failed: groups.length, total: parseFloat(total.toFixed(2)),
      mentees: groups.map((g) => ({ name: g.name, total: g.total, reason: g.reason })),
    }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Payment reminder failed" }) };
  }
};
