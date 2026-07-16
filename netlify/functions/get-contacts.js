// get-contacts.js
// Owner-only. Returns mentees who have reached an active stage but have not
// yet been saved as a WhatsApp contact, so Koko can add them in one tap.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
// Only paying, acquired mentees need adding to WhatsApp.
const ACTIVE_STAGES = ["Acquired"];

async function fetchAll(baseId, tableId, fields, token) {
  const records = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
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
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_MENTOR_TABLE_ID,
  } = process.env;

  try {
    const [menteeRecs, mentorRecs] = await Promise.all([
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Phone Number", "Aussie Number", "Client Pipeline", "Mentor Email Plain", "WhatsApp Added", "Last Modified"],
        AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID,
        ["Name", "Email"], AIRTABLE_API_TOKEN),
    ]);

    const mentorName = new Map();
    mentorRecs.forEach((r) => {
      const e = (r.fields["Email"] || "").toLowerCase().trim();
      if (e) mentorName.set(e, r.fields["Name"] || e);
    });

    const contacts = menteeRecs
      .filter((r) => {
        const f = r.fields;
        // Acquired, a mentor is assigned, and not yet added to WhatsApp.
        return ACTIVE_STAGES.includes(f["Client Pipeline"] || "")
          && (f["Mentor Email Plain"] || "").trim() !== ""
          && !f["WhatsApp Added"];
      })
      .map((r) => {
        const f = r.fields;
        const mentorEmail = (f["Mentor Email Plain"] || "").toLowerCase().trim();
        return {
          id:       r.id,
          name:     f["Name"] || "Unnamed mentee",
          phone:    normalizePhone(f["Phone Number"] || "", f["Aussie Number"] || ""),
          stage:    f["Client Pipeline"] || "",
          mentor:   mentorEmail ? (mentorName.get(mentorEmail) || mentorEmail) : "Not matched yet",
          modified: f["Last Modified"] || "",
        };
      })
      .sort((a, b) => (b.modified || "").localeCompare(a.modified || "")); // newest first

    return { statusCode: 200, headers, body: JSON.stringify({ contacts }) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};

// Return a wa.me-ready international number (digits only, no +).
function normalizePhone(raw, aussie) {
  if (!raw) return "";
  let s = String(raw).trim().replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) return s.replace(/^\+/, "");
  if (s.startsWith("00")) return s.slice(2);
  if (s.startsWith("0")) return "61" + s.slice(1);          // AU local 04... -> 614...
  if (/^4\d{8}$/.test(s)) return "61" + s;                  // 9-digit AU mobile missing the 0
  if (aussie === "Aussie" && /^\d{8,9}$/.test(s)) return "61" + s.replace(/^0/, "");
  return s.replace(/\D/g, "");
}
