// admin-update.js
// Owner-only writes from the admin portal:
//   kind "mentee-followup" → sets "Last Followed Up" (date) on a Client record
//   kind "mentor-notes"    → sets "Admin Notes" (text) on a Mentor record

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const ownerEmail = (payload.ownerEmail || "").toLowerCase().trim();
  if (!OWNERS.includes(ownerEmail)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Owners only" }) };
  }

  const { kind, recordId } = payload;
  if (!recordId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "recordId is required" }) };
  }

  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_MENTOR_TABLE_ID,
  } = process.env;

  let tableId, fields, baseId;
  if (kind === "mentee-followup") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "Last Followed Up": payload.date || null };
  } else if (kind === "mentee-next-session") {
    // Koko books the next session from the admin view. Mentors record the same
    // thing on the session row they log, but a mentee with no sessions yet has
    // no row to write to, so the admin-set date lives on the mentee record and
    // readers merge the two sources.
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "Next Session": payload.date || null };
  } else if (kind === "hold-payout" || kind === "release-payout") {
    // Holds a session back from the next payslip, or frees it again. The session
    // row lives in the session log base, not the core directory.
    tableId = process.env.AIRTABLE_SESSION_TABLE_ID;
    baseId  = process.env.AIRTABLE_BASE_ID;
    fields = { "Payout Held": kind === "hold-payout" };
  } else if (kind === "mentee-notes") {
    // Working notes plus an optional park-until date, saved together so one
    // Save button covers both. A cleared date takes them off hold immediately.
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = {
      "Admin Notes": typeof payload.notes === "string" ? payload.notes : "",
      "On Hold Until": payload.holdUntil || null,
    };
  } else if (kind === "mentor-notes") {
    tableId = AIRTABLE_MENTOR_TABLE_ID;
    fields = { "Admin Notes": typeof payload.notes === "string" ? payload.notes : "" };
  } else if (kind === "mentee-dropped") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "Client Pipeline": "Dropped" };
  } else if (kind === "mentee-contact-added") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "WhatsApp Added": payload.added !== false };
  } else if (kind === "mentee-consult-saved") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "Consult Contact Saved": payload.added !== false };
  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown kind" }) };
  }

  try {
    const res = await fetch(
      // Most kinds live in the core directory; a release targets the session
      // log base instead, so the base is overridable per kind.
      `https://api.airtable.com/v0/${baseId || AIRTABLE_CORE_BASE_ID}/${tableId}/${recordId}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      }
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { statusCode: 502, headers, body: JSON.stringify({ error: body?.error?.message || "Could not save" }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
