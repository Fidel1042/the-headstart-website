// reminder-emails.js — HTML bodies for the scheduled mentor reminders.
// Split out of session-reminders.js to keep that file under the 250-line cap.
// Email clients cannot read CSS variables, so colours here are literal on
// purpose; they are not part of the site's design token system.

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const firstName = (n) => String(n || "there").trim().split(/\s+/)[0];

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

// The mentor's email: a session tomorrow, mentees to chase, or both.
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



/**
 * Fidel's Monday list, in the two states that need different conversations.
 *
 *   lapsed  an agreed date came and went with nothing logged. Check the
 *           WhatsApp group, then nudge the mentor. A repeat count is shown
 *           because twice is a pattern and three times is a mentee who has
 *           quietly stopped.
 *   nodate  nobody has agreed when to meet again at all.
 *
 * Anyone on hold, or chased in the last few days, is excluded upstream.
 */
function buildNudgeEmail(lapsed, noDate) {
  const cell = (v, last) =>
    `<td style="padding:8px ${last ? 0 : 14}px 8px 0;border-bottom:1px solid #e6e1d5">${v}</td>`;
  const table = (cols, rows) =>
    `<table style="border-collapse:collapse;font-size:14px;margin-bottom:6px"><tr>` +
    cols.map((c, i) => `<th align="left" style="padding:0 ${i === cols.length - 1 ? 0 : 14}px 8px 0;border-bottom:2px solid #d9d3c4">${c}</th>`).join("") +
    `</tr>${rows}</table>`;

  let html = `<p>Morning Fidel,</p>`;

  if (lapsed.length) {
    const rows = lapsed.map((n) =>
      `<tr>${cell(esc(n.name))}${cell(esc(n.mentor))}` +
      `${cell(esc(n.expected))}${cell("<strong>" + n.days + " days ago</strong>")}` +
      `${cell(n.lapses > 1 ? `<strong>${n.lapses}x</strong>` : "&mdash;", true)}</tr>`).join("");
    html += `<p><strong>${lapsed.length} agreed session${lapsed.length === 1 ? " has" : "s have"} not happened.</strong> ` +
      `Check the WhatsApp group, then nudge the mentor. If a new date comes out of it, ` +
      `set it on the mentee status page and this clears.</p>` +
      table(["Mentee", "Mentor", "Was booked for", "Overdue", "Lapsed"], rows);
  }

  if (noDate.length) {
    const rows = noDate.map((n) =>
      `<tr>${cell(esc(n.name))}${cell(esc(n.mentor))}` +
      `${cell(esc(n.lastDate || "never"))}` +
      `${cell(n.days === null ? "&mdash;" : "<strong>" + n.days + " days</strong>", true)}</tr>`).join("");
    html += `<p style="margin-top:18px"><strong>${noDate.length} ` +
      `${noDate.length === 1 ? "mentee has" : "mentees have"} no next session agreed at all.</strong></p>` +
      table(["Mentee", "Mentor", "Last session", "Quiet for"], rows);
  }

  html += `<p style="margin-top:16px">On the mentee status page: <strong>Set date</strong> once one is agreed, ` +
    `<strong>Chased</strong> to park it for a few days, or <strong>Hold</strong> if they have asked for time.</p>`;
  return html;
}

module.exports = { buildEmail, buildNudgeEmail, firstName, esc };

/**
 * Fidel's Monday list, in the two states that need different conversations.
 *
 *   lapsed  an agreed date came and went with nothing logged. Check the
 *           WhatsApp group, then nudge the mentor. A repeat count is shown
 *           because twice is a pattern and three times is a mentee who has
 *           quietly stopped.
 *   nodate  nobody has agreed when to meet again at all.
 *
 * Anyone on hold, or chased in the last few days, is excluded upstream.
 */
function buildNudgeEmail(lapsed, noDate) {
  const cell = (v, last) =>
    `<td style="padding:8px ${last ? 0 : 14}px 8px 0;border-bottom:1px solid #e6e1d5">${v}</td>`;
  const table = (cols, rows) =>
    `<table style="border-collapse:collapse;font-size:14px;margin-bottom:6px"><tr>` +
    cols.map((c, i) => `<th align="left" style="padding:0 ${i === cols.length - 1 ? 0 : 14}px 8px 0;border-bottom:2px solid #d9d3c4">${c}</th>`).join("") +
    `</tr>${rows}</table>`;

  let html = `<p>Morning Fidel,</p>`;

  if (lapsed.length) {
    const rows = lapsed.map((n) =>
      `<tr>${cell(esc(n.name))}${cell(esc(n.mentor))}` +
      `${cell(esc(n.expected))}${cell("<strong>" + n.days + " days ago</strong>")}` +
      `${cell(n.lapses > 1 ? `<strong>${n.lapses}x</strong>` : "&mdash;", true)}</tr>`).join("");
    html += `<p><strong>${lapsed.length} agreed session${lapsed.length === 1 ? " has" : "s have"} not happened.</strong> ` +
      `Check the WhatsApp group, then nudge the mentor. If a new date comes out of it, ` +
      `set it on the mentee status page and this clears.</p>` +
      table(["Mentee", "Mentor", "Was booked for", "Overdue", "Lapsed"], rows);
  }

  if (noDate.length) {
    const rows = noDate.map((n) =>
      `<tr>${cell(esc(n.name))}${cell(esc(n.mentor))}` +
      `${cell(esc(n.lastDate || "never"))}` +
      `${cell(n.days === null ? "&mdash;" : "<strong>" + n.days + " days</strong>", true)}</tr>`).join("");
    html += `<p style="margin-top:18px"><strong>${noDate.length} ` +
      `${noDate.length === 1 ? "mentee has" : "mentees have"} no next session agreed at all.</strong></p>` +
      table(["Mentee", "Mentor", "Last session", "Quiet for"], rows);
  }

  html += `<p style="margin-top:16px">On the mentee status page: <strong>Set date</strong> once one is agreed, ` +
    `<strong>Chased</strong> to park it for a few days, or <strong>Hold</strong> if they have asked for time.</p>`;
  return html;
}

module.exports = { buildEmail, buildNudgeEmail, firstName, esc };
