// mentor-activity.js — who is actually mentoring right now.
//
// "Hired" says somebody is on the books. It says nothing about whether they
// have seen a mentee this month. Active is the working definition: a session
// logged in the last 10 days.
//
// It matters for pay runs because the old run only emailed mentors who had
// money owing. A mentor who forgot to log their sessions got silence, which
// looks identical to a quiet week, so nobody noticed until they chased.

const ACTIVE_DAYS = 10;

const PORTAL_URL = "https://theheadstartmentoring.com/mentor-portal/index.html";

// Fidel and Koko mentor, so they show up as active, but they are not chased
// about their own logging by their own system.
const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];

/** ISO date, n days before today. */
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Every mentor with a session logged inside the window, keyed by lowercased
 * email. Reads the Session Log, because that is where a session becomes real.
 */
async function activeMentors(env, days = ACTIVE_DAYS) {
  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = env;
  const since = daysAgo(days);
  const formula = encodeURIComponent(`IS_AFTER({Date}, "${since}")`);

  const out = {};
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${formula}&pageSize=100${offset ? `&offset=${offset}` : ""}` +
      `&fields[]=Mentor%20Email&fields[]=Mentor%20Name&fields[]=Date`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Could not read the session log");

    for (const r of data.records || []) {
      const email = (r.fields["Mentor Email"] || "").toLowerCase().trim();
      if (!email) continue;
      const date = (r.fields["Date"] || "").slice(0, 10);
      if (!out[email]) out[email] = { email, name: r.fields["Mentor Name"] || email, last: date, count: 0 };
      out[email].count += 1;
      if (date > out[email].last) out[email].last = date;
    }
    offset = data.offset || null;
  } while (offset);

  return out;
}

/**
 * Write Active and Last Session onto the Mentors table so the state is visible
 * in Airtable and the portal, not only inside a pay run. Everybody hired gets
 * written, so somebody who goes quiet is unticked rather than left looking
 * active forever.
 */
async function syncActiveFlags(env, active) {
  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID } = env;
  if (!AIRTABLE_CORE_BASE_ID || !AIRTABLE_MENTOR_TABLE_ID) return { updated: 0 };
  const h = { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" };

  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}` +
    `?filterByFormula=${encodeURIComponent('{Status}="Hired"')}&pageSize=100` +
    `&fields[]=Email&fields[]=Active&fields[]=Last%20Session`,
    { headers: h }
  );
  const data = await res.json();
  if (data.error) return { updated: 0 };

  const updates = [];
  for (const r of data.records || []) {
    const email = (r.fields["Email"] || "").toLowerCase().trim();
    const hit = active[email];
    const isActive = Boolean(hit);
    const last = hit ? hit.last : (r.fields["Last Session"] || "").slice(0, 10);
    // Only write when something actually changed, so a pay run does not touch
    // every mentor record and churn Last Modified for no reason.
    if (Boolean(r.fields["Active"]) === isActive &&
        (r.fields["Last Session"] || "").slice(0, 10) === last) continue;
    updates.push({ id: r.id, fields: { "Active": isActive, "Last Session": last || null } });
  }

  for (let i = 0; i < updates.length; i += 10) {
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}`, {
      method: "PATCH", headers: h, body: JSON.stringify({ records: updates.slice(i, i + 10) }),
    });
  }
  return { updated: updates.length };
}

/** The line that sends a mentor back to log anything they missed. */
const portalPrompt = (label) => `
  <p style="margin:24px 0 0;font-size:13px;color:#555;">
    ${label}
    <a href="${PORTAL_URL}" style="color:#8a6210;font-weight:600;">Log it in the portal</a>
    and it goes on the next payslip.
  </p>`;

/** Sent to an active mentor whose pay run came to nothing. */
const nudgeHtml = (name, weekLabel, last) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f9;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
    <div style="background:#000;padding:28px 32px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#c79b3b;font-weight:700;">The Headstart</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">Nothing to pay this week</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 6px;font-size:15px;color:#111;">Hi ${name},</p>
      <p style="margin:0 0 16px;font-size:14px;color:#555;">There are no unpaid sessions against your name for <strong>${weekLabel}</strong>, so there is no payout going out to you.</p>
      <p style="margin:0 0 16px;font-size:14px;color:#555;">Your last logged session was <strong>${last}</strong>. If you have run any since then, they are not in the system yet, which means they will not be paid.</p>
      ${portalPrompt("Ran a session that is not on here?")}
      <p style="margin:16px 0 0;font-size:13px;color:#888;">If you genuinely had no sessions, ignore this.</p>
    </div>
    <div style="background:#f5f5f5;padding:16px 32px;">
      <p style="margin:0;font-size:12px;color:#aaa;">The Headstart Mentoring &nbsp;·&nbsp; Internal payslip</p>
    </div>
  </div>
</body>
</html>`;

module.exports = { ACTIVE_DAYS, PORTAL_URL, OWNERS, activeMentors, syncActiveFlags, portalPrompt, nudgeHtml };
