// session-reminders.js — scheduled job that emails mentors:
//   1. Upcoming: a session they booked for tomorrow.
//   2. Reach out: an active mentee whose last session was 10+ days ago with no
//      future session booked. Nudged weekly (day 10, 17, 24 ...) so it is not
//      a daily nag.
// Runs hourly (netlify.toml) but only sends at the Melbourne send window:
// weekdays 5:15pm, weekends 10am. Sends via Brevo, same sender as the payslips.
// Manual dry run (no emails, ignores the time window):
//   /.netlify/functions/session-reminders?dryRun=1

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TZ = "Australia/Sydney";
const REACH_OUT_DAYS = 10;

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
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const firstName = (n) => String(n || "there").trim().split(/\s+/)[0];

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

// Stamp today's date so the mentee is not nudged again for another 7 days.
async function markReminded(baseId, tableId, recordId, date, token) {
  await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { "Last Reminded": date } }),
  }).catch(() => {});
}

function boldNames(names) {
  const b = names.map((n) => `<strong>${esc(n)}</strong>`);
  if (b.length === 1) return b[0];
  return b.slice(0, -1).join(", ") + " and " + b[b.length - 1];
}

// A ready-to-paste message the mentor can copy into the group. The bracketed
// bits are placeholders the mentor fills in before sending.
function copyBox(name) {
  const msg = `Hi ${firstName(name)}, it's been a while since our last session, but we should really work on [Next steps based on last session] next for you to land a role in time. How does [Insert your availability] work for you for our next session?`;
  return `<div style="margin:8px 0 18px;padding:12px 14px;border:1px solid #d9d3c4;border-radius:8px;background:#faf8f2;color:#333;white-space:pre-wrap">${esc(msg)}</div>`;
}

function buildEmail(b) {
  let h = `<p>Hi ${esc(firstName(b.name))},</p>`;
  if (b.tomorrow.length) {
    const s = b.tomorrow.length === 1
      ? `a session with ${boldNames(b.tomorrow)}`
      : `sessions with ${boldNames(b.tomorrow)}`;
    h += `<p>You have ${s} tomorrow!<br>Reach out in the whatsapp group if you need to reschedule.</p>`;
  }
  b.reachout.forEach((r, i) => {
    const lead = (i === 0 && b.tomorrow.length) ? "Also, just a heads up" : "Just a heads up";
    h += `<p>${lead} - <strong>${esc(r.name)}'s</strong> last session was ${r.gap} days ago and nothing's booked yet.</p>` +
      `<p>Might be worth reaching out to check in with them!<br>Here's a message you can send to the group:</p>` +
      copyBox(r.name);
  });
  return h;
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
      ["Name", "Client Pipeline", "Mentor Email Plain", "Mentor Name", "Last Reminded"], AIRTABLE_API_TOKEN);
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
          lastReminded: (f["Last Reminded"] || "").slice(0, 10),
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
      const a = agg.get(id) || { lastDate: "", hasFuture: false, tomorrow: false };
      if (date && !purchase && date > a.lastDate) a.lastDate = date;
      if (next && next >= today) a.hasFuture = true;
      if (next === tomorrow) a.tomorrow = true;
      agg.set(id, a);
    });

    // Group reminders by mentor.
    const byMentor = new Map();
    const bucket = (email, name) => {
      if (!byMentor.has(email)) byMentor.set(email, { name, tomorrow: [], reachout: [] });
      return byMentor.get(email);
    };
    active.forEach((m, id) => {
      const a = agg.get(id);
      if (!a) return;
      if (a.tomorrow) bucket(m.mentorEmail, m.mentorName).tomorrow.push(m.name);
      if (a.lastDate && !a.hasFuture) {
        const gap = daysBetween(a.lastDate, today);
        // Nudge once overdue, then again every 7 days until they book or drop.
        const dueForNudge = !m.lastReminded || daysBetween(m.lastReminded, today) >= 7;
        if (gap >= REACH_OUT_DAYS && dueForNudge) {
          bucket(m.mentorEmail, m.mentorName).reachout.push({ id, name: m.name, gap });
        }
      }
    });

    // Send (or preview on a dry run).
    const summary = [];
    let sent = 0;
    for (const [email, b] of byMentor) {
      if (!b.tomorrow.length && !b.reachout.length) continue;
      const subject = b.tomorrow.length ? "Reminder: you have a session tomorrow" : "A mentee to reach out to";
      summary.push({ mentor: email, tomorrow: b.tomorrow, reachout: b.reachout.map((r) => r.name) });
      if (!dryRun && BREVO_API_KEY) {
        await sendEmail(BREVO_API_KEY, email, b.name, subject, buildEmail(b));
        sent++;
        // Stamp each nudged mentee so it waits 7 days before the next nudge.
        for (const r of b.reachout) {
          await markReminded(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, r.id, today, AIRTABLE_API_TOKEN);
        }
      }
    }

    return { statusCode: 200, body: JSON.stringify({ date: today, dryRun, mentorsEmailed: sent, summary }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Reminder job failed" }) };
  }
};
