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

// Koko's check-in. One digest listing every mentee whose mentor was nudged
// checkDays+ ago and who still has nothing booked, so she can check the mentor
// actually followed up rather than each of them getting a separate email.
function buildKokoEmail(list, checkDays) {
  const rows = list.map((k) => `
    <tr>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${esc(k.name)}</td>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${esc(k.mentor)}</td>
      <td style="padding:8px 14px 8px 0;border-bottom:1px solid #e6e1d5">${k.gap} days</td>
      <td style="padding:8px 0;border-bottom:1px solid #e6e1d5">${k.since} days ago</td>
    </tr>`).join("");

  return `<p>Hi Koko,</p>` +
    `<p>These mentees still have nothing booked, and their mentor was first asked to reach out at least ${checkDays} days ago.</p>` +
    `<table style="border-collapse:collapse;font-size:14px">` +
    `<tr><th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Mentee</th>` +
    `<th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Mentor</th>` +
    `<th align="left" style="padding:0 14px 8px 0;border-bottom:2px solid #d9d3c4">Last session</th>` +
    `<th align="left" style="padding:0 0 8px;border-bottom:2px solid #d9d3c4">Mentor nudged</th></tr>` +
    rows + `</table>` +
    `<p>Worth checking whether the mentor actually messaged them.</p>`;
}

module.exports = { buildEmail, buildKokoEmail, firstName, esc };
