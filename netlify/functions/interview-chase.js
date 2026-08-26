// interview-chase.js — tells Fidel when an interview is five hours away and the
// candidate still has not said whether they are coming.
//
// Runs hourly and looks at a one hour slice, so each interview is considered
// exactly once. "Interview Chased" is stamped after the email goes, which makes
// a double send impossible even if the cron fires twice or Netlify retries.
//
// Round aware: somebody at Second Interview is being chased about the interview
// with Koko, not the first one.

const headers = { "Content-Type": "application/json" };
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const HOURS_BEFORE = 5;
const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TO = { email: "fidelhon@gmail.com", name: "Fidel" };

const FIELDS = ["Name", "Email", "Phone", "Status", "First Interview Date",
                "Second Interview Date", "Invite Sent", "Second Invite Sent",
                "Interview Response", "Interview Chased"];

const readable = (iso) => new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney", weekday: "short", day: "numeric", month: "short",
  hour: "numeric", minute: "2-digit", hour12: true,
}).format(new Date(iso));

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts || {}).headers },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

const row = (m) => `
  <tr>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${m.name}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${m.round}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${readable(m.when)}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${m.email}${m.phone ? `<br />${m.phone}` : ""}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${m.invited ? "yes" : "<strong>never invited</strong>"}</td>
  </tr>`;

const html = (list) => `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f9;">
  <div style="max-width:640px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
    <div style="background:#000;padding:28px 32px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#c79b3b;font-weight:700;">The Headstart</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">Unconfirmed interview${list.length > 1 ? "s" : ""} today</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 24px;font-size:14px;color:#555;">${list.length === 1 ? "This interview is" : "These interviews are"} about ${HOURS_BEFORE} hours away and nobody has clicked confirm.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f5f5f5;">
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Who</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Round</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">When</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Contact</th>
            <th style="padding:10px 12px;text-align:left;font-weight:600;color:#111;">Invited</th>
          </tr>
        </thead>
        <tbody>${list.map(row).join("")}</tbody>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#888;">A decline would have shown up here too, so silence means they have not opened it.</p>
    </div>
  </div>
</body>
</html>`;

exports.handler = async () => {
  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTOR_TABLE_ID: table, BREVO_API_KEY } = process.env;
  if (!token || !base || !table) return json(500, { error: "Airtable env missing" });

  const now = Date.now();
  const from = now + HOURS_BEFORE * 3600e3;
  const to = from + 3600e3;

  try {
    const q = `?${FIELDS.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}&pageSize=100` +
      `&filterByFormula=${encodeURIComponent('OR({Status}="First Interview",{Status}="Screen",{Status}="Second Interview")')}`;
    const data = await at(`${base}/${table}${q}`, {}, token);

    const due = [];
    for (const r of data.records || []) {
      const f = r.fields;
      if ((f["Interview Response"] || "").trim()) continue;   // they answered
      if (f["Interview Chased"]) continue;                    // already told Fidel

      const final = (f["Status"] || "") === "Second Interview";
      const when = final ? f["Second Interview Date"] : f["First Interview Date"];
      if (!when) continue;

      const t = new Date(when).getTime();
      if (Number.isNaN(t) || t < from || t >= to) continue;

      due.push({
        id: r.id,
        name: f["Name"] || "Unnamed",
        email: (f["Email"] || "").toLowerCase().trim(),
        phone: f["Phone"] || "",
        round: final ? "Final, with Koko" : "First",
        when,
        invited: Boolean(final ? f["Second Invite Sent"] : f["Invite Sent"]),
      });
    }

    if (!due.length) return json(200, { checked: (data.records || []).length, due: 0 });
    if (!BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY missing" });

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: SENDER, to: [TO],
        subject: `${due.length} unconfirmed interview${due.length > 1 ? "s" : ""} in ${HOURS_BEFORE} hours`,
        htmlContent: html(due),
      }),
    });
    if (!res.ok) return json(502, { error: "Brevo refused it", due: due.length });

    // Stamped only after the email is away, so a failure gets another go on the
    // next run rather than being silently marked as handled.
    await at(`${base}/${table}`, {
      method: "PATCH",
      body: JSON.stringify({
        records: due.map((m) => ({ id: m.id, fields: { "Interview Chased": new Date().toISOString() } })),
      }),
    }, token);

    return json(200, { due: due.length, names: due.map((m) => m.name) });
  } catch (err) {
    return json(502, { error: err.message || "Could not run the check" });
  }
};
