// admin-overview.js
// Owner-only feed for the Admin page: every mentor, every mentee, every
// session (incl. payouts + amounts). The page aggregates client-side.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const { menteeState } = require("../shared/mentee-state");

// A "Package" row carrying money is the purchase itself, not a lesson.
/**
 * An Australian mobile as wa.me wants it: digits only, country code included.
 * Handles "0410 171 723", "+61404235897", "451534111" and "478 589 235".
 * Anything that is not a plausible AU mobile returns "" rather than a guess,
 * because a wrong number sends a mentor's business to a stranger.
 */
function auPhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (/^614\d{8}$/.test(d)) return d;          // 61 4xx xxx xxx
  if (/^04\d{8}$/.test(d)) return "61" + d.slice(1);
  if (/^4\d{8}$/.test(d)) return "61" + d;
  return "";
}

const isPurchaseRow = (s) => s.status === "Package" && (parseFloat(s.amountCharged) || 0) > 0;

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
        ["Name", "Email", "Rate", "Status", "Admin Notes", "Phone"], AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Mentor Email Plain", "Billing type", "Client Pipeline",
         "Last Followed Up", "Next Session", "Admin Notes", "On Hold Until",
         "Lapse Count", "Last Chased", "Created", "Pipeline Changed"], AIRTABLE_API_TOKEN),
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
        // Normalised here so the portal can build a WhatsApp link. Mentor phone
        // numbers are hand-typed and arrive in five different shapes.
        phone: auPhone(r.fields["Phone"]),
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
        // Admin-booked next session, set by Koko from the mentee status view.
        nextSession:  (r.fields["Next Session"] || "").slice(0, 10),
        // Fidel's own working notes, and a date to park someone until. A mentee
        // on hold is out of the chase pile without being dropped.
        adminNotes:   r.fields["Admin Notes"] || "",
        holdUntil:    (r.fields["On Hold Until"] || "").slice(0, 10),
        lastChased:   (r.fields["Last Chased"] || "").slice(0, 10),
        lapses:       Number(r.fields["Lapse Count"]) || 0,
        // When they were added. The clock for a mentee who has never had a
        // session runs from here, not from nothing.
        createdAt:    (r.fields["Created"] || "").slice(0, 10),
        // When they became a mentee. Absent until the field is added in
        // Airtable, in which case the consultation date stands in.
        startedAt:    (r.fields["Pipeline Changed"] || "").slice(0, 10),
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

    // State is resolved here, not in the browser, so the mentee status page,
    // the mentor portal and the Monday email all read the same verdict from one
    // implementation. Every past disagreement came from each screen deciding
    // for itself what "needs chasing" meant.
    const today = new Date().toISOString().slice(0, 10);
    const lastByMentee = new Map();
    sessions.forEach((x) => {
      if (isPurchaseRow(x)) return;
      const key = x.menteeId || (x.mentee || "").trim().toLowerCase();
      const d = (x.date || "").slice(0, 10);
      if (!key || !d) return;
      if (d > (lastByMentee.get(key) || "")) lastByMentee.set(key, d);
    });
    const withState = mentees.map((m) => {
      const lastSession = lastByMentee.get(m.id)
        || lastByMentee.get((m.name || "").trim().toLowerCase()) || "";
      return {
        ...m, lastSession,
        state: menteeState({
          expected: m.nextSession, lastSession, createdAt: m.createdAt, startedAt: m.startedAt,
          holdUntil: m.holdUntil, lastChased: m.lastChased, lapses: m.lapses,
        }, today),
      };
    });

    return { statusCode: 200, headers, body: JSON.stringify({ mentors, mentees: withState, sessions }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
