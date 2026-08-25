const { activeMentors, syncActiveFlags, portalPrompt, nudgeHtml,
        ACTIVE_DAYS, OWNERS } = require("../shared/mentor-activity");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};


exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload = {};
  try { payload = JSON.parse(event.body || "{}"); } catch { payload = {}; }

  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_BASE_ID,
    AIRTABLE_SESSION_TABLE_ID,
    BREVO_API_KEY,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  const today     = new Date();
  const weekLabel = today.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  // All sessions not yet paid to mentor, regardless of mentee payment status
  // Every UNPAID session, regardless of age. "Mentor Paid" (set to "Yes" after
  // payment) is the source of truth, so no date window — a window would silently
  // orphan any session that missed its 7-day slot (how Koda's $20 got skipped).
  // The page sends the exact record ids it displayed. Re-querying here is what
  // broke pay runs before: money was transferred against the figures on screen,
  // then anything logged in the minutes that followed silently joined the run
  // and got marked paid without ever being transferred.
  const runIds = Array.isArray(payload.recordIds) ? payload.recordIds.filter(Boolean) : null;
  const idFilter = runIds && runIds.length
    ? `OR(${runIds.map((id) => `RECORD_ID()="${id}"`).join(",")})`
    : null;
  const baseFilter = `AND(NOT({Mentor Paid}="Yes"),NOT({Payout Held}))`;
  const formula = encodeURIComponent(idFilter ? `AND(${baseFilter},${idFilter})` : baseFilter);

  const res  = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
    `?filterByFormula=${formula}` +
    `&fields[]=Mentor%20Email&fields[]=Mentor%20Name&fields[]=Mentee%20Name&fields[]=Date&fields[]=Mentor%20Payout`,
    { headers: airtableHeaders }
  );
  const data     = await res.json();
  const sessions = data.records || [];

  // Who is actually mentoring right now, independent of who is owed money.
  // A mentor who forgot to log sessions has nothing owing and used to get
  // silence, which is indistinguishable from a genuinely quiet week.
  let active = {};
  try { active = await activeMentors(process.env, ACTIVE_DAYS); }
  catch (e) { active = {}; }

  // Group by mentor, collect record IDs per mentor
  const byMentor = {};

  for (const s of sessions) {
    const email  = (s.fields["Mentor Email"] || "").toLowerCase().trim();
    const payout = parseFloat(s.fields["Mentor Payout"]) || 0;
    if (!email || payout === 0) continue;
    const name = s.fields["Mentor Name"] || email;
    if (!byMentor[email]) byMentor[email] = { name, sessions: [], recordIds: [], total: 0 };
    byMentor[email].recordIds.push(s.id);
    byMentor[email].sessions.push({
      id:     s.id, // kept in step with get-payslips, which the preview reads
      date:   s.fields["Date"] || "",
      mentee: s.fields["Mentee Name"] || "—",
      payout,
    });
    byMentor[email].total += payout;
  }

  const mentorEmails = Object.keys(byMentor);

  // Send one email per mentor via Brevo
  const results = [];
  for (const email of mentorEmails) {
    const { name, sessions: mSessions, total } = byMentor[email];

    const sessionRows = mSessions
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${formatDate(s.date)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${s.mentee}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">$${s.payout.toFixed(2)}</td>
        </tr>`)
      .join("");

    const html = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f9;">
  <div style="max-width:520px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
    <div style="background:#000;padding:28px 32px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#c79b3b;font-weight:700;">The Headstart</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">Weekly Payslip</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 6px;font-size:15px;color:#111;">Hi ${name},</p>
      <p style="margin:0 0 24px;font-size:14px;color:#555;">Here's your payout summary for <strong>${weekLabel}</strong>.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Date</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Mentee</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600;color:#111;">Amount</th>
          </tr>
        </thead>
        <tbody>${sessionRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="2" style="padding:14px 12px;font-weight:700;font-size:15px;color:#111;">Total payout</td>
            <td style="padding:14px 12px;font-weight:700;font-size:15px;color:#111;text-align:right;">$${total.toFixed(2)} AUD</td>
          </tr>
        </tfoot>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#888;">Bank transfer is on its way. Reply to this email if anything looks off.</p>
      ${portalPrompt("Missing a session from this list?")}
    </div>
    <div style="background:#f5f5f5;padding:16px 32px;">
      <p style="margin:0;font-size:12px;color:#aaa;">The Headstart Mentoring &nbsp;·&nbsp; Internal payslip</p>
    </div>
  </div>
</body>
</html>`;

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender:      { name: "The Headstart", email: "fidel@theheadstartmentoring.com" },
        to:          [{ email, name }],
        subject:     `Your Headstart payslip — ${weekLabel}`,
        htmlContent: html,
      }),
    });

    // Keep Brevo's own words on a failure. Without this a blocked account
    // (new sending IP needing verification, expired key, unverified sender)
    // is indistinguishable from any other error, which is how a whole pay run
    // silently failed to send.
    let reason = "";
    if (!brevoRes.ok) {
      try {
        const err = await brevoRes.json();
        reason = err.message || err.code || `HTTP ${brevoRes.status}`;
      } catch {
        reason = `HTTP ${brevoRes.status}`;
      }
    }
    results.push({ email, success: brevoRes.ok, reason, recordIds: byMentor[email].recordIds });
  }

  // Active, but nothing owing. Either they had a genuinely quiet week or they
  // forgot to log. Only they can tell the difference, so ask them.
  const nudged = [];
  for (const [email, m] of Object.entries(active)) {
    if (byMentor[email]) continue;
    if (OWNERS.includes(email)) continue;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "The Headstart", email: "fidel@theheadstartmentoring.com" },
        to: [{ email, name: m.name }],
        subject: `Nothing to pay you this week — check your log`,
        htmlContent: nudgeHtml(m.name),
      }),
    });
    nudged.push({ email, name: m.name, success: r.ok, last: m.last });
  }

  // Written after the emails so a failed run does not leave the flags claiming
  // a state that nobody was told about.
  let flags = { updated: 0 };
  try { flags = await syncActiveFlags(process.env, active); } catch (e) { /* not worth failing a pay run */ }

  // Only mark sessions as Mentor Paid for mentors whose email actually succeeded
  const paidIds = results.filter((r) => r.success).flatMap((r) => r.recordIds);
  // Stamping the run date makes a pay run reconcilable against a bank transfer
  // afterwards, instead of only knowing that something was paid at some point.
  const paidOn = new Date().toISOString().slice(0, 10);
  const chunks  = [];
  for (let i = 0; i < paidIds.length; i += 10) chunks.push(paidIds.slice(i, i + 10));

  for (const chunk of chunks) {
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
      {
        method: "PATCH",
        headers: airtableHeaders,
        body: JSON.stringify({
          records: chunk.map((id) => ({
            id,
            fields: { "Mentor Paid": "Yes", "Paid On": paidOn },
          })),
        }),
      }
    );
  }

  // What to actually transfer, per mentor, matching what was just marked paid.
  const transfer = results.filter((r) => r.success).map((r) => ({
    name: byMentor[r.email].name,
    email: r.email,
    amount: parseFloat(byMentor[r.email].total.toFixed(2)),
    sessions: byMentor[r.email].recordIds.length,
  }));

  // Send audit summary to Fidel
  const grandTotal = Object.values(byMentor).reduce((sum, m) => sum + m.total, 0);
  const summaryRows = results
    .map(({ email, success }) => {
      const m = byMentor[email];
      const sessionLines = m.sessions
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((s) => `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;color:#555;">${m.name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">${formatDate(s.date)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;">${s.mentee}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">$${s.payout.toFixed(2)}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f0f0f0;text-align:center;">${success ? "✓ Sent" : "✗ Failed"}</td>
        </tr>`)
        .join("");
      return sessionLines;
    })
    .join("");

  const auditHtml = `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f9;">
  <div style="max-width:640px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
    <div style="background:#000;padding:28px 32px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#c79b3b;font-weight:700;">The Headstart</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">Payslip Run — ${weekLabel}</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 24px;font-size:14px;color:#555;">${results.length} mentor${results.length !== 1 ? "s" : ""} paid &nbsp;·&nbsp; ${results.filter(r => r.success).length} emails sent successfully &nbsp;·&nbsp; ${Object.keys(active).length} active in the last ${ACTIVE_DAYS} days</p>
      ${nudged.length ? `
      <p style="margin:0 0 8px;font-size:14px;color:#111;font-weight:700;">Active but nothing owing, asked to check their log</p>
      <ul style="margin:0 0 24px;padding-left:20px;font-size:13px;color:#555;">
        ${nudged.map((n) => `<li>${n.name} &nbsp;·&nbsp; last session ${formatDate(n.last)}${n.success ? "" : " &nbsp;·&nbsp; <strong>email failed</strong>"}</li>`).join("")}
      </ul>` : ""}
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Mentor</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Date</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Mentee</th>
            <th style="padding:10px 12px;text-align:right;font-weight:600;color:#111;">Payout</th>
            <th style="padding:10px 12px;text-align:center;font-weight:600;color:#111;">Email</th>
          </tr>
        </thead>
        <tbody>${summaryRows}</tbody>
        <tfoot>
          <tr>
            <td colspan="3" style="padding:14px 12px;font-weight:700;font-size:15px;color:#111;">Total paid out</td>
            <td style="padding:14px 12px;font-weight:700;font-size:15px;color:#111;text-align:right;">$${grandTotal.toFixed(2)} AUD</td>
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
    <div style="background:#f5f5f5;padding:16px 32px;">
      <p style="margin:0;font-size:12px;color:#aaa;">The Headstart Mentoring &nbsp;·&nbsp; Internal payslip audit</p>
    </div>
  </div>
</body>
</html>`;

  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender:      { name: "The Headstart", email: "fidel@theheadstartmentoring.com" },
      to:          [{ email: "fidelhon@gmail.com", name: "Fidel" }],
      subject:     `Payslip audit — ${weekLabel}`,
      htmlContent: auditHtml,
    }),
  });

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      sent: results,
      nudged,
      activeCount: Object.keys(active).length,
      activeDays: ACTIVE_DAYS,
      flagsUpdated: flags.updated,
      paidOn,
      transfer,
      transferTotal: parseFloat(transfer.reduce((a, t) => a + t.amount, 0).toFixed(2)),
    }),
  };
};
