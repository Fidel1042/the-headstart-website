const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};


exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

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
  const formula = encodeURIComponent(`AND({Mentor Paid}=0, IS_AFTER({Date}, DATEADD(TODAY(), -7, 'days')))`);

  const res  = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
    `?filterByFormula=${formula}` +
    `&fields[]=Mentor%20Email&fields[]=Mentor%20Name&fields[]=Mentee%20Name&fields[]=Date&fields[]=Mentor%20Payout`,
    { headers: airtableHeaders }
  );
  const data     = await res.json();
  const sessions = data.records || [];

  if (sessions.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "No unpaid sessions outstanding." }) };
  }

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
      date:   s.fields["Date"] || "",
      mentee: s.fields["Mentee Name"] || "—",
      payout,
    });
    byMentor[email].total += payout;
  }

  const mentorEmails = Object.keys(byMentor);
  if (mentorEmails.length === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ message: "No mentor payouts to send." }) };
  }

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

    results.push({ email, success: brevoRes.ok, recordIds: byMentor[email].recordIds });
  }

  // Only mark sessions as Mentor Paid for mentors whose email actually succeeded
  const paidIds = results.filter((r) => r.success).flatMap((r) => r.recordIds);
  const chunks  = [];
  for (let i = 0; i < paidIds.length; i += 10) chunks.push(paidIds.slice(i, i + 10));

  for (const chunk of chunks) {
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
      {
        method: "PATCH",
        headers: airtableHeaders,
        body: JSON.stringify({
          records: chunk.map((id) => ({ id, fields: { "Mentor Paid": "Yes" } })),
        }),
      }
    );
  }

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
      <p style="margin:0 0 24px;font-size:14px;color:#555;">${results.length} mentor${results.length !== 1 ? "s" : ""} paid &nbsp;·&nbsp; ${results.filter(r => r.success).length} emails sent successfully</p>
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
    body: JSON.stringify({ sent: results }),
  };
};
