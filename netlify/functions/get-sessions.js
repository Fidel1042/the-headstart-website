// get-sessions.js
// Returns the session history for one mentor (by login email) so the portal can
// show a "your logged sessions" table. Matches the mentor email case- and
// whitespace-insensitively, newest first.

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

  const mentorEmail = (payload.mentorEmail || "").toLowerCase().trim();
  if (!mentorEmail) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "mentorEmail is required" }) };
  }

  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    const records = [];
    let offset = null;
    do {
      const formula = encodeURIComponent(`LOWER(TRIM({Mentor Email}))="${mentorEmail}"`);
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        `&fields[]=Date&fields[]=Mentee%20Name&fields[]=Amount%20Due&fields[]=Amount%20Charged&fields[]=Payment%20Status` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    const sessions = records
      .map((r) => {
        const status  = r.fields["Payment Status"] || "—";
        const charged = parseFloat(r.fields["Amount Charged"]);
        const due     = parseFloat(r.fields["Amount Due"]);
        // Show the amount that best reflects reality for each state.
        let amount = null;
        if (status === "Package")      amount = null;               // pre-paid
        else if (status === "Charged") amount = isNaN(charged) ? due : charged;
        else                           amount = isNaN(due) ? charged : due; // Pending / Failed
        return {
          date:   r.fields["Date"] || "",
          mentee: r.fields["Mentee Name"] || "—",
          amount: isNaN(amount) ? null : amount,
          status,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first

    return { statusCode: 200, headers, body: JSON.stringify({ sessions }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
