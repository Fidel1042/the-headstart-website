const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { mentorEmail } = payload;
  if (!mentorEmail) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "mentorEmail is required" }) };
  }

  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_MENTOR_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    // Step 1: find the mentor's Airtable record ID by email
    const mentorRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}` +
        `?filterByFormula=${encodeURIComponent(`{Email}="${mentorEmail}"`)}` +
        `&fields[]=Email`,
      { headers: airtableHeaders }
    );
    const mentorData = await mentorRes.json();

    if (!mentorData.records || mentorData.records.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: "Mentor not found in Airtable" }),
      };
    }

    const mentorRecordId = mentorData.records[0].id;

    // Step 2: find mentees linked to this mentor who have a session price set (i.e. signed/active)
    const menteeRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
        `?filterByFormula=${encodeURIComponent(`AND(FIND("${mentorRecordId}", ARRAYJOIN({Mentor})), {Session Price} > 0)`)}` +
        `&fields[]=Name`,
      { headers: airtableHeaders }
    );
    const menteeData = await menteeRes.json();

    const mentees = (menteeData.records || []).map((r) => ({
      id: r.id,
      name: r.fields["Name"] || "Unnamed mentee",
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ mentees }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Server error" }),
    };
  }
};
