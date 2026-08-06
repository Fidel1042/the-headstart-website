// record-payment.js — marks sessions as paid for money that did not come from
// the automatic weekly run.
//
// Two cases, and the difference between them is real money:
//
//   "Stripe (charged by hand)" — Fidel opened the Stripe dashboard and took the
//   payment himself. Stripe DID take its cut, so a payment ID is recorded and
//   the P&L deducts 3.25% + 30c.
//
//   Bank transfer / Cash / Other — the money never went through Stripe, so no
//   payment ID is written and no fee is deducted.
//
// monthly-pl.js decides whether to charge that fee purely on whether "Stripe
// Payment ID" is set, so this field is the whole job. Writing one when Stripe
// was not used invents a cost; omitting one when it was hides a real one.

const { OWNERS, airtableHeaders, PREPAID_TYPES } = require("../shared/charge-engine");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const money = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

const STRIPE_METHOD = "Stripe (charged by hand)";
const METHODS = [STRIPE_METHOD, "Bank transfer", "Cash", "Other"];

// Creates the purchase row for a package paid for outside the weekly run.
// Shape matches what charge-custom.js writes for an automated package charge,
// because the package balance counts "Package" rows with an amount, and the
// P&L treats them as cash in that is recognised session by session. A different
// shape here would silently not count.
async function recordPrepay(payload) {
  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;

  const amount = money(payload.amount);
  const sessions = parseInt(payload.sessions, 10);
  if (!payload.recordId) return json(400, { error: "Pick a mentee first." });
  if (!(amount > 0)) return json(400, { error: "Enter the amount that was actually charged." });
  if (!(sessions > 0)) return json(400, { error: "Enter how many sessions the package covers." });

  // The mentee's name is read from Airtable, never taken from the page, so the
  // row can never be filed under a name that does not exist.
  let name = "";
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${payload.recordId}`,
      { headers: airtableHeaders() }
    );
    const rec = await res.json();
    if (!res.ok || !rec.fields) throw new Error("Mentee not found");
    name = rec.fields["Name"] || "";
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }

  const method = METHODS.includes(payload.method) ? payload.method : STRIPE_METHOD;
  const viaStripe = method === STRIPE_METHOD;
  const when = payload.date || new Date().toISOString().slice(0, 10);
  const note = String(payload.note || "").trim();

  if (payload.preview) {
    return json(200, {
      preview: true, prepay: true, name, amount, sessions, viaStripe,
      each: money(amount / sessions),
      fee: viaStripe ? money(amount * 0.0325 + 0.30) : 0,
    });
  }

  const fields = {
    "Mentee Name": name,
    "Mentee Record ID": payload.recordId,
    "Date": when,
    "Amount Charged": amount,
    "Package Sessions": sessions,
    "Payment Status": "Package",
    // Audit trail on the notes field, not Failure Reason: that one is shown to
    // Fidel as the reason a card declined, so a payment note there reads as a
    // failure that never happened.
    "Extra Notes": `Prepayment recorded by hand on ${new Date().toISOString().slice(0, 10)} (${method})${note ? `: ${note}` : ""}`,
  };
  if (viaStripe) {
    fields["Stripe Payment ID"] = String(payload.stripeId || "").trim() || `manual-stripe-${when}`;
  }

  try {
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`, {
      method: "POST", headers: airtableHeaders(), body: JSON.stringify({ records: [{ fields }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "Could not save");

    // Mark the mentee prepaid so the weekly run stops billing them per session.
    // Both spellings are tried, matching charge-custom.js.
    let billingType = null;
    for (const value of PREPAID_TYPES) {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${payload.recordId}`, {
        method: "PATCH", headers: airtableHeaders(),
        body: JSON.stringify({ fields: { "Billing type": value } }),
      }).catch(() => null);
      if (r && r.ok) { billingType = value; break; }
    }
    return json(200, { prepay: true, name, amount, sessions, billingType });
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  // Owner-only, but no billing passcode: nothing is charged, and requiring the
  // passcode to record a payment that already landed would just mean it never
  // gets recorded.
  if (!OWNERS.includes((payload.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }

  // Prepayment mode. A package charged by hand has no session rows to tick off
  // yet, so instead of updating rows it CREATES the purchase row that the
  // package balance and the P&L both read.
  if (payload.kind === "prepay") return recordPrepay(payload);

  const ids = Array.isArray(payload.recordIds) ? payload.recordIds.filter(Boolean) : [];
  if (!ids.length) return json(400, { error: "Pick at least one session to record against." });

  const method = METHODS.includes(payload.method) ? payload.method : "Other";
  const note = String(payload.note || "").trim();
  const when = new Date().toISOString().slice(0, 10);
  const viaStripe = method === STRIPE_METHOD;
  // Stripe's own id when it was pasted in, otherwise a marker. Either way the
  // field is non-empty, which is what makes the P&L charge the fee. A marker is
  // used rather than leaving it blank because the fee was genuinely paid, and
  // hunting down the real id later is not worth blocking the record over.
  const paymentId = viaStripe
    ? (String(payload.stripeId || "").trim() || `manual-stripe-${when}`)
    : "";

  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`;

  // Read the rows first. Amount Charged has to come from Airtable's Amount Due,
  // never from the page, so a stale screen cannot record the wrong figure.
  let rows;
  try {
    const formula = `OR(${ids.map((id) => `RECORD_ID()="${id}"`).join(",")})`;
    const res = await fetch(
      `${base}?filterByFormula=${encodeURIComponent(formula)}` +
      `&fields[]=Amount Due&fields[]=Payment Status&fields[]=Mentee Name&fields[]=Date&fields[]=Extra Notes`,
      { headers: airtableHeaders() }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || "Could not read the sessions");
    rows = data.records || [];
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }

  if (!rows.length) return json(404, { error: "Those sessions no longer exist. Reload and try again." });

  // Already-charged rows are skipped rather than overwritten, so a double click
  // or a stale tab can never inflate recognised revenue.
  const already = rows.filter((r) => (r.fields["Payment Status"] || "") === "Charged");
  const todo = rows.filter((r) => (r.fields["Payment Status"] || "") !== "Charged");
  if (!todo.length) {
    return json(409, { error: "Those sessions are already marked as charged. Nothing was changed." });
  }

  const total = money(todo.reduce((a, r) => a + (parseFloat(r.fields["Amount Due"]) || 0), 0));

  // Preview mode: the page shows this back before anything is written.
  if (payload.preview) {
    return json(200, {
      preview: true,
      count: todo.length,
      skipped: already.length,
      total,
      viaStripe,
      // Shown back so the fee consequence is visible before confirming.
      fee: viaStripe ? money(total * 0.0325 + 0.30) : 0,
      rows: todo.map((r) => ({
        date: String(r.fields["Date"] || "").slice(0, 10),
        due: money(r.fields["Amount Due"]),
      })),
    });
  }

  const trail = `Recorded manually on ${when} (${method})${note ? `: ${note}` : ""}`;
  const results = [];
  // Airtable caps a batch PATCH at 10 records.
  for (let i = 0; i < todo.length; i += 10) {
    const slice = todo.slice(i, i + 10);
    const res = await fetch(base, {
      method: "PATCH",
      headers: airtableHeaders(),
      body: JSON.stringify({
        records: slice.map((r) => ({
          id: r.id,
          fields: {
            "Payment Status": "Charged",
            "Amount Charged": money(r.fields["Amount Due"]),
            // Appended, never replaced: Extra Notes holds the mentor's own
            // session notes and losing those would be worse than no trail.
            "Extra Notes": [r.fields["Extra Notes"], trail].filter(Boolean).join("\n"),
            // The row is settled, so any old decline message has to go. A stale
            // "insufficient funds" left on a paid row is how Patience's record
            // ended up looking unpaid when it was not.
            "Failure Reason": "",
            // Only set when Stripe really took the money. See the header note.
            ...(viaStripe ? { "Stripe Payment ID": paymentId } : {}),
          },
        })),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      return json(502, {
        error: data?.error?.message || "Could not save",
        // Say how far it got: a partial write must not look like a total failure.
        recorded: results.length,
      });
    }
    results.push(...(data.records || []));
  }

  return json(200, {
    recorded: results.length,
    skipped: already.length,
    total,
    method,
  });
};
