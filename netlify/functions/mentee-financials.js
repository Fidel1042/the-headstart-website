// mentee-financials.js — owner-only. Everything money-related about one mentee
// (or a list of all of them), so charging never happens against a guess.
//
//   { adminEmail }                → list: every acquired mentee, name + id only
//   { adminEmail, recordId }      → full financial picture for that mentee
//
// Read-only. Nothing here moves money; charge-custom.js does that.

const { OWNERS, airtableHeaders, menteeRecord, normalizePhone } = require("../shared/charge-engine");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const DEFAULT_PACKAGE_SESSIONS = 5;
const money = (n) => parseFloat((Number(n) || 0).toFixed(2));

async function fetchAll(baseId, tableId, fields, formula) {
  const out = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (formula ? `&filterByFormula=${encodeURIComponent(formula)}` : "") +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: airtableHeaders() });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

// Sessions belonging to this mentee. Older rows have a blank Mentee Record ID,
// so name is a necessary fallback; without it their history looks empty.
function mine(rows, recordId, name) {
  const key = String(name || "").trim().toLowerCase();
  return rows.filter((r) => {
    const f = r.fields;
    if (f["Mentee Record ID"] && f["Mentee Record ID"] === recordId) return true;
    return String(f["Mentee Name"] || "").trim().toLowerCase() === key;
  });
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

  const { AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;

  try {
    // ── List mode: just enough to populate the picker ──
    if (!payload.recordId) {
      const recs = await fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Client Pipeline", "Billing type"], `{Client Pipeline}="Acquired"`);
      return json(200, {
        mentees: recs.map((r) => ({
          id: r.id,
          name: r.fields["Name"] || "Unnamed",
          billingType: r.fields["Billing type"] || "Per Session",
        })).sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    // ── Detail mode ──
    const rec = await menteeRecord(payload.recordId);
    if (!rec) return json(404, { error: "Mentee not found" });
    const f = rec.fields;
    const name = f["Name"] || "Unnamed";

    const rows = await fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
      ["Date", "Mentee Name", "Mentee Record ID", "Amount Due", "Amount Charged",
       "Payment Status", "Failure Reason", "Stripe Payment ID", "Package Sessions"]);
    const sessions = mine(rows, payload.recordId, name);

    // A "Package" row with money on it is the purchase itself, not a lesson.
    const isPurchase = (r) => (r.fields["Payment Status"] === "Package") && (parseFloat(r.fields["Amount Charged"]) || 0) > 0;
    const delivered = sessions.filter((r) => !isPurchase(r));
    const purchases = sessions.filter(isPurchase);

    const byStatus = (s) => delivered.filter((r) => (r.fields["Payment Status"] || "") === s);
    const sum = (list, field) => list.reduce((a, r) => a + (parseFloat(r.fields[field]) || 0), 0);

    const pending = byStatus("Pending");
    const failed = byStatus("Failed");

    // Package balance. "Package Sessions" lives on the purchase row; when it is
    // blank we fall back to the standard 5, which is what has always been sold.
    const packageBought = purchases.reduce(
      (a, r) => a + (parseInt(r.fields["Package Sessions"], 10) || DEFAULT_PACKAGE_SESSIONS), 0);
    const packageUsed = byStatus("Package").length;

    const history = delivered
      .concat(purchases)
      .sort((a, b) => String(b.fields["Date"] || "").localeCompare(String(a.fields["Date"] || "")))
      .slice(0, 20)
      .map((r) => ({
        date: String(r.fields["Date"] || "").slice(0, 10),
        status: r.fields["Payment Status"] || "",
        due: money(r.fields["Amount Due"]),
        charged: money(r.fields["Amount Charged"]),
        reason: r.fields["Failure Reason"] || "",
        viaStripe: Boolean(r.fields["Stripe Payment ID"]),
        kind: isPurchase(r) ? "purchase" : "session",
      }));

    return json(200, {
      id: rec.id,
      name,
      email: f["Gmail"] || "",
      phone: normalizePhone(f["Phone Number"] || "", f["Aussie Number"] || ""),
      billingType: f["Billing type"] || "Per Session",
      // Session Price is a text field in Airtable, so it can hold anything.
      // Report it raw as well as parsed; charge-custom.js refuses to charge
      // when this does not parse rather than silently defaulting.
      sessionPriceRaw: f["Session Price"] === undefined ? "" : String(f["Session Price"]),
      sessionPrice: parseFloat(f["Session Price"]),
      hasCard: Boolean(f["Stripe Customer ID"]),
      counts: {
        total: delivered.length,
        pending: pending.length,
        failed: failed.length,
        charged: byStatus("Charged").length,
      },
      outstanding: money(sum(pending, "Amount Due") + sum(failed, "Amount Due")),
      failedTotal: money(sum(failed, "Amount Due")),
      lifetimeCharged: money(sum(delivered.concat(purchases), "Amount Charged")),
      packageBought,
      packageUsed,
      packageRemaining: packageBought ? packageBought - packageUsed : null,
      history,
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }
};
