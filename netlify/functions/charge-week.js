// charge-week.js
// The weekly mentee charge. Groups every "Pending" session by mentee and
// creates ONE combined Stripe charge per mentee for the week. On success the
// mentee's sessions are marked "Charged"; on a decline they're marked "Failed"
// and listed in the summary email so Fidel can charge that mentee manually in
// Stripe. Nothing auto-retries.
//
// Protected two ways:
//   1. caller email must be in OWNERS
//   2. caller must send the correct passphrase (env BILLING_PASSCODE)
// This guards the only endpoint that moves real money.

const Stripe = require("stripe");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const adminEmail = (payload.adminEmail || "").toLowerCase().trim();
  const passcode   = payload.passcode || "";

  if (!OWNERS.includes(adminEmail)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Not authorised" }) };
  }
  if (!process.env.BILLING_PASSCODE || passcode !== process.env.BILLING_PASSCODE) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Wrong passcode" }) };
  }

  const {
    STRIPE_SECRET_KEY,
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_SESSION_TABLE_ID,
    BREVO_API_KEY,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  // ── Pull every Pending session ──
  const pending = [];
  try {
    let offset = null;
    do {
      const formula = encodeURIComponent(`{Payment Status}="Pending"`);
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        `&fields[]=Mentee%20Name&fields[]=Mentee%20Record%20ID&fields[]=Date&fields[]=Amount%20Due` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      pending.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  if (pending.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "No pending sessions to charge." }) };
  }

  // ── Group Pending sessions by mentee ──
  const byMentee = {};
  for (const s of pending) {
    const recId  = s.fields["Mentee Record ID"] || "";
    const name   = s.fields["Mentee Name"] || "Unknown";
    const amount = parseFloat(s.fields["Amount Due"]) || 0;
    const key = recId || `name:${name}`;
    if (!byMentee[key]) byMentee[key] = { recordId: recId, name, sessionIds: [], total: 0 };
    byMentee[key].sessionIds.push(s.id);
    byMentee[key].total += amount;
  }

  // ── Charge each mentee once for their combined total ──
  const results = [];      // { name, total, status, reason, sessionIds, paymentIntentId }

  for (const m of Object.values(byMentee)) {
    const amountCents = Math.round(m.total * 100);

    if (amountCents <= 0) {
      // Nothing to charge (e.g. all zero-priced) — settle without hitting Stripe.
      results.push({ ...m, status: "Charged", reason: "", paymentIntentId: "" });
      continue;
    }

    // Look up the mentee's Stripe customer.
    let customerId = null;
    if (m.recordId) {
      try {
        const mRes  = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${m.recordId}`,
          { headers: airtableHeaders }
        );
        const mData = await mRes.json();
        customerId  = mData.fields?.["Stripe Customer ID"] || null;
      } catch { customerId = null; }
    }

    if (!customerId) {
      results.push({ ...m, status: "Failed", reason: "No Stripe customer on file", paymentIntentId: "" });
      continue;
    }

    // Find a saved card.
    let paymentMethodId = null;
    try {
      const customer = await stripe.customers.retrieve(customerId);
      paymentMethodId = customer?.invoice_settings?.default_payment_method || null;
      if (!paymentMethodId) {
        const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card" });
        if (methods.data.length) paymentMethodId = methods.data[0].id;
      }
    } catch {
      results.push({ ...m, status: "Failed", reason: "Stripe customer not found", paymentIntentId: "" });
      continue;
    }

    if (!paymentMethodId) {
      results.push({ ...m, status: "Failed", reason: "No saved card on file", paymentIntentId: "" });
      continue;
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "aud",
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Headstart weekly — ${m.name} — ${m.sessionIds.length} session(s)`,
      });
      results.push({ ...m, status: "Charged", reason: "", paymentIntentId: pi.id });
    } catch (err) {
      results.push({ ...m, status: "Failed", reason: err.message || "Charge declined", paymentIntentId: "" });
    }
  }

  // ── Write results back to the session rows ──
  const updates = [];
  for (const r of results) {
    for (const id of r.sessionIds) {
      updates.push({
        id,
        fields: {
          "Payment Status":    r.status,
          "Failure Reason":    r.reason || "",
          "Amount Charged":    r.status === "Charged" ? (r.total / r.sessionIds.length) : 0,
          "Stripe Payment ID": r.paymentIntentId || "",
        },
      });
    }
  }
  for (let i = 0; i < updates.length; i += 10) {
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
      { method: "PATCH", headers: airtableHeaders, body: JSON.stringify({ records: updates.slice(i, i + 10) }) }
    );
  }

  // ── Email Fidel a summary (failed charges = handle manually in Stripe) ──
  const charged  = results.filter((r) => r.status === "Charged");
  const failed   = results.filter((r) => r.status === "Failed");
  const chargedTotal = charged.reduce((s, r) => s + r.total, 0);
  const failedTotal  = failed.reduce((s, r) => s + r.total, 0);
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
        ${failed.length ? `<span style="color:#c62828;"><strong>${failed.length} declined ($${failedTotal.toFixed(2)}) — charge these manually in Stripe.</strong></span>` : "No failures."}
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
        sender:  { name: "The Headstart", email: "theuniheadstart@gmail.com" },
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
