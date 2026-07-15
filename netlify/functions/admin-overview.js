// admin-overview.js
// Owner-only feed for the Admin page: every mentor, every mentee, every
// session (incl. payouts + amounts). The page aggregates client-side.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];

async function fetchAll(baseId, tableId, fields, token) {
  const records = [];
  let offset = null;
  do {
    const url =
      `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

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

  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_BASE_ID,
    AIRTABLE_MENTOR_TABLE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_SESSION_TABLE_ID,
  } = process.env;

  try {
    const [mentorRecs, menteeRecs, sessionRecs] = await Promise.all([
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID,
        ["Name", "Email", "Rate", "Status", "Admin Notes"], AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Mentor Email Plain", "Billing type", "Client Pipeline", "Last Followed Up"], AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
        ["Date", "Mentor Email", "Mentor Name", "Mentee Name", "Mentee Record ID", "Mentor Payout",
         "Amount Due", "Amount Charged", "Payment Status", "Mentor Paid", "Next Session"],
        AIRTABLE_API_TOKEN),
    ]);

    // Only mentors actually on the team.
    const mentors = mentorRecs
      .filter((r) => (r.fields["Status"] || "") === "Hired")
      .map((r) => ({
        id:    r.id,
        name:  r.fields["Name"] || "",
        email: (r.fields["Email"] || "").toLowerCase().trim(),
        rate:  parseFloat(r.fields["Rate"]) || 0,
        notes: r.fields["Admin Notes"] || "",
      }));

    // Only paying clients count as mentees (leads/consults stay out).
    const mentees = menteeRecs
      .filter((r) => (r.fields["Client Pipeline"] || "") === "Acquired")
      .map((r) => ({
        id:           r.id,
        name:         r.fields["Name"] || "",
        mentorEmail:  (r.fields["Mentor Email Plain"] || "").toLowerCase().trim(),
        billingType:  r.fields["Billing type"] || "Per Session",
        lastFollowUp: r.fields["Last Followed Up"] || "",
      }));

    const sessions = sessionRecs.map((r) => {
      const f = r.fields;
      return {
        date:          f["Date"] || "",
        mentorEmail:   (f["Mentor Email"] || "").toLowerCase().trim(),
        mentorName:    f["Mentor Name"] || "",
        mentee:        f["Mentee Name"] || "—",
        menteeId:      f["Mentee Record ID"] || "",
        payout:        parseFloat(f["Mentor Payout"]) || 0,
        amountDue:     parseFloat(f["Amount Due"]) || 0,
        amountCharged: parseFloat(f["Amount Charged"]) || 0,
        status:        f["Payment Status"] || "—",
        mentorPaid:    Boolean(f["Mentor Paid"]),
        next:          f["Next Session"] || "",
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ mentors, mentees, sessions }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
