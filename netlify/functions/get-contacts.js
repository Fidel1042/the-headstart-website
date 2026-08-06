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
const HEADING = /^\s*#*\s*(whatsapp|gmail|email)\s+(follow-?up|nudge)\s*:?\s*$/i;

// The current Make.com prompt writes three blocks separated by banner lines:
//   === FOLLOW-UP (send now) ===   === NUDGE 1 ... ===   === NUDGE 2 ... ===
// Each is a separate message sent on a different day, so they are split apart
// and returned as a list rather than one blob. Older records used
// "WhatsApp follow-up:" style headings, so both shapes are handled.
const BANNER = /^\s*=+\s*(.+?)\s*=+\s*$/;

// "FOLLOW-UP (send now)" → { label: "Follow-up", when: "send now" }, so the
// buttons can be short and the timing still shown.
function splitLabel(raw) {
  const m = String(raw).match(/^(.*?)\s*\((.+)\)\s*$/);
  const title = (m ? m[1] : raw).trim();
  const nice = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  return { label: nice, when: m ? m[2].trim() : "" };
}

/** Every draft message in the field, in order, each with its own label. */
function draftMessages(drafts) {
  if (!drafts) return [];
  const lines = drafts.split(/\r?\n/);

  const out = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text) out.push({ label: current.label, when: current.when, text });
    current = null;
  };

  lines.forEach((l) => {
    const banner = l.match(BANNER);
    if (banner) { push(); current = { ...splitLabel(banner[1]), lines: [] }; return; }
    const heading = l.match(HEADING);
    if (heading) {
      push();
      // Older records carry a WhatsApp AND a Gmail version of each message, so
      // the channel has to be in the label. Without it you get two buttons both
      // saying "Follow-up" and no way to tell which is which.
      const channel = /whatsapp/i.test(heading[1]) ? "WhatsApp" : "Email";
      const type = /nudge/i.test(heading[2]) ? "nudge" : "follow-up";
      current = { label: `${channel} ${type}`, when: "", lines: [] };
      return;
    }
    if (current) current.lines.push(l);
    // Text before any heading is a message with no label of its own. This is
    // how the oldest records look, so it must not be dropped.
    else current = { label: "Follow-up", when: "", lines: [l] };
  });
  push();
  return out;
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
        ["Name", "Phone Number", "Aussie Number", "Client Pipeline", "Mentor Email Plain",
         "WhatsApp Added", "Raw Notes", "Consult Contact Saved", "Last Modified",
         "Drafts", "Meeting Time", "Notes filled at"],
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

    return { statusCode: 200, headers, body: JSON.stringify({ matched, consults }) };
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
