// mentor-pipeline.js — every mentor who is not yet mentoring, and the two
// things that move them: their status and their rate.
//
// Both used to be Airtable edits. Doing them here means the pipeline, the
// interview date and the agreement link are one screen instead of three.
//
// Owner only, in both directions: this lists everybody's rate and lets it be
// changed.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// The order somebody actually moves through. Hired is the far end and lives on
// the Agreements page. Hold parks somebody without ending it; Dropped ends it.
//
// Second Interview was retired in August 2026. It is not offered as a choice
// any more, but it is still recognised below so the people already sitting on
// it stay visible instead of vanishing out of the portal.
const STAGES = ["Screen", "First Interview",
                "Waiting on signed contract", "Hold", "Hired", "Dropped"];

const RETIRED = ["Second Interview"];

// Everyone still being worked on. Hired, Hold and Dropped have their own homes.
const IN_PIPELINE = ["Screen", "First Interview", "Second Interview",
                     "Waiting on signed contract"];

// Where the write-up goes, by the stage the person is at. First Interview and
// Screen share one, because a screen that turns into notes is still interview
// one. Fidel pastes the Fathom transcript or share link into it.
const NOTES_FIELD = {
  "Screen": "Int 1 transcript",
  "First Interview": "Int 1 transcript",
  "Second Interview": "Interview 2 Transcript",
  "Waiting on signed contract": "Interview 2 Transcript",
  "Hold": "Int 1 transcript",
};

const FIELDS = ["Name", "Email", "Phone", "Status", "Rate", "First Interview Date",
                "Industry", "Company", "Role", "LinkedIn", "Koko Notified",
                "Agreement Signed", "Legacy Agreement", "Invite Sent",
                "Int 1 transcript", "Interview 2 Transcript"];

const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };

/**
 * The interview invitation.
 *
 * This lives here rather than in an Airtable automation so the wording can be
 * changed without leaving the codebase, and so a failure is visible instead of
 * silent. Edit the two functions below and every future invite follows.
 */
const ZOOM = {
  link: "https://us05web.zoom.us/j/2123046742?pwd=yjlZs0E8tBH3CEkLVuH4txJUoYnabe.1&omn=84465105461",
  passcode: "cRsn5u",
};

// Fidel's wording. Sent as HTML so the bold renders instead of showing as
// asterisks, with a plain-text copy for clients that refuse HTML.
const inviteSubject = () => "Interview invitation — Headstart Mentoring";

const inviteHtml = (firstName, when) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:600px;">
  <p style="margin:0 0 16px;">Hi ${firstName},</p>
  <p style="margin:0 0 16px;">Thank you for your application, we&rsquo;re excited to let you know that you&rsquo;ve progressed to the next stage of our selection process.</p>
  <p style="margin:0 0 16px;">We&rsquo;d love to invite you to an online interview to learn more about your experience and explore how you might fit into our team of Mentors within Headstart Mentoring.</p>
  <p style="margin:0 0 8px;"><strong>Interview Details</strong></p>
  <p style="margin:0 0 4px;"><strong>Date and Time</strong>: ${when} (Sydney Time)</p>
  <p style="margin:0 0 4px;"><strong>Platform</strong>: Zoom</p>
  <p style="margin:0 0 4px;"><strong>Meeting Link</strong>: <a href="${ZOOM.link}" style="color:#8a6210;">${ZOOM.link}</a></p>
  <p style="margin:0 0 16px;"><strong>Passcode</strong>: ${ZOOM.passcode}</p>
  <p style="margin:0 0 16px;">Please reply to confirm your availability for this time. If it doesn&rsquo;t suit, feel free to suggest a few alternatives and we&rsquo;ll do our best to accommodate.</p>
  <p style="margin:0 0 16px;">Looking forward to speaking with you.</p>
  <p style="margin:0;">Best Regards,<br /><strong>Fidel Hon</strong><br /><em>Operations Manager</em><br />Headstart Mentoring</p>
</div>`;

const inviteText = (firstName, when) =>
  `Hi ${firstName},\n\n` +
  `Thank you for your application, we're excited to let you know that you've progressed to the next stage of our selection process.\n\n` +
  `We'd love to invite you to an online interview to learn more about your experience and explore how you might fit into our team of Mentors within Headstart Mentoring.\n\n` +
  `Interview Details\n` +
  `Date and Time: ${when} (Sydney Time)\n` +
  `Platform: Zoom\n` +
  `Meeting Link: ${ZOOM.link}\n` +
  `Passcode: ${ZOOM.passcode}\n\n` +
  `Please reply to confirm your availability for this time. If it doesn't suit, feel free to suggest a few alternatives and we'll do our best to accommodate.\n\n` +
  `Looking forward to speaking with you.\n\n` +
  `Best Regards,\nFidel Hon\nOperations Manager\nHeadstart Mentoring`;

/** The interview time as a person would read it, in Sydney. */
function readableTime(iso) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long",
    year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

// Exported so the email can be previewed without sending a real one.
exports.preview = { inviteSubject, inviteHtml, inviteText, readableTime };

async function sendInvite(apiKey, mentor, when) {
  const first = String(mentor.name || "").trim().split(/\s+/)[0] || "there";
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: mentor.email, name: mentor.name }],
      replyTo: SENDER,
      subject: inviteSubject(),
      htmlContent: inviteHtml(first, when),
      textContent: inviteText(first, when),
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

async function fetchAll(base, table, token) {
  const out = [];
  let offset = null;
  do {
    const q = `?${FIELDS.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      `&pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const data = await at(`${base}/${table}${q}`, {}, token);
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

const shape = (r) => {
  const f = r.fields;
  const rate = parseFloat(f["Rate"]) || 0;
  return {
    id: r.id,
    name: f["Name"] || "Unnamed",
    email: (f["Email"] || "").toLowerCase().trim(),
    phone: f["Phone"] || "",
    status: f["Status"] || "",
    rate, rateSet: rate > 0,
    interviewAt: f["First Interview Date"] || "",
    industry: f["Industry"] || "",
    company: f["Company"] || "",
    role: f["Role"] || "",
    linkedin: f["LinkedIn"] || "",
    signed: (f["Agreement Signed"] || "").slice(0, 10),
    legacy: Boolean(f["Legacy Agreement"]),
    inviteSent: f["Invite Sent"] || "",
    // The write-up for whichever interview they are up to, so the page shows
    // and saves one box rather than four.
    notes: f[NOTES_FIELD[f["Status"]] || "Int 1 transcript"] || "",
    notesField: NOTES_FIELD[f["Status"]] || "Int 1 transcript",
  };
};

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
          AIRTABLE_MENTOR_TABLE_ID: table } = process.env;

  try {
    if (p.action === "update") {
      const fields = {};

      if (p.status !== undefined) {
        // Retired stages are accepted so saving an untouched old row does not
        // fail, but they are never offered as a new choice.
        if (![...STAGES, ...RETIRED].includes(p.status)) {
          return json(400, { error: "Unknown stage" });
        }
        fields["Status"] = p.status;
      }
      if (p.rate !== undefined) {
        const rate = parseFloat(p.rate);
        if (!Number.isFinite(rate) || rate < 0 || rate > 500) {
          return json(400, { error: "A rate should be between 0 and 500" });
        }
        fields["Rate"] = rate;
      }
      if (p.interviewAt !== undefined) {
        // Empty clears it. Anything else has to be a real instant, or Airtable
        // stores something nobody can read back.
        if (!p.interviewAt) fields["First Interview Date"] = null;
        else {
          const d = new Date(p.interviewAt);
          if (Number.isNaN(d.getTime())) return json(400, { error: "That date did not parse" });
          fields["First Interview Date"] = d.toISOString();
        }
      }
      if (p.notes !== undefined) {
        // Written against the stage the row was showing when Fidel typed, which
        // is what the box was labelled with. Not the stage being saved: writing
        // up interview one and promoting to Second Interview in the same Save
        // would otherwise file those notes under interview two.
        const target = NOTES_FIELD[p.notesStage] || "Int 1 transcript";
        fields[target] = String(p.notes);
      }
      if (!Object.keys(fields).length) return json(400, { error: "Nothing to change" });

      const saved = await at(`${base}/${table}/${p.mentorId}`,
        { method: "PATCH", body: JSON.stringify({ fields, typecast: true }) }, token);
      return json(200, { mentor: shape(saved) });
    }

    if (p.action === "invite") {
      const rec = await at(`${base}/${table}/${p.mentorId}`, {}, token).catch(() => null);
      if (!rec || !rec.fields) return json(404, { error: "No such mentor" });
      const m = shape(rec);
      if (!m.email) return json(400, { error: `${m.name} has no email on their record` });
      if (!m.interviewAt) return json(400, { error: "Set an interview time first, then save." });
      if (!process.env.BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY missing" });

      const when = readableTime(m.interviewAt);
      const sent = await sendInvite(process.env.BREVO_API_KEY, m, when);
      if (!sent.ok) return json(502, { error: `Brevo refused it: ${sent.reason}` });

      // Stamped only after Brevo accepted it, so a failure never looks sent.
      const saved = await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Invite Sent": new Date().toISOString() } }),
      }, token);
      return json(200, { mentor: shape(saved), when });
    }

    const all = await fetchAll(base, table, token);
    const pipeline = all.filter((r) => IN_PIPELINE.includes(r.fields["Status"] || ""))
      .map(shape)
      .sort((a, b) => IN_PIPELINE.indexOf(b.status) - IN_PIPELINE.indexOf(a.status)
        || a.name.localeCompare(b.name));

    return json(200, {
      pipeline,
      stages: STAGES,
      // Sent to the page so the "Add to calendar" link puts the same Zoom
      // details in the calendar event as the invitation email does. One
      // source, so the two can never drift apart.
      zoom: ZOOM,
      retired: RETIRED,
      // Parked, not finished. Kept out of the working list but still reachable,
      // because the whole point of Hold is coming back to them.
      onHold: all.filter((r) => (r.fields["Status"] || "") === "Hold")
        .map(shape).sort((a, b) => a.name.localeCompare(b.name)),
      // How many are already through, so the page can say where the far end is
      // without listing everybody. Dropped is deliberately not counted or
      // returned: their record stays in Airtable and leaves the portal.
      hired: all.filter((r) => (r.fields["Status"] || "") === "Hired").length,
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not load the pipeline" });
  }
};
