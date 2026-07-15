// save-mentee-notes.js
// Writes a mentor's free-flow remarks to the mentee's "Mentor Notes" field.
// Verifies the mentee actually belongs to the requesting mentor before writing.

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

  const { menteeRecordId, mentorEmail } = payload;
  const notes = typeof payload.notes === "string" ? payload.notes : "";
  if (!menteeRecordId || !mentorEmail) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "menteeRecordId and mentorEmail are required" }) };
  }

  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;
  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const recordUrl = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${menteeRecordId}`;

  try {
    // Ownership check: only the assigned mentor (or an owner) may write.
    const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
    const requester = mentorEmail.toLowerCase().trim();
    const getRes = await fetch(recordUrl, { headers: airtableHeaders });
    const record = await getRes.json();
    if (!record.fields) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Mentee record not found" }) };
    }
    const assigned = (record.fields["Mentor Email Plain"] || "").toLowerCase().trim();
    if (assigned !== requester && !OWNERS.includes(requester)) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: "This mentee is not assigned to you" }) };
    }

    const patchRes = await fetch(recordUrl, {
      method: "PATCH",
      headers: airtableHeaders,
      body: JSON.stringify({ fields: { "Mentor Notes": notes } }),
    });
    if (!patchRes.ok) {
      const body = await patchRes.json().catch(() => ({}));
      return { statusCode: 502, headers, body: JSON.stringify({ error: body?.error?.message || "Could not save notes" }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
