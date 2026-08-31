const { requireOwner } = require("../shared/require-owner");
// retention-exclude.js — take one mentee out of a mentor's retention figure,
// or put them back.
//
// Retention is meant to measure whether a mentor keeps people coming back. A
// mentee who left for reasons that had nothing to do with the mentoring (moved
// home, ran out of money, a one-off arrangement, never engaged from day one)
// makes that number say something it does not mean.
//
// Two rules keep this honest, and both are enforced here rather than trusted to
// the UI:
//   1. An exclusion always carries a reason. No reason, no exclusion.
//   2. Excluded mentees are never deleted or hidden. They still come back in the
//      payload, still appear in the modal, and the count is stated on the tile.
// An exclusion you can see and argue with is a judgement. One you cannot is a
// way of making the number say whatever you want.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

const MAX_REASON = 120;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return json(403, { error: "Not authorised" });
  }
  if (!p.menteeId) return json(400, { error: "No mentee" });

  const on = Boolean(p.excluded);
  const reason = String(p.reason || "").trim().slice(0, MAX_REASON);
  // The reason is the whole point. Without it, next month nobody remembers
  // whether this was a fair call or a convenient one.
  if (on && !reason) return json(400, { error: "Give a reason for excluding them." });

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTEE_TABLE_ID: table } = process.env;
  if (!token || !base || !table) return json(500, { error: "Airtable env vars missing" });

  try {
    const res = await fetch(`https://api.airtable.com/v0/${base}/${table}/${p.menteeId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          "Retention Excluded": on,
          // Cleared on re-include, so a stale reason cannot sit against
          // somebody who is counting again.
          "Retention Exclude Reason": on ? reason : "",
        },
      }),
    });
    const data = await res.json();
    if (data.error) return json(502, { error: data.error.message || "Airtable refused it" });
    return json(200, {
      menteeId: p.menteeId,
      excluded: Boolean(data.fields["Retention Excluded"]),
      reason: data.fields["Retention Exclude Reason"] || "",
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not save" });
  }
};
