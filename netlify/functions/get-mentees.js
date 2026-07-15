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
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    // Filter mentees by Mentor Email Plain field — matched case- and
    // whitespace-insensitively so a stray capital or trailing space in the
    // Airtable field can't silently hide a mentee from their mentor.
    const wanted = mentorEmail.toLowerCase().trim();
    const allMenteeRecords = [];
    let offset = null;
    do {
      const formula = encodeURIComponent(`LOWER(TRIM({Mentor Email Plain}))="${wanted}"`);
      const extraFields = ["Target Industry", "Major", "University Year", "Suggested Plan", "Mentor Notes"]
        .map((f) => `&fields[]=${encodeURIComponent(f)}`).join("");
      const url = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
        `?filterByFormula=${formula}&fields[]=Name&fields[]=Billing%20type&fields[]=Stripe%20Customer%20ID` +
        extraFields +
        (offset ? `&offset=${offset}` : "");
      const menteeRes  = await fetch(url, { headers: airtableHeaders });
      const menteeData = await menteeRes.json();
      allMenteeRecords.push(...(menteeData.records || []));
      offset = menteeData.offset || null;
    } while (offset);

    const mentees = allMenteeRecords
      .map((r) => ({
        id:          r.id,
        name:        r.fields.Name || "Unnamed mentee",
        billingType: r.fields["Billing type"] || "Per Session",
        hasCard:     Boolean(r.fields["Stripe Customer ID"]),
        industry:    r.fields["Target Industry"] || "",
        major:       r.fields["Major"] || "",
        year:        r.fields["University Year"] || "",
        plan:        r.fields["Suggested Plan"] || "",
        notes:       r.fields["Mentor Notes"] || "",
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
