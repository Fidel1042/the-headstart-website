// record-payment.js — marks sessions as paid when the money arrived outside
// Stripe (bank transfer, cash, a card the mentee ran themselves).
//
// No money moves here. This only records something that already happened, so
// it deliberately does NOT write a Stripe Payment ID: the P&L reads that field
// to decide whether to deduct Stripe's fee, and inventing one would invent a
// cost that was never charged.

const { OWNERS, airtableHeaders } = require("../shared/charge-engine");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const money = (n) => Math.round((parseFloat(n) || 0) * 100) / 100;

const METHODS = ["Bank transfer", "Cash", "Card (manual)", "Other"];

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

  const ids = Array.isArray(payload.recordIds) ? payload.recordIds.filter(Boolean) : [];
  if (!ids.length) return json(400, { error: "Pick at least one session to record against." });

  const method = METHODS.includes(payload.method) ? payload.method : "Other";
  const note = String(payload.note || "").trim();
  const when = new Date().toISOString().slice(0, 10);

  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const base = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`;

  // Read the rows first. Amount Charged has to come from Airtable's Amount Due,
  // never from the page, so a stale screen cannot record the wrong figure.
  let rows;
  try {
    const formula = `OR(${ids.map((id) => `RECORD_ID()="${id}"`).join(",")})`;
    const res = await fetch(
      `${base}?filterByFormula=${encodeURIComponent(formula)}` +
      `&fields[]=Amount Due&fields[]=Payment Status&fields[]=Mentee Name&fields[]=Date`,
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
            "Failure Reason": trail,
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
