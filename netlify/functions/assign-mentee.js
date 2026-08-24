// assign-mentee.js — put a mentee with a mentor, then tell the mentor about
// them.
//
// Both used to be Airtable: a dropdown on the Client record, and an automation
// that fired off the back of it. Here the two are separate on purpose, so
// fixing a wrong assignment does not email anybody a second time.
//
// Owner only. It reads every mentee and writes who mentors them.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// Only people who have actually signed get a mentor. Everyone else is still a
// lead and belongs on Contacts or Follow-ups.
const ASSIGNABLE = "Acquired";

const CLIENT_FIELDS = ["Name", "Gmail", "Client Pipeline", "Mentor", "LinkedIn Link",
                       "Suggested Plan", "Target Industry", "University", "Major",
                       "Mentee Info Sent", "Handover Legacy", "Created"];
const MENTOR_FIELDS = ["Name", "Email", "Status", "Industry", "Role", "Company"];

const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Fidel's wording. The Suggested Plan from the mentee's record is the body of
 * the email, so it carries the mentee's name and what they need. Edit here and
 * every future handover follows.
 */
const subject = (menteeName) => `Your new mentee: ${menteeName}`;

// Plain text from a multiline field becomes paragraphs, so it does not arrive
// as one run-on block.
const asParagraphs = (text) => String(text || "").trim().split(/\n\s*\n/)
  .map((p) => `<p style="margin:0 0 16px;">${esc(p).replace(/\n/g, "<br />")}</p>`).join("");

const bodyHtml = (first, plan, linkedin) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:600px;">
  <p style="margin:0 0 16px;">Hi ${esc(first)},</p>
  ${asParagraphs(plan)}
  ${linkedin
    ? `<p style="margin:0 0 16px;">The mentee&rsquo;s LinkedIn: <a href="${esc(linkedin)}" style="color:#8a6210;">${esc(linkedin)}</a></p>`
    : ""}
  <p style="margin:0 0 16px;">Have fun career mentoring!</p>
  <p style="margin:0;">Best Regards,<br />Fidel</p>
</div>`;

const bodyText = (first, plan, linkedin) =>
  `Hi ${first},\n\n${String(plan || "").trim()}\n\n` +
  (linkedin ? `The mentee's LinkedIn: ${linkedin}\n\n` : "") +
  `Have fun career mentoring!\n\nBest Regards,\nFidel`;

// Exported so the email can be previewed without sending one.
exports.preview = { subject, bodyHtml, bodyText };

async function sendHandover(apiKey, mentor, mentee) {
  const first = String(mentor.name || "").trim().split(/\s+/)[0] || "there";
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: mentor.email, name: mentor.name }],
      replyTo: SENDER,
      subject: subject(mentee.name),
      htmlContent: bodyHtml(first, mentee.plan, mentee.linkedin),
      textContent: bodyText(first, mentee.plan, mentee.linkedin),
    }),
  });
  if (res.ok) return { ok: true };
  let reason = `HTTP ${res.status}`;
  try { const e = await res.json(); reason = e.message || e.code || reason; } catch { /* keep status */ }
  return { ok: false, reason };
}

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts || {}).headers },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function fetchAll(base, table, fields, token) {
  const out = [];
  let offset = null;
  do {
    const q = `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      `&pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const data = await at(`${base}/${table}${q}`, {}, token);
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

const shapeMentee = (r) => {
  const f = r.fields;
  const link = Array.isArray(f["Mentor"]) ? f["Mentor"] : [];
  return {
    id: r.id,
    name: f["Name"] || "Unnamed",
    email: (f["Gmail"] || "").toLowerCase().trim(),
    pipeline: f["Client Pipeline"] || "",
    mentorId: link[0] || "",
    linkedin: f["LinkedIn Link"] || "",
    plan: f["Suggested Plan"] || "",
    industry: f["Target Industry"] || "",
    university: f["University"] || "",
    major: f["Major"] || "",
    sent: f["Mentee Info Sent"] || "",
    // Assigned before this page existed, so the old Airtable automation
    // already emailed their mentor. Kept out of the way rather than showing
    // as 34 people nobody has told their mentor about.
    legacy: Boolean(f["Handover Legacy"]),
    created: f["Created"] || "",
  };
};

const shapeMentor = (r) => ({
  id: r.id,
  name: r.fields["Name"] || "Unnamed",
  email: (r.fields["Email"] || "").toLowerCase().trim(),
  industry: r.fields["Industry"] || "",
  role: [r.fields["Role"], r.fields["Company"]].filter(Boolean).join(" at "),
});

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  if (!OWNERS.includes((p.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTOR_TABLE_ID: mentorTable, AIRTABLE_MENTEE_TABLE_ID: clientTable } = process.env;

  try {
    if (p.action === "assign") {
      // An empty mentorId clears the link, which is how a wrong assignment gets
      // undone without touching Airtable.
      const value = p.mentorId ? [p.mentorId] : [];
      const fields = { "Mentor": value };

      const before = await at(`${base}/${clientTable}/${p.menteeId}`, {}, token).catch(() => null);
      // A different mentor is a new handover: whoever it is now has not been
      // told. Clearing both marks puts the row back in the list to email.
      // Re-saving the same mentor changes nothing, so a stray click is safe.
      if (before && shapeMentee(before).mentorId !== (p.mentorId || "")) {
        fields["Handover Legacy"] = false;
        fields["Mentee Info Sent"] = null;
      }

      const saved = await at(`${base}/${clientTable}/${p.menteeId}`,
        { method: "PATCH", body: JSON.stringify({ fields }) }, token);
      return json(200, { mentee: shapeMentee(saved) });
    }

    if (p.action === "send") {
      const rec = await at(`${base}/${clientTable}/${p.menteeId}`, {}, token).catch(() => null);
      if (!rec || !rec.fields) return json(404, { error: "No such mentee" });
      const mentee = shapeMentee(rec);
      if (!mentee.mentorId) return json(400, { error: "Assign a mentor first, then save." });
      // The plan is the whole body. Sending without it mails a greeting and a
      // sign-off and nothing in between.
      if (!mentee.plan.trim()) {
        return json(400, { error: `${mentee.name} has no Suggested Plan yet. Write it in Airtable first.` });
      }

      const mRec = await at(`${base}/${mentorTable}/${mentee.mentorId}`, {}, token).catch(() => null);
      if (!mRec || !mRec.fields) return json(404, { error: "That mentor record is gone" });
      const mentor = shapeMentor(mRec);
      if (!mentor.email) return json(400, { error: `${mentor.name} has no email on their record` });
      if (!process.env.BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY missing" });

      const sent = await sendHandover(process.env.BREVO_API_KEY, mentor, mentee);
      if (!sent.ok) return json(502, { error: `Brevo refused it: ${sent.reason}` });

      // Stamped only after Brevo accepted it, so a failure never looks sent.
      const saved = await at(`${base}/${clientTable}/${p.menteeId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Mentee Info Sent": new Date().toISOString() } }),
      }, token);
      return json(200, { mentee: shapeMentee(saved), to: mentor.name });
    }

    const [clients, mentorRecs] = await Promise.all([
      fetchAll(base, clientTable, CLIENT_FIELDS, token),
      fetchAll(base, mentorTable, MENTOR_FIELDS, token),
    ]);

    const mentors = mentorRecs.filter((r) => (r.fields["Status"] || "") === "Hired")
      .map(shapeMentor).sort((a, b) => a.name.localeCompare(b.name));
    const known = new Set(mentors.map((m) => m.id));

    const mentees = clients.map(shapeMentee)
      .filter((m) => m.pipeline === ASSIGNABLE)
      // Newest first: a fresh signup is the one waiting on a mentor.
      .sort((a, b) => String(b.created).localeCompare(String(a.created)));

    return json(200, {
      mentors,
      // A mentor who has since been dropped still shows as assigned, but the
      // dropdown would not contain them, so flag it rather than silently
      // resetting the row to unassigned.
      waiting: mentees.filter((m) => !m.mentorId),
      assigned: mentees.filter((m) => m.mentorId && !m.legacy)
        .map((m) => ({ ...m, staleMentor: !known.has(m.mentorId) })),
      settled: mentees.filter((m) => m.mentorId && m.legacy)
        .map((m) => ({ ...m, staleMentor: !known.has(m.mentorId) })),
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not load mentees" });
  }
};
