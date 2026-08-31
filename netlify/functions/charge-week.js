// charge-week.js
// The weekly mentee charge. Groups every "Pending" session by mentee and
// creates ONE combined Stripe charge per mentee for the week. On success the
// mentee's sessions are marked "Charged"; on a decline they're marked "Failed"
// and listed in the summary email. Retry those from the billing page's
// "Retry failed charges" button once the mentee has topped up.
//
// The shared charging machinery lives in ../shared/charge-engine.js so this and
// retry-failed.js can never disagree about what counts as paid.
//
// Protected two ways:
//   1. caller email must be in OWNERS
//   2. caller must send the correct passphrase (env BILLING_PASSCODE)
// This guards the only endpoint that moves real money.

const Stripe = require("stripe");
const { requireOwner } = require("../shared/require-owner");
const {
  OWNERS, authorise, fetchByStatus, groupByMentee,
  chargeGroups, writeResults, summarise,
} = require("../shared/charge-engine");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const adminEmail = (payload.adminEmail || "").toLowerCase().trim();
  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Not authorised" }) };
  }
  const denied = authorise(payload);
  if (denied) return { statusCode: 403, headers, body: JSON.stringify({ error: denied }) };

  const { BREVO_API_KEY } = process.env;
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  let groups;
  try {
    groups = groupByMentee(await fetchByStatus("Pending"));
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  if (!groups.length) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "No pending sessions to charge." }) };
  }

  const results = await chargeGroups(groups, stripe, "weekly");
  await writeResults(results);

  const { charged, failed, chargedTotal, failedTotal } = summarise(results);

  const today = new Date();
  const weekLabel = today.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  if (BREVO_API_KEY) {
    const row = (r, ok) => `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${r.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">${r.sessionIds.length}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">$${r.total.toFixed(2)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;color:${ok ? "#2e7d32" : "#c62828"};">${ok ? "✓ Charged" : "✗ " + r.reason}</td>
    </tr>`;

    const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f9;">
  <div style="max-width:600px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
    <div style="background:#000;padding:28px 32px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#c79b3b;font-weight:700;">The Headstart</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">Weekly Mentee Charge — ${weekLabel}</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 20px;font-size:14px;color:#555;">
        Charged <strong>$${chargedTotal.toFixed(2)}</strong> across ${charged.length} mentee(s).
        ${failed.length ? `<span style="color:#c62828;"><strong>${failed.length} declined ($${failedTotal.toFixed(2)}) — chase them, then use "Retry failed charges" on the billing page.</strong></span>` : "No failures."}
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="padding:10px 12px;text-align:left;">Mentee</th>
          <th style="padding:10px 12px;text-align:center;">Sessions</th>
          <th style="padding:10px 12px;text-align:right;">Amount</th>
          <th style="padding:10px 12px;text-align:left;">Result</th>
        </tr></thead>
        <tbody>
          ${failed.map((r) => row(r, false)).join("")}
          ${charged.map((r) => row(r, true)).join("")}
        </tbody>
      </table>
    </div>
    <div style="background:#f5f5f5;padding:16px 32px;"><p style="margin:0;font-size:12px;color:#aaa;">The Headstart Mentoring · Weekly charge run</p></div>
  </div>
</body></html>`;

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender:  { name: "The Headstart", email: "fidel@theheadstartmentoring.com" },
        to:      [{ email: "fidelhon@gmail.com", name: "Fidel" }],
        subject: `Weekly charge — $${chargedTotal.toFixed(2)} charged${failed.length ? `, ${failed.length} to do manually` : ""}`,
        htmlContent: html,
      }),
    }).catch(() => {});
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      chargedCount: charged.length,
      failedCount:  failed.length,
      chargedTotal: parseFloat(chargedTotal.toFixed(2)),
      failedTotal:  parseFloat(failedTotal.toFixed(2)),
      results: results.map((r) => ({ name: r.name, total: r.total, status: r.status, reason: r.reason })),
    }),
  };
};
