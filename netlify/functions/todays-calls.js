const { requireOwner } = require("../shared/require-owner");
// todays-calls.js — every call Fidel has to take today, sales and recruitment
// in one list.
//
// Two tables, one timeline. Consultations come from the Client table via
// Calendly; interviews come from the Mentors table and are booked in the portal.
// Sorted by time, because that is the only order that matters on the day.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

const ZOOM = {
  link: "https://us05web.zoom.us/j/2123046742?pwd=yjlZs0E8tBH3CEkLVuH4txJUoYnabe.1&omn=84465105461",
  passcode: "cRsn5u",
};
const ZOOM_FINAL = {
  link: "https://us05web.zoom.us/j/5621268756?pwd=j2kvxFvi6QOXQhD4b9GdNZNBUjFzYg.1",
  passcode: "1234",
};

/**
 * A number a phone can actually dial.
 *
 * The records are a mess: some have +61, some a leading 0, some neither, and a
 * few carry 0061. A tel: link only works if it is unambiguous, so everything is
 * normalised to +61 unless it is clearly already international.
 */
function dialable(raw) {
  let s = String(raw || "").replace(/[\s()\-.]/g, "");
  if (!s) return "";
  // Somebody typing +61 on top of a number that already had it. Keep the last
  // country code and drop whatever was stacked in front of it.
  if (s.indexOf("+", 1) > 0) s = s.slice(s.lastIndexOf("+"));
  if (s.startsWith("+")) return s;
  if (s.startsWith("0061")) return `+61${s.slice(4)}`;
  if (s.startsWith("61") && s.length === 11) return `+${s}`;
  if (s.startsWith("0") && s.length === 10) return `+61${s.slice(1)}`;
  if (s.length === 9 && /^[2-9]/.test(s)) return `+61${s}`;
  return s;
}

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

/** The Sydney calendar day a moment falls on, as YYYY-MM-DD. */
function sydneyDay(iso) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return json(403, { error: "Not authorised" });
  }

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTEE_TABLE_ID: clientTable,
          AIRTABLE_MENTOR_TABLE_ID: mentorTable } = process.env;

  // The day being asked for, in Sydney. Defaults to today.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.day || "")
    ? p.day
    : sydneyDay(Date.now());

  try {
    const cf = ["Name", "Meeting Time", "Phone Number", "LinkedIn Link", "Gmail",
                "Client Pipeline", "Reschedule Link", "University", "Target Industry",
                "Meeting Link"];
    const mf = ["Name", "Email", "Phone", "Status", "First Interview Date",
                "Second Interview Date", "LinkedIn", "Role", "Company",
                "Interview Response"];

    const q = (fields) => fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const [clients, mentors] = await Promise.all([
      at(`${base}/${clientTable}?${q(cf)}&pageSize=100&filterByFormula=${
        encodeURIComponent(`AND({Meeting Time}, IS_AFTER({Meeting Time}, "${day}T00:00:00Z"))`)}`, {}, token),
      at(`${base}/${mentorTable}?${q(mf)}&pageSize=100`, {}, token),
    ]);

    const calls = [];

    for (const r of clients.records || []) {
      const f = r.fields;
      const when = f["Meeting Time"];
      if (!when || sydneyDay(when) !== day) continue;
      calls.push({
        id: r.id,
        kind: "consultation",
        name: f["Name"] || "Unnamed",
        at: when,
        phone: dialable(f["Phone Number"]),
        phoneRaw: f["Phone Number"] || "",
        email: f["Gmail"] || "",
        linkedin: f["LinkedIn Link"] || "",
        // Captured off the calendar event by the Meeting Time scenario. Blank
        // for bookings made before that was wired up.
        link: f["Meeting Link"] || "",
        passcode: "",
        reschedule: f["Reschedule Link"] || "",
        note: [f["University"], f["Target Industry"]].filter(Boolean).join(" · "),
        status: f["Client Pipeline"] || "",
        confirmed: "",
      });
    }

    for (const r of mentors.records || []) {
      const f = r.fields;
      const final = (f["Status"] || "") === "Second Interview";
      const when = final ? f["Second Interview Date"] : f["First Interview Date"];
      if (!when || sydneyDay(when) !== day) continue;
      const room = final ? ZOOM_FINAL : ZOOM;
      calls.push({
        id: r.id,
        kind: final ? "final interview" : "interview",
        name: f["Name"] || "Unnamed",
        at: when,
        phone: dialable(f["Phone"]),
        phoneRaw: f["Phone"] || "",
        email: f["Email"] || "",
        linkedin: f["LinkedIn"] || "",
        link: room.link,
        passcode: room.passcode,
        reschedule: "",
        note: [f["Role"], f["Company"]].filter(Boolean).join(" at "),
        status: f["Status"] || "",
        confirmed: f["Interview Response"] || "",
      });
    }

    calls.sort((a, b) => String(a.at).localeCompare(String(b.at)));

    // The same person can hold two Client records: an old one that was dropped
    // and a new one from when they rebooked. Both carry the booking, so the day
    // would list them twice. Keyed on phone, since that is what stays the same
    // across records, falling back to the name.
    const seen = new Set();
    const unique = calls.filter((c) => {
      const key = `${c.kind}|${c.phone || c.name.toLowerCase().trim()}|${c.at}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return json(200, { day, calls: unique, duplicatesHidden: calls.length - unique.length });
  } catch (err) {
    return json(502, { error: err.message || "Could not load today's calls" });
  }
};
