// charge-custom.js — owner-initiated charges: a prepay package, or a one-off
// amount. The weekly sweep and the failed-card retry live elsewhere; this is
// the "charge this mentee, now, for this" button.
//
// SAFE HAVEN. Three things must line up before any card is touched:
//   1. owner email is on the allowlist
//   2. the billing passcode is correct
//   3. the amount the page believes it is charging matches the amount this
//      function computes from Airtable, to the cent
// Any mismatch is refused. The page therefore cannot charge an amount the
// server did not independently arrive at, whether from a stale screen, a
// mistyped figure, or a tampered request.
//
//   { adminEmail, recordId, kind, ... , preview: true }  → what would happen
//   { adminEmail, recordId, kind, ... , passcode, expectedAmount } → charges

const Stripe = require("stripe");
const { OWNERS, authorise, airtableHeaders, menteeRecord } = require("../shared/charge-engine");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const money = (n) => parseFloat((Number(n) || 0).toFixed(2));

// Works out what to charge, reading price from Airtable rather than the client.
// Returns { error } instead of guessing whenever the inputs are not sound.
function quote(kind, fields, payload) {
  const raw = fields["Session Price"];
  const price = parseFloat(raw);
  const name = fields["Name"] || "this mentee";

  if (kind === "package") {
    const sessions = parseInt(payload.sessions, 10);
    if (!Number.isFinite(sessions) || sessions < 1 || sessions > 50) {
      return { error: "Number of sessions must be between 1 and 50." };
    }
    // The per-session rate for a package can legitimately differ from the
    // mentee's usual rate (that is the prepay discount), so it is supplied
    // rather than read, but it still has to be a sane number.
    const rate = parseFloat(payload.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) {
      return { error: "Per-session rate must be a number between 1 and 1000." };
    }
    return {
      amount: money(sessions * rate), sessions, rate,
      description: `Headstart prepay — ${name} — ${sessions} session(s) at $${rate.toFixed(2)}`,
      summary: `${sessions} session package at $${rate.toFixed(2)} each`,
    };
  }

  if (kind === "custom") {
    const amount = parseFloat(payload.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5000) {
      return { error: "Amount must be a number between 1 and 5000." };
    }
    const reason = String(payload.reason || "").trim();
    if (!reason) return { error: "Add a short reason for this charge." };
    return {
      amount: money(amount), sessions: 0, rate: 0,
      description: `Headstart — ${name} — ${reason}`,
      summary: reason,
    };
  }

  if (kind === "session") {
    // Never fall back to a default price. A wrong price here is a real
    // mischarge, so a blank or unparseable value stops the charge instead.
    if (!Number.isFinite(price) || price <= 0) {
      return { error: `No usable session price on ${name} (Airtable says "${raw === undefined ? "" : raw}"). Fix it in Airtable first.` };
    }
    const count = parseInt(payload.sessions, 10) || 1;
    if (count < 1 || count > 20) return { error: "Number of sessions must be between 1 and 20." };
    return {
      amount: money(count * price), sessions: count, rate: price,
      description: `Headstart — ${name} — ${count} session(s) at $${price.toFixed(2)}`,
      summary: `${count} session(s) at $${price.toFixed(2)} each`,
    };
  }

  return { error: "Unknown charge type." };
}

// Records the charge in the session log so the P&L and package balance see it.
async function logCharge({ recordId, name, kind, q, paymentIntentId }) {
  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const fields = {
    "Mentee Name": name,
    "Mentee Record ID": recordId,
    "Date": new Date().toISOString().slice(0, 10),
    "Amount Charged": q.amount,
    "Stripe Payment ID": paymentIntentId || "",
    // A package purchase is cash in, not a delivered lesson: the P&L
    // recognises it across the sessions as they happen.
    "Payment Status": kind === "package" ? "Package" : "Charged",
  };
  if (kind === "package") fields["Package Sessions"] = q.sessions;
  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
    { method: "POST", headers: airtableHeaders(), body: JSON.stringify({ records: [{ fields }] }) });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  if (!OWNERS.includes((payload.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }

  const rec = await menteeRecord(payload.recordId);
  if (!rec) return json(404, { error: "Mentee not found" });
  const f = rec.fields;
  const name = f["Name"] || "Unnamed";

  const q = quote(payload.kind, f, payload);
  if (q.error) return json(400, { error: q.error });

  const customerId = f["Stripe Customer ID"] || "";
  if (!customerId) return json(400, { error: `${name} has no card on file. Send them a card link first.` });

  // Preview: exactly what the confirm dialog shows, computed server-side.
  if (payload.preview) {
    return json(200, {
      preview: true, name, amount: q.amount, summary: q.summary,
      billingType: f["Billing type"] || "Per Session",
      sessionPrice: Number.isFinite(parseFloat(f["Session Price"])) ? parseFloat(f["Session Price"]) : null,
    });
  }

  const denied = authorise(payload);
  if (denied) return json(403, { error: denied });

  // The safe haven: page and server must agree on the figure, to the cent.
  const expected = money(payload.expectedAmount);
  if (expected !== q.amount) {
    return json(409, {
      error: `Amount mismatch. The page expected $${expected.toFixed(2)} but the current details work out to $${q.amount.toFixed(2)}. Nothing was charged. Reload and try again.`,
    });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  let paymentMethodId = null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    paymentMethodId = customer?.invoice_settings?.default_payment_method || null;
    if (!paymentMethodId) {
      const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card" });
      if (methods.data.length) paymentMethodId = methods.data[0].id;
    }
  } catch {
    return json(502, { error: "Could not reach Stripe. Nothing was charged." });
  }
  if (!paymentMethodId) return json(400, { error: `No saved card for ${name}. Nothing was charged.` });

  let pi;
  try {
    pi = await stripe.paymentIntents.create({
      amount: Math.round(q.amount * 100),
      currency: "aud",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: q.description,
    });
  } catch (err) {
    return json(200, { charged: false, name, amount: q.amount, reason: err.message || "Card declined" });
  }

  await logCharge({ recordId: payload.recordId, name, kind: payload.kind, q, paymentIntentId: pi.id });

  // A prepay purchase changes how future sessions are billed.
  if (payload.kind === "package") {
    const { AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${payload.recordId}`,
      { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ fields: { "Billing type": "Package" } }) }).catch(() => {});
  }

  return json(200, { charged: true, name, amount: q.amount, summary: q.summary, paymentIntentId: pi.id });
};
