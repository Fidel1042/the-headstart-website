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
      // NOTE: deliberately does NOT request Amount Charged / Amount Due.
      // Mentors must not see what a mentee paid, so the fee never leaves the
      // server — not in the table, and not in the API response either.
      // Package purchase rows (status Package with a real charge) are excluded:
      // they record the payment, not a delivered session.
      const formula = encodeURIComponent(
        `AND(LOWER(TRIM({Mentor Email}))="${mentorEmail}",` +
        `NOT(AND({Payment Status}="Package",{Amount Charged}>0)))`
      );
      // Payment Status is referenced by the filter formula (server-side) but is
      // never requested as an output field or returned: mentors must not see
      // any billing/charging state, only their own session dates and mentees.
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        `&fields[]=Date&fields[]=Mentee%20Name&fields[]=Mentee%20Record%20ID&fields[]=Next%20Session` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      records.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    const sessions = records
      .map((r) => ({
        date:     r.fields["Date"] || "",
        mentee:   r.fields["Mentee Name"] || "—",
        menteeId: r.fields["Mentee Record ID"] || "",
        next:     r.fields["Next Session"] || "",
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first

    return { statusCode: 200, headers, body: JSON.stringify({ sessions }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
