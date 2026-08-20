// get-contacts.js
// Owner-only. Returns mentees who have reached an active stage but have not
// yet been saved as a WhatsApp contact, so Koko can add them in one tap.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const { draftMessages } = require("../shared/drafts");
const { shortIndustry } = require("../shared/followups");

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
// Only paying, acquired mentees need adding to WhatsApp.
const ACTIVE_STAGES = ["Acquired"];
// Post-consultation list only shows calls from the last couple of days, so it
// stays a short to-do rather than the whole historical backlog.
const CONSULT_WINDOW_DAYS = 2;
const TZ = "Australia/Sydney";

const ymd = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

// Self-healing read: an optional field that does not exist yet (such as
// "Notes Filled At" before it is added in Airtable) is dropped and the request
// retried, so a missing field degrades gracefully instead of 422-ing.
async function fetchAll(baseId, tableId, fields, token) {
  const records = [];
  let offset = null;
  let use = [...fields];
  while (true) {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${use.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const data = await res.json();
    if (data.error) {
      const msg = String(data.error.message || "");
      const unknown = msg.match(/Unknown field name:\s*"?([^"]+?)"?\.?$/i);
      if (unknown && use.includes(unknown[1])) {
        use = use.filter((f) => f !== unknown[1]);
        continue;
      }
      throw new Error(msg || "Airtable error");
    }
    records.push(...(data.records || []));
    offset = data.offset || null;
    if (!offset) break;
  }
  return records;
}

// Pull the WhatsApp follow-up out of the generated Drafts field.
// New records hold one message and nothing else, so the whole field is the
// message. Older records hold several labelled blocks, and the model was not
// consistent about writing the "##" markdown markers, so the heading is matched
// with or without them and everything up to the next heading is taken.
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
        ["Name", "Phone Number", "Aussie Number", "Client Pipeline", "Mentor Email Plain",
         "WhatsApp Added", "Raw Notes", "Consult Contact Saved", "Last Modified",
         "Drafts", "Meeting Time", "Notes filled at", "Target Industry"],
        AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID,
        ["Name", "Email"], AIRTABLE_API_TOKEN),
    ]);

    const mentorName = new Map();
    mentorRecs.forEach((r) => {
      const e = (r.fields["Email"] || "").toLowerCase().trim();
      if (e) mentorName.set(e, r.fields["Name"] || e);
    });

    const shape = (r) => {
      const f = r.fields;
      const mentorEmail = (f["Mentor Email Plain"] || "").toLowerCase().trim();
      return {
        id:       r.id,
        name:     f["Name"] || "Unnamed mentee",
        phone:    normalizePhone(f["Phone Number"] || "", f["Aussie Number"] || ""),
        stage:    f["Client Pipeline"] || "",
        mentor:   mentorEmail ? (mentorName.get(mentorEmail) || mentorEmail) : "Not matched yet",
        modified: f["Last Modified"] || "",
        messages: draftMessages(f["Drafts"] || ""),
        industry: shortIndustry(f["Target Industry"] || ""),
      };
    };
    const newestFirst = (a, b) => (b.modified || "").localeCompare(a.modified || "");

    // Koko's list: acquired, a mentor is assigned, not yet added to WhatsApp.
    const matched = menteeRecs
      .filter((r) => {
        const f = r.fields;
        return ACTIVE_STAGES.includes(f["Client Pipeline"] || "")
          && (f["Mentor Email Plain"] || "").trim() !== ""
          && !f["WhatsApp Added"];
      })
      .map(shape).sort(newestFirst);

    // Fidel's list. The trigger is Fathom writing the Raw Notes after a call.
    //   - Raw Notes present, contact not saved yet
    //   - a booked call exists (no booking means it was not a real consult)
    //   - the notes landed inside the window
    // Dated by "Notes filled at" (a Last-Modified-Time field watching ONLY Raw
    // Notes), falling back to the booked call time. The record's own Last
    // Modified is never used: any edit resets it, including automated ones,
    // which would resurrect months-old mentees into this list.
    const today = ymd(new Date());
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CONSULT_WINDOW_DAYS);
    const cutoff = ymd(cutoffDate);

    const consults = menteeRecs
      .filter((r) => {
        const f = r.fields;
        if ((f["Raw Notes"] || "").trim() === "" || f["Consult Contact Saved"]) return false;
        if (!f["Meeting Time"]) return false;
        const when = f["Notes filled at"] || f["Meeting Time"];
        const callDate = ymd(new Date(when));
        return callDate >= cutoff && callDate <= today;
      })
      .map(shape).sort(newestFirst);

    // Signed, but nobody is teaching them yet. This is the list that needs a
    // mentor asked, and it empties itself: the moment a mentor is assigned in
    // Airtable the mentee drops out of it.
    const needsMentor = menteeRecs
      .filter((r) => (r.fields["Client Pipeline"] || "") === "Acquired"
        && (r.fields["Mentor Email Plain"] || "").trim() === "")
      .map(shape).sort(newestFirst);

    return { statusCode: 200, headers, body: JSON.stringify({ needsMentor, matched, consults }) };
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
