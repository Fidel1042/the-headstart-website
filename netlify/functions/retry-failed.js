// retry-failed.js
// Re-runs the card charge for every session sitting at "Failed" (usually
// insufficient funds), after the mentee has been chased and topped up.
// One combined charge per mentee, exactly like the weekly run.
//
// GET-style preview:  { adminEmail, preview: true }  → who would be charged,
//                                                      touches no money
// Live run:           { adminEmail, passcode }       → charges the cards
//
// A session only becomes "Charged" if Stripe confirms it. A second decline
// stays "Failed" with the new reason, because the P&L counts "Charged" as
// recognised revenue and marking it optimistically would invent income.

const Stripe = require("stripe");
const {
  OWNERS, authorise, fetchByStatus, groupByMentee, menteeRecord, normalizePhone,
  chargeGroups, writeResults, summarise,
} = require("../shared/charge-engine");
const { chaseMessage } = require("../shared/chase-message");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const adminEmail = (payload.adminEmail || "").toLowerCase().trim();
  if (!OWNERS.includes(adminEmail)) return json(403, { error: "Not authorised" });

  let groups;
  try {
    groups = groupByMentee(await fetchByStatus("Failed"));
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }

  // Preview needs no passcode: it reads only, and seeing the list is what
  // tells Fidel who to chase before spending anything.
  if (payload.preview) {
    // Pull each mentee's phone so the page can offer a WhatsApp button, and
    // build the chase message here so the wording matches the reminder email.
    const mentees = [];
    for (const g of groups) {
      const rec = await menteeRecord(g.recordId);
      mentees.push({
        name: g.name,
        sessions: g.sessionIds.length,
        total: parseFloat(g.total.toFixed(2)),
        reason: g.reason || "",
        phone: normalizePhone(rec?.fields?.["Phone Number"] || "", rec?.fields?.["Aussie Number"] || ""),
        message: chaseMessage(g.name, g.total, g.reason),
        // The exact session rows behind this decline, so the page can record a
        // payment that arrived some other way without a round trip.
        sessionIds: g.sessionIds,
      });
    }
    return json(200, {
      preview: true,
      count: groups.length,
      total: parseFloat(groups.reduce((s, g) => s + g.total, 0).toFixed(2)),
      mentees,
    });
  }

  const denied = authorise(payload);
  if (denied) return json(403, { error: denied });

  if (!groups.length) return json(200, { chargedCount: 0, failedCount: 0, message: "No failed charges to retry." });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
  const results = await chargeGroups(groups, stripe, "retry");
  await writeResults(results);

  const { charged, failed, chargedTotal, failedTotal } = summarise(results);
  return json(200, {
    chargedCount: charged.length,
    failedCount: failed.length,
    chargedTotal: parseFloat(chargedTotal.toFixed(2)),
    failedTotal: parseFloat(failedTotal.toFixed(2)),
    results: results.map((r) => ({ name: r.name, total: r.total, status: r.status, reason: r.reason })),
  });
};
