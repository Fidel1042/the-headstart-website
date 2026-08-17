// session-reminders.js — scheduled job that sends:
//   1. To each mentor: a session they booked for tomorrow.
//   2. To Fidel, on Mondays: every acquired mentee who has gone quiet, meaning
//      15+ days since their last session with nothing booked and no hold.
//      Mentors are deliberately not emailed about quiet mentees.
// Runs hourly (netlify.toml) but only sends at the Melbourne send window:
// weekdays 5:15pm, weekends 10am. Sends via Brevo, same sender as the payslips.
// Manual dry run (no emails, ignores the time window):
//   /.netlify/functions/session-reminders?dryRun=1

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TZ = "Australia/Sydney";
const REACH_OUT_DAYS = 15;
// Mentors are no longer emailed about quiet mentees, so the nudging has to land
// somewhere. This is that somewhere: one list, once a week, on a fixed day.
// Every mentee has their own clock, so qualifying dates are scattered across the
// week; batching them into one email beats several one-line ones.
const FIDEL = { email: "fidelhon@gmail.com", name: "Fidel" };
const NUDGE_DIGEST_DAY = "Mon";

const { buildEmail, buildNudgeEmail } = require("../shared/reminder-emails");
const { menteeState, lapseToCount } = require("../shared/mentee-state");

const ymd = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

// Melbourne local weekday + hour + minute (the job runs hourly at :00 and :15
// UTC; Melbourne is a whole-hour offset so the minutes line up).
function melbNow() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  return { weekday: get("weekday"), hour: parseInt(get("hour"), 10) % 24, minute: parseInt(get("minute"), 10) };
}
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

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

async function sendEmail(apiKey, to, name, subject, html) {
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ sender: SENDER, to: [{ email: to, name }], subject, htmlContent: html }),
  });
}

async function patchMentee(baseId, tableId, recordId, fields, token) {
  await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  }).catch(() => {});
}

exports.handler = async (event) => {
  const {
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_SESSION_TABLE_ID, BREVO_API_KEY,
  } = process.env;

  const dryRun = Boolean(event && event.queryStringParameters && event.queryStringParameters.dryRun);

  // Send window: weekdays 5:15pm, weekends 10:00am Melbourne. Every other
  // hourly run exits here before touching Airtable. Dry runs bypass the gate.
  const m = melbNow();
  const isWeekend = m.weekday === "Sat" || m.weekday === "Sun";
  const inWindow = isWeekend ? (m.hour === 10 && m.minute === 0) : (m.hour === 17 && m.minute === 15);
  if (!dryRun && !inWindow) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, melb: m }) };
  }

  const today = ymd(new Date());
  const tomorrow = addDays(today, 1);

  try {
    // Active, acquired mentees with a mentor assigned.
    const menteeRecs = await fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
      ["Name", "Client Pipeline", "Mentor Email Plain", "Mentor Name",
       "Last Reminded", "First Reminded", "Next Session", "On Hold Until",
       "Lapse Count", "Last Chased", "Lapse Counted For", "Created", "Pipeline Changed"], AIRTABLE_API_TOKEN);
    const active = new Map();
    const byName = new Map(); // lowercased mentee name -> record id (for older
                              // session rows whose Mentee Record ID is blank)
    menteeRecs.forEach((r) => {
      const f = r.fields;
      const email = (f["Mentor Email Plain"] || "").toLowerCase().trim();
      if ((f["Client Pipeline"] || "") === "Acquired" && email) {
        const mn = f["Mentor Name"];
        const name = f["Name"] || "";
        active.set(r.id, {
          name,
          mentorEmail: email,
          mentorName: (Array.isArray(mn) ? mn[0] : mn) || email,
          lastReminded:  (f["Last Reminded"]   || "").slice(0, 10),
          firstReminded: (f["First Reminded"]  || "").slice(0, 10),
          holdUntil:     (f["On Hold Until"]    || "").slice(0, 10),
          lastChased:    (f["Last Chased"]      || "").slice(0, 10),
          lapses:        Number(f["Lapse Count"]) || 0,
          lapseCountedFor: (f["Lapse Counted For"] || "").slice(0, 10),
          createdAt:     (f["Created"]          || "").slice(0, 10),
          startedAt:     (f["Pipeline Changed"] || "").slice(0, 10),
          // The one agreed next session. Mentors write it here when they log,
          // and the portal writes it here too, so there is a single date to read.
          expected:      (f["Next Session"]    || "").slice(0, 10),
        });
        if (name) byName.set(name.trim().toLowerCase(), r.id);
      }
    });

    // Session history for those mentees.
    const rows = await fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
      ["Date", "Next Session", "Mentee Record ID", "Mentee Name", "Payment Status", "Amount Charged"], AIRTABLE_API_TOKEN);
    const agg = new Map(); // menteeId -> { lastDate, hasFuture, tomorrow }
    rows.forEach((r) => {
      const f = r.fields;
      // Match by record id; fall back to mentee name when the id is blank.
      let id = f["Mentee Record ID"] || "";
      if (!active.has(id)) id = byName.get((f["Mentee Name"] || "").trim().toLowerCase()) || "";
      if (!active.has(id)) return;
      const purchase = f["Payment Status"] === "Package" && (parseFloat(f["Amount Charged"]) || 0) > 0;
      const date = (f["Date"] || "").slice(0, 10);
      const next = (f["Next Session"] || "").slice(0, 10);
      const a = agg.get(id) || { lastDate: "", hasFuture: false, tomorrow: false, lastBooked: "" };
      if (date && !purchase && date > a.lastDate) a.lastDate = date;
      if (next && next > a.lastBooked) a.lastBooked = next;
      if (next && next >= today) a.hasFuture = true;
      if (next === tomorrow) a.tomorrow = true;
      agg.set(id, a);
    });

    // Fold in sessions Koko booked from the admin view. Done after the session
    // rows so a mentee with no sessions yet still gets an entry: without this
    // they are skipped entirely below and their first booking never reminds.
    active.forEach((m, id) => {
      if (!m.expected) return;
      const a = agg.get(id) || { lastDate: "", hasFuture: false, tomorrow: false, lastBooked: "" };
      if (m.expected >= today) a.hasFuture = true;
      if (m.expected === tomorrow) a.tomorrow = true;
      agg.set(id, a);
    });

    // Group reminders by mentor.
    const byMentor = new Map();
    const bucket = (email, name) => {
      if (!byMentor.has(email)) byMentor.set(email, { name, tomorrow: [], reachout: [] });
      return byMentor.get(email);
    };
    const lapsedList = []; // agreed date came and went, nothing logged
    const noDateList = []; // nothing in the diary at all
    const toReset  = [];  // booked again: clear the stamps so the cycle restarts
    active.forEach((m, id) => {
      const a = agg.get(id);
      if (!a) return;
      if (a.tomorrow) bucket(m.mentorEmail, m.mentorName).tomorrow.push(m.name);

      // Booked again. Clear the stamps, otherwise a mentee who goes quiet months
      // later would look like they had been chased since the old date.
      if (a.hasFuture) {
        if (m.lastReminded || m.firstReminded) toReset.push(id);
        return;
      }
      if (!a.lastDate) return;

      const gap = daysBetween(a.lastDate, today);
      // Nudge once overdue, then again every 7 days until they book or drop.
      const dueForNudge = !m.lastReminded || daysBetween(m.lastReminded, today) >= 7;
      if (gap >= REACH_OUT_DAYS && dueForNudge) {
        bucket(m.mentorEmail, m.mentorName).reachout.push({ id, name: m.name, gap, first: !m.firstReminded });
      }

      // Fidel's weekly list: mentees with NO next session date anywhere, from
      // either the mentor's session row or the mentee status page.
      //
      // A date that exists but has passed is deliberately not on this list. It
      // shows on the mentee status page as "Missed", which is a different job:
      // find out whether that session happened. This email is only for the ones
      // with nothing in the diary at all, so the action is always the same.
      // State comes from one shared resolver, so this email, the mentee status
      // page and the mentor portal can never disagree about who needs chasing.
      const st = menteeState({
        expected: m.expected, lastSession: a.lastDate, createdAt: m.createdAt, startedAt: m.startedAt,
        holdUntil: m.holdUntil, lastChased: m.lastChased, lapses: m.lapses,
      }, today);
      if (st.needsAction) {
        (st.key === "lapsed" ? lapsedList : noDateList).push({
          name: m.name, mentor: m.mentorName,
          lastDate: a.lastDate, expected: st.date || "",
          days: st.days, lapses: st.lapses,
        });
      }

    });

    // Send (or preview on a dry run).
    const summary = [];
    let sent = 0;
    for (const [email, b] of byMentor) {
      // Mentors are only emailed about a session tomorrow. The reach-out nudge
      // was dropped from their inbox on purpose: chasing a quiet mentee is
      // an admin job, and a mentor who gets nagged weekly stops reading the
      // emails that actually matter. The reach-out tracking below still runs,
      // it just no longer lands in a mentor's Gmail.
      if (!b.tomorrow.length) continue;
      summary.push({ mentor: email, tomorrow: b.tomorrow });
      if (!dryRun && BREVO_API_KEY) {
        await sendEmail(BREVO_API_KEY, email, b.name, "Reminder: you have a session tomorrow",
          buildEmail({ name: b.name, tomorrow: b.tomorrow, reachout: [] }));
        sent++;
      }
    }

    // Stamped whether or not the mentor was emailed. These are the clocks the
    // 7-day re-nudge spacing counts from.
    if (!dryRun) {
      for (const [, b] of byMentor) {
        for (const r of b.reachout) {
          const fields = { "Last Reminded": today };
          // Written once and never overwritten: it is the start of the clock.
          if (r.first) fields["First Reminded"] = today;
          await patchMentee(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, r.id, fields, AIRTABLE_API_TOKEN);
        }
      }
    }

    // Repeat offenders first, then longest overdue.
    lapsedList.sort((a, b) => (b.lapses - a.lapses) || (b.days - a.days));
    noDateList.sort((a, b) => (b.days || 0) - (a.days || 0));
    const nudgeDay = m.weekday === NUDGE_DIGEST_DAY;
    const nudgeTotal = lapsedList.length + noDateList.length;
    if (nudgeTotal && nudgeDay && !dryRun && BREVO_API_KEY) {
      await sendEmail(BREVO_API_KEY, FIDEL.email, FIDEL.name,
        `${nudgeTotal} to follow up this week`,
        buildNudgeEmail(lapsedList, noDateList));
    }

    // Count each missed date once, whether or not it is a send day, so the
    // lapse tally is accurate even between digests.
    if (!dryRun) {
      for (const [id, mm] of active) {
        const a = agg.get(id);
        if (!a) continue;
        const due = lapseToCount({
          expected: mm.expected, lastSession: a.lastDate, lapseCountedFor: mm.lapseCountedFor,
        }, today);
        if (!due) continue;
        await patchMentee(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, id,
          { "Lapse Count": (mm.lapses || 0) + 1, "Lapse Counted For": due }, AIRTABLE_API_TOKEN);
      }
    }


    if (!dryRun) {
      for (const id of toReset) {
        await patchMentee(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, id,
          { "Last Reminded": null, "First Reminded": null }, AIRTABLE_API_TOKEN);
      }
    }

    return { statusCode: 200, body: JSON.stringify({
      date: today, dryRun, mentorsEmailed: sent, summary,
      nudgeDigestDay: NUDGE_DIGEST_DAY, nudgeSendsToday: nudgeDay, lapsedList, noDateList,
      stampsCleared: toReset.length,
    }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Reminder job failed" }) };
  }
};
