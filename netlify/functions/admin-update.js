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

  let tableId, fields;
  if (kind === "mentee-followup") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "Last Followed Up": payload.date || null };
  } else if (kind === "mentor-notes") {
    tableId = AIRTABLE_MENTOR_TABLE_ID;
    fields = { "Admin Notes": typeof payload.notes === "string" ? payload.notes : "" };
  } else if (kind === "mentee-dropped") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "Client Pipeline": "Dropped" };
  } else if (kind === "mentee-contact-added") {
    tableId = AIRTABLE_MENTEE_TABLE_ID;
    fields = { "WhatsApp Added": payload.added !== false };
  } else {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Unknown kind" }) };
  }

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${tableId}/${recordId}`,
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
