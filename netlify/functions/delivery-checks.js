const { requireOwner } = require("../shared/require-owner");
// delivery-checks.js — who is due a session sit-in.
//
// A mentor earns a delivery check once they have enough reps to have settled
// into a way of running a session: three sessions with the same mentee (they
// have gone deep enough for a structure to show) or five across different
// mentees (breadth), whichever lands first. Before that there is nothing to
// observe yet, and sitting in tells you more about nerves than delivery.
//
// Two things to tick per mentor: the sit-in itself, and whether they have
// shadowed one of Koko's sessions. A mentor stays on the list until both are
// done. Ticking writes the date to their record, so the reminder stops and the
// notes stay attached to the mentor rather than living in a doc nobody opens.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// The two ways in. Same mentee first: repeat sessions with one person show a
// structure, which is the thing being reviewed.
const SAME_MENTEE = 3;
const ACROSS_MENTEES = 5;

const DONE_FIELD = "Delivery Check Done";
const NOTES_FIELD = "Delivery Check Notes";
const SHADOW_FIELD = "Shadowed Koko";

// A "Package" row carrying money is the purchase itself, not a lesson.
const isPurchaseRow = (f) =>
  (f["Payment Status"] || "") === "Package" && (parseFloat(f["Amount Charged"]) || 0) > 0;

async function fetchAll(baseId, tableId, fields, token) {
  const out = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

/**
 * Walk a mentor's sessions oldest first and stop at the one that tripped a
 * rule. Returns the trigger date and which rule fired, so the page can say why
 * this mentor is on the list rather than just that they are.
 */
function qualify(sessions) {
  const perMentee = {};
  let total = 0;
  for (const s of sessions) {
    total += 1;
    const key = (s.mentee || "").trim().toLowerCase() || `unnamed-${total}`;
    perMentee[key] = (perMentee[key] || 0) + 1;
    if (perMentee[key] >= SAME_MENTEE) {
      return { on: s.date, rule: "same", mentee: s.mentee, count: perMentee[key] };
    }
    if (total >= ACROSS_MENTEES && Object.keys(perMentee).length > 1) {
      return { on: s.date, rule: "across", mentee: "", count: total };
    }
  }
  return null;
}

async function saveCheck(payload, env) {
  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID } = env;
  const id = String(payload.mentorId || "").trim();
  if (!id) return json(400, { error: "mentorId is required" });

  const today = new Date().toISOString().slice(0, 10);
  const fields = {};
  // An absent flag means a save about something else, which must not clear a
  // date that is already there. Only an explicit false unticks.
  if (typeof payload.done === "boolean") fields[DONE_FIELD] = payload.done ? today : null;
  if (typeof payload.shadowed === "boolean") fields[SHADOW_FIELD] = payload.shadowed ? today : null;
  if (typeof payload.notes === "string") fields[NOTES_FIELD] = payload.notes;
  if (!Object.keys(fields).length) return json(400, { error: "Nothing to save" });

  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields }),
    });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return json(502, { error: (body.error && body.error.message) || "Could not save" });
  }
  const saved = await res.json();
  const f = saved.fields || {};
  return json(200, {
    success: true,
    doneOn: f[DONE_FIELD] || "",
    shadowedOn: f[SHADOW_FIELD] || "",
    notes: f[NOTES_FIELD] || "",
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return json(403, { error: "Not authorised" });
  }

  const env = process.env;
  const {
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_BASE_ID,
    AIRTABLE_MENTOR_TABLE_ID, AIRTABLE_SESSION_TABLE_ID,
  } = env;

  try {
    if (payload.action === "save") return await saveCheck(payload, env);

    const [mentorRecs, sessionRecs] = await Promise.all([
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID,
        ["Name", "Email", "Status", DONE_FIELD, SHADOW_FIELD, NOTES_FIELD], AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
        ["Date", "Mentor Email", "Mentee Name", "Payment Status", "Amount Charged"],
        AIRTABLE_API_TOKEN),
    ]);

    // Oldest first: qualify() depends on the order to find the trigger date.
    const byMentor = {};
    sessionRecs
      .filter((r) => r.fields["Date"] && !isPurchaseRow(r.fields))
      .map((r) => ({
        date: String(r.fields["Date"]).slice(0, 10),
        email: String(r.fields["Mentor Email"] || "").toLowerCase().trim(),
        mentee: r.fields["Mentee Name"] || "",
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((s) => { if (s.email) (byMentor[s.email] = byMentor[s.email] || []).push(s); });

    const today = new Date().toISOString().slice(0, 10);
    const days = (from) =>
      Math.round((new Date(today + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000);

    // Sitting in on your own sessions is not a thing, so whoever is asking is
    // left off their own list.
    const asking = (payload.adminEmail || "").toLowerCase().trim();

    const mentors = mentorRecs
      .filter((r) => (r.fields["Status"] || "") === "Hired")
      .filter((r) => String(r.fields["Email"] || "").toLowerCase().trim() !== asking)
      .map((r) => {
        const email = String(r.fields["Email"] || "").toLowerCase().trim();
        const sessions = byMentor[email] || [];
        const hit = qualify(sessions);
        const mentees = new Set(sessions.map((s) => (s.mentee || "").trim().toLowerCase()));
        const doneOn = String(r.fields[DONE_FIELD] || "").slice(0, 10);
        const shadowedOn = String(r.fields[SHADOW_FIELD] || "").slice(0, 10);
        return {
          id: r.id,
          name: r.fields["Name"] || email || "Unnamed",
          email,
          sessions: sessions.length,
          mentees: mentees.size,
          last: sessions.length ? sessions[sessions.length - 1].date : "",
          qualified: Boolean(hit),
          hit,
          waitingDays: hit ? days(hit.on) : null,
          doneOn,
          shadowedOn,
          // Both ticks, or the mentor is still on the list.
          settled: Boolean(doneOn && shadowedOn),
          notes: r.fields[NOTES_FIELD] || "",
        };
      });

    // Longest waiting at the top: that is the one most overdue a sit-in.
    const due = mentors.filter((m) => m.qualified && !m.settled)
      .sort((a, b) => b.waitingDays - a.waitingDays);
    const done = mentors.filter((m) => m.settled)
      .sort((a, b) => b.doneOn.localeCompare(a.doneOn));
    // Not enough sessions yet, but a half-tick keeps them visible rather than
    // buried: shadowing often happens before a mentor has their own reps.
    const notYet = mentors.filter((m) => !m.qualified && !m.settled)
      .sort((a, b) => b.sessions - a.sessions);

    return json(200, {
      due, done, notYet,
      rule: { sameMentee: SAME_MENTEE, acrossMentees: ACROSS_MENTEES },
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }
};
