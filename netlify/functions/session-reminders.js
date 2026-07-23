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
// A mentee qualifies for Koko's check 10 days after their mentor's FIRST nudge
// about them. It has to key off the first nudge, not "Last Reminded": that one
// is re-stamped every 7 days while the nudge cycle runs, so a 10 day gap from
// it never arrives.
//
// Every mentee has their own clock, so qualifying dates are scattered across
// the week. Sending on each qualifying date would mean several one-line emails.
// Instead the digest goes out on one fixed day and carries everyone who has
// qualified by then, so Koko gets exactly one list a week.
const KOKO_CHECK_DAYS = 10;
const KOKO_DIGEST_DAY = "Mon";
const KOKO = { email: "kokoro.araki1015@gmail.com", name: "Koko" };

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

async function patchMentee(baseId, tableId, recordId, fields, token) {
  await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
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
  // Closing nudge, only on the inactive-mentee email. Payouts are worked out
  // from logged sessions, so an unlogged session is an unpaid one.
  if (b.reachout.length) {
    h += `<p>If you haven't logged any sessions in the past few weeks, <strong>we won't be able to pay you</strong>, so log them now!</p>`;
  }
  return h;
}

// Koko's check-in. One digest listing every mentee whose mentor was nudged 10+
// days ago and who still has nothing booked, so she can check the mentor
// actually followed up rather than each of them getting a separate email.
function buildKokoEmail(list) {
  const rows = list.map((k) => `
    <tr>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${esc(k.name)}</td>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${esc(k.mentor)}</td>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${k.gap} days</td>
      <td style="padding:8px 0;border-bottom:1px solid #e6e1d5">${k.since} days ago</td>
    </tr>`).join("");

  return `<p>Hi Koko,</p>` +
    `<p>These mentees still have nothing booked, and their mentor was first asked to reach out at least ${KOKO_CHECK_DAYS} days ago.</p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    `<tr><th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Mentee</th>` +
    `<th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Mentor</th>` +
    `<th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Last session</th>` +
    `<th align="left" style="padding:0 0 8px;border-bottom:2px solid #d9d3c4">Mentor nudged</th></tr>` +
    rows + `</table>` +
    `<p>Worth checking whether the mentor actually messaged them.</p>`;
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
       "Last Reminded", "First Reminded", "Koko Checked At"], AIRTABLE_API_TOKEN);
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
          kokoChecked:   (f["Koko Checked At"] || "").slice(0, 10),
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
    const kokoList = [];  // mentees to escalate to Koko
    const toReset  = [];  // booked again: clear the stamps so the cycle restarts
    active.forEach((m, id) => {
      const a = agg.get(id);
      if (!a) return;
      if (a.tomorrow) bucket(m.mentorEmail, m.mentorName).tomorrow.push(m.name);

      // Booked again. Clear the stamps, otherwise a mentee who goes quiet months
      // later would look like they had been chased since the old date and Koko
      // would be escalated to on the very first nudge.
      if (a.hasFuture) {
        if (m.lastReminded || m.firstReminded || m.kokoChecked) toReset.push(id);
        return;
      }
      if (!a.lastDate) return;

      const gap = daysBetween(a.lastDate, today);
      // Nudge once overdue, then again every 7 days until they book or drop.
      const dueForNudge = !m.lastReminded || daysBetween(m.lastReminded, today) >= 7;
      if (gap >= REACH_OUT_DAYS && dueForNudge) {
        bucket(m.mentorEmail, m.mentorName).reachout.push({ id, name: m.name, gap, first: !m.firstReminded });
      }

      // Qualifies for Koko's weekly digest once the mentor's first nudge is 10+
      // days old and still nothing is booked. They stay on the list every week
      // until they book, with "nudged X days ago" climbing so a mentee going
      // nowhere becomes more obvious each time rather than blending in.
      if (m.firstReminded && daysBetween(m.firstReminded, today) >= KOKO_CHECK_DAYS) {
        kokoList.push({
          id, name: m.name, mentor: m.mentorName, gap,
          since: daysBetween(m.firstReminded, today),
          lastChecked: m.kokoChecked,
        });
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
        // "First Reminded" is written once and never overwritten: it is the
        // clock Koko's check-in counts from.
        for (const r of b.reachout) {
          const fields = { "Last Reminded": today };
          if (r.first) fields["First Reminded"] = today;
          await patchMentee(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, r.id, fields, AIRTABLE_API_TOKEN);
        }
      }
    }

    // Koko's check-in: did the mentors actually chase these mentees? One digest
    // on the fixed day, sorted worst first.
    kokoList.sort((a, b) => b.since - a.since);
    const kokoDay = m.weekday === KOKO_DIGEST_DAY;
    if (kokoList.length && kokoDay && !dryRun && BREVO_API_KEY) {
      await sendEmail(BREVO_API_KEY, KOKO.email, KOKO.name,
        `${kokoList.length} mentee${kokoList.length === 1 ? "" : "s"} to check on`, buildKokoEmail(kokoList));
      for (const k of kokoList) {
        await patchMentee(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, k.id,
          { "Koko Checked At": today }, AIRTABLE_API_TOKEN);
      }
    }

    if (!dryRun) {
      for (const id of toReset) {
        await patchMentee(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, id,
          { "Last Reminded": null, "First Reminded": null, "Koko Checked At": null }, AIRTABLE_API_TOKEN);
      }
    }

    return { statusCode: 200, body: JSON.stringify({
      date: today, dryRun, mentorsEmailed: sent, summary,
      kokoDigestDay: KOKO_DIGEST_DAY, kokoSendsToday: kokoDay,
      kokoCheck: kokoList, stampsCleared: toReset.length,
    }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Reminder job failed" }) };
  }
};
