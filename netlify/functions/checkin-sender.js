// checkin-sender.js — sends the t+90 check-in automatically.
//
// The first four touches stay manual: they are sales follow-ups, they use the
// drafted messages, and they need a human deciding whether to send at all. The
// t+90 is different. It is the same plain question to everybody three months
// on, so there is nothing to decide and no reason for it to sit in a list.
//
// Runs Mondays at 2pm Melbourne: everyone who came due during the week goes
// out in one batch, so replies land in one afternoon rather than trickling in
// every morning. Sends via Brevo, advances the follow-up stage, and reports
// back to Fidel so a mentee replying "yes still looking" is never a surprise.
//
// Netlify cron is UTC only, so the job is scheduled either side of the
// Melbourne 2pm and the code decides which run is the real one. That way it
// stays at 2pm local through daylight saving instead of drifting an hour.
//
// Manual dry run (no emails, nothing written):
//   /.netlify/functions/checkin-sender?dryRun=1

const {
  CHECKIN_SUBJECT, checkinBody, scoreOf, nextTouch, ymd,
} = require("../shared/followups");

const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };
const NOTIFY = { email: "fidelhon@gmail.com", name: "Fidel" };
const OPEN_STAGE = "Waiting on Contract";

// A ceiling per run. The weekly batch should be small, so this only exists to
// stop a data problem turning into a mass mailout from an address that has to
// stay deliverable. Anything above it waits for next Monday.
const MAX_PER_RUN = 40;

const TZ = "Australia/Sydney";
const SEND_DAY = "Mon";
const SEND_HOUR = 14;

// Melbourne local weekday and hour, so daylight saving is handled by the clock
// rather than by editing the cron twice a year.
function melbNow() {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => (p.find((x) => x.type === t) || {}).value;
  return { weekday: get("weekday"), hour: parseInt(get("hour"), 10) % 24 };
}

const headers = { "Content-Type": "application/json" };
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

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

async function sendEmail(apiKey, to, name, subject, text, replyTo) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: to, name }],
      subject,
      textContent: text,
      replyTo: replyTo || SENDER,
    }),
  });
  if (res.ok) return { ok: true, reason: "" };
  // Keep the reason: a silent failure here means a lead is marked contacted
  // when they never were.
  let reason = `HTTP ${res.status}`;
  try { const e = await res.json(); reason = e.message || e.code || reason; } catch { /* keep status */ }
  return { ok: false, reason };
}

exports.handler = async (event) => {
  const {
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, BREVO_API_KEY,
  } = process.env;

  const dryRun = Boolean(event && event.queryStringParameters && event.queryStringParameters.dryRun);
  const today = ymd(new Date());

  // Every other scheduled run exits here before touching Airtable.
  const m = melbNow();
  if (!dryRun && !(m.weekday === SEND_DAY && m.hour === SEND_HOUR)) {
    return json(200, { skipped: true, melb: m });
  }

  try {
    const recs = await fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
      ["Name", "First Name", "Client Pipeline", "Meeting Time", "Notes filled at",
       "Conversion %", "Gmail", "Follow Up Stage", "Target Industry"], AIRTABLE_API_TOKEN);

    const due = [];
    recs.forEach((r) => {
      const f = r.fields;
      if ((f["Client Pipeline"] || "") !== OPEN_STAGE) return;

      const anchor = f["Meeting Time"] || f["Notes filled at"] || "";
      if (!anchor) return;
      const consultedOn = ymd(new Date(anchor));
      const score = scoreOf(f["Conversion %"]);
      const stage = Number(f["Follow Up Stage"]) || 0;

      const t = nextTouch({ consultedOn, score, stage }, today);
      // Only the check-in is automated. Everything earlier stays on the page.
      if (!t.due || !t.next || t.next.channel !== "email") return;

      const email = (f["Gmail"] || "").trim();
      const first = f["First Name"] || String(f["Name"] || "").trim().split(/\s+/)[0] || "there";
      due.push({
        id: r.id, name: f["Name"] || "Unnamed", first, email,
        industry: f["Target Industry"] || "",
        consultedOn, age: t.age, score, stage,
      });
    });

    // Oldest first, so a backlog clears in the order it built up.
    due.sort((a, b) => (a.consultedOn || "").localeCompare(b.consultedOn || ""));
    const batch = due.slice(0, MAX_PER_RUN);

    if (dryRun) {
      return json(200, { dryRun: true, today, dueCount: due.length, wouldSend: batch });
    }

    const sent = [];
    const failed = [];
    for (const lead of batch) {
      if (!lead.email) { failed.push({ ...lead, reason: "No email on the record" }); continue; }
      if (!BREVO_API_KEY) { failed.push({ ...lead, reason: "BREVO_API_KEY missing" }); continue; }

      const res = await sendEmail(BREVO_API_KEY, lead.email, lead.name,
        CHECKIN_SUBJECT, checkinBody(lead.first, lead.industry), NOTIFY);
      if (!res.ok) { failed.push({ ...lead, reason: res.reason }); continue; }

      // Advance only after the send succeeded, so a failure is retried
      // tomorrow rather than being silently skipped forever.
      await fetch(`https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${lead.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { "Follow Up Stage": lead.stage + 1 } }),
      }).catch(() => {});
      sent.push(lead);
    }

    // Tell Fidel who was contacted. Replies come to him, so he needs to know a
    // conversation may have just started.
    if ((sent.length || failed.length) && BREVO_API_KEY) {
      const row = (l, extra) =>
        `<tr><td style="padding:6px 14px 6px 0;border-bottom:1px solid #e6e1d5">${l.name}</td>` +
        `<td style="padding:6px 14px 6px 0;border-bottom:1px solid #e6e1d5">${l.email || "&mdash;"}</td>` +
        `<td style="padding:6px 14px 6px 0;border-bottom:1px solid #e6e1d5">${l.consultedOn}</td>` +
        `<td style="padding:6px 0;border-bottom:1px solid #e6e1d5">${extra}</td></tr>`;

      let html = `<p>Morning Fidel,</p>`;
      if (sent.length) {
        html += `<p><strong>${sent.length} check-in email${sent.length === 1 ? "" : "s"} just went out</strong> ` +
          `to leads who had a consultation about three months ago. Replies come to you.</p>` +
          `<table style="border-collapse:collapse;font-size:14px">` +
          `<tr><th align="left" style="padding:0 14px 6px 0;border-bottom:2px solid #d9d3c4">Name</th>` +
          `<th align="left" style="padding:0 14px 6px 0;border-bottom:2px solid #d9d3c4">Email</th>` +
          `<th align="left" style="padding:0 14px 6px 0;border-bottom:2px solid #d9d3c4">Consulted</th>` +
          `<th align="left" style="padding:0 0 6px;border-bottom:2px solid #d9d3c4">Score</th></tr>` +
          sent.map((l) => row(l, l.score === null ? "&mdash;" : l.score + "%")).join("") +
          `</table>`;
      }
      if (failed.length) {
        html += `<p style="margin-top:16px"><strong>${failed.length} could not be sent</strong> ` +
          `and will be retried tomorrow.</p>` +
          `<table style="border-collapse:collapse;font-size:14px">` +
          failed.map((l) => row(l, l.reason)).join("") + `</table>`;
      }
      if (due.length > batch.length) {
        html += `<p style="margin-top:16px">${due.length - batch.length} more were held back this week ` +
          `and will go out next Monday. That is above the ${MAX_PER_RUN} cap, so worth a look at why.</p>`;
      }

      await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: SENDER, to: [{ email: NOTIFY.email, name: NOTIFY.name }],
          subject: `${sent.length} check-in${sent.length === 1 ? "" : "s"} sent`,
          htmlContent: html,
        }),
      }).catch(() => {});
    }

    return json(200, { today, dueCount: due.length, sent: sent.length, failed });
  } catch (err) {
    return json(500, { error: err.message || "Check-in job failed" });
  }
};
