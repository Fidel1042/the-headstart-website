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
// Second Interview is optional, not a step everyone takes. After interview one
// Fidel flips them to Hired, Dropped, or Second Interview when he is undecided,
// and that round is run by Koko.
const STAGES = ["Screen", "First Interview", "Second Interview",
                "Waiting on signed contract", "Hold", "Hired", "Dropped"];

const RETIRED = [];

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
                "Industry", "Field", "Company", "Role", "LinkedIn", "Koko Notified",
                "Agreement Signed", "Legacy Agreement", "Invite Sent",
                "Int 1 transcript", "Int 1 summary", "Interview 2 Transcript",
                "Second Interview Date", "Second Invite Sent",
                "Interview Response", "Interview Responded At"];

const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };

/**
 * The interview invitation.
 *
 * This lives here rather than in an Airtable automation so the wording can be
 * changed without leaving the codebase, and so a failure is visible instead of
 * silent. Edit the two functions below and every future invite follows.
 */
// One room per round. Round two is run by Koko, so it is her room, not Fidel's.
const ZOOM = {
  link: "https://us05web.zoom.us/j/2123046742?pwd=yjlZs0E8tBH3CEkLVuH4txJUoYnabe.1&omn=84465105461",
  passcode: "cRsn5u",
};
const ZOOM_FINAL = {
  link: "https://us05web.zoom.us/j/5621268756?pwd=j2kvxFvi6QOXQhD4b9GdNZNBUjFzYg.1",
  meetingId: "562 126 8756",
  passcode: "1234",
};

// Fidel's wording. Sent as HTML so the bold renders instead of showing as
// asterisks, with a plain-text copy for clients that refuse HTML.
const inviteSubject = () => "Interview invitation — Headstart Mentoring";

const CONFIRM_URL = "https://theheadstartmentoring.com/interview-confirm";

const inviteHtml = (firstName, when, mentorId) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:600px;">
  <p style="margin:0 0 16px;">Hi ${firstName},</p>
  <p style="margin:0 0 16px;">Thank you for your application, we&rsquo;re excited to let you know that you&rsquo;ve progressed to the next stage of our selection process.</p>
  <p style="margin:0 0 16px;">We&rsquo;d love to invite you to an online interview to learn more about your experience and explore how you might fit into our team of Mentors within Headstart Mentoring.</p>
  <p style="margin:0 0 8px;"><strong>Interview Details</strong></p>
  <p style="margin:0 0 4px;"><strong>Date and Time</strong>: ${when} (Sydney Time)</p>
  <p style="margin:0 0 4px;"><strong>Platform</strong>: Zoom</p>
  <p style="margin:0 0 4px;"><strong>Meeting Link</strong>: <a href="${ZOOM.link}" style="color:#8a6210;">${ZOOM.link}</a></p>
  <p style="margin:0 0 16px;"><strong>Passcode</strong>: ${ZOOM.passcode}</p>
  <p style="margin:0 0 20px;">Please confirm you can make it:</p>
  <p style="margin:0 0 20px;"><a href="${CONFIRM_URL}?m=${mentorId}" style="display:inline-block;background:#c79b3b;color:#17170f;font-weight:700;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:999px;">Confirm my interview</a></p>
  <p style="margin:0 0 16px;">If the time doesn&rsquo;t suit, hit the same link and let us know, then reply here with a few alternatives and we&rsquo;ll do our best to accommodate.</p>
  <p style="margin:0 0 16px;">Looking forward to speaking with you.</p>
  <p style="margin:0;">Best Regards,<br /><strong>Fidel Hon</strong><br /><em>Operations Manager</em><br />Headstart Mentoring</p>
</div>`;

const inviteText = (firstName, when, mentorId) =>
  `Hi ${firstName},\n\n` +
  `Thank you for your application, we're excited to let you know that you've progressed to the next stage of our selection process.\n\n` +
  `We'd love to invite you to an online interview to learn more about your experience and explore how you might fit into our team of Mentors within Headstart Mentoring.\n\n` +
  `Interview Details\n` +
  `Date and Time: ${when} (Sydney Time)\n` +
  `Platform: Zoom\n` +
  `Meeting Link: ${ZOOM.link}\n` +
  `Passcode: ${ZOOM.passcode}\n\n` +
  `Please confirm you can make it: ${CONFIRM_URL}?m=${mentorId}\n\n` +
  `If the time doesn't suit, use the same link to let us know, then reply here with a few alternatives and we'll do our best to accommodate.\n\n` +
  `Looking forward to speaking with you.\n\n` +
  `Best Regards,\nFidel Hon\nOperations Manager\nHeadstart Mentoring`;


// Round two. Same register as the first invitation on purpose, so the two read
// as one process rather than two different companies writing.
const finalSubject = () => "Final interview — Headstart Mentoring";

const finalHtml = (firstName, when, mentorId) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:600px;">
  <p style="margin:0 0 16px;">Hi ${firstName},</p>
  <p style="margin:0 0 16px;">Thank you for taking the time to speak with me. We&rsquo;d like to progress you to a final interview with my co-founder, Koko.</p>
  <p style="margin:0 0 16px;">This is the last stage of our process. It is a chance for Koko to learn more about how you would work with a mentee, and for you to ask anything you still want to know about mentoring with us.</p>
  <p style="margin:0 0 8px;"><strong>Final Interview Details</strong></p>
  <p style="margin:0 0 4px;"><strong>Date and Time</strong>: ${when} (Sydney Time)</p>
  <p style="margin:0 0 4px;"><strong>Platform</strong>: Zoom</p>
  <p style="margin:0 0 4px;"><strong>Meeting Link</strong>: <a href="${ZOOM_FINAL.link}" style="color:#8a6210;">${ZOOM_FINAL.link}</a></p>
  <p style="margin:0 0 4px;"><strong>Meeting ID</strong>: ${ZOOM_FINAL.meetingId}</p>
  <p style="margin:0 0 20px;"><strong>Passcode</strong>: ${ZOOM_FINAL.passcode}</p>
  <p style="margin:0 0 20px;">Please confirm you can make it:</p>
  <p style="margin:0 0 20px;"><a href="${CONFIRM_URL}?m=${mentorId}" style="display:inline-block;background:#c79b3b;color:#17170f;font-weight:700;font-size:15px;text-decoration:none;padding:13px 26px;border-radius:999px;">Confirm my interview</a></p>
  <p style="margin:0 0 16px;">If the time doesn&rsquo;t suit, hit the same link and let us know, then reply here with a few alternatives and we&rsquo;ll do our best to accommodate.</p>
  <p style="margin:0 0 16px;">Looking forward to hearing how it goes.</p>
  <p style="margin:0;">Best Regards,<br /><strong>Fidel Hon</strong><br /><em>Operations Manager</em><br />Headstart Mentoring</p>
</div>`;

const finalText = (firstName, when, mentorId) =>
  `Hi ${firstName},\n\n` +
  `Thank you for taking the time to speak with me. We'd like to progress you to a final interview with my co-founder, Koko.\n\n` +
  `This is the last stage of our process. It is a chance for Koko to learn more about how you would work with a mentee, and for you to ask anything you still want to know about mentoring with us.\n\n` +
  `Final Interview Details\n` +
  `Date and Time: ${when} (Sydney Time)\n` +
  `Platform: Zoom\n` +
  `Meeting Link: ${ZOOM_FINAL.link}\n` +
  `Meeting ID: ${ZOOM_FINAL.meetingId}\n` +
  `Passcode: ${ZOOM_FINAL.passcode}\n\n` +
  `Please confirm you can make it: ${CONFIRM_URL}?m=${mentorId}\n\n` +
  `If the time doesn't suit, use the same link to let us know, then reply here with a few alternatives and we'll do our best to accommodate.\n\n` +
  `Looking forward to hearing how it goes.\n\n` +
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
exports.preview = { inviteSubject, inviteHtml, inviteText,
                    finalSubject, finalHtml, finalText, readableTime };

// Which round to send is decided by the stage, never by a second button.
// A mentor sitting at Second Interview cannot be sent the first invitation by
// accident, which is what would have happened before.
async function sendInvite(apiKey, mentor, when, round) {
  const first = String(mentor.name || "").trim().split(/\s+/)[0] || "there";
  const isFinal = round === "final";
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: mentor.email, name: mentor.name }],
      replyTo: SENDER,
      subject: isFinal ? finalSubject() : inviteSubject(),
      htmlContent: isFinal ? finalHtml(first, when, mentor.id) : inviteHtml(first, when, mentor.id),
      textContent: isFinal ? finalText(first, when, mentor.id) : inviteText(first, when, mentor.id),
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
    // Booked on the interview one call, so it is logged in the same sitting
    // rather than chased afterwards.
    secondAt: f["Second Interview Date"] || "",
    summary: f["Int 1 summary"] || "",
    // Field is what actually gets filled during screening. Industry is added
    // later, on hired mentors, so it is the fallback rather than the source.
    industry: f["Field"] || f["Industry"] || "",
    company: f["Company"] || "",
    role: f["Role"] || "",
    linkedin: f["LinkedIn"] || "",
    signed: (f["Agreement Signed"] || "").slice(0, 10),
    legacy: Boolean(f["Legacy Agreement"]),
    inviteSent: f["Invite Sent"] || "",
    secondInviteSent: f["Second Invite Sent"] || "",
    response: f["Interview Response"] || "",
    respondedAt: f["Interview Responded At"] || "",
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
      if (p.secondAt !== undefined) {
        if (!p.secondAt) fields["Second Interview Date"] = null;
        else {
          const d = new Date(p.secondAt);
          if (Number.isNaN(d.getTime())) return json(400, { error: "That second interview date did not parse" });
          fields["Second Interview Date"] = d.toISOString();
        }
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
      if (!process.env.BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY missing" });

      const final = m.status === "Second Interview";
      const at_ = final ? m.secondAt : m.interviewAt;
      if (!at_) {
        return json(400, { error: final
          ? "Set a second interview time first, then save."
          : "Set an interview time first, then save." });
      }

      const when = readableTime(at_);
      const sent = await sendInvite(process.env.BREVO_API_KEY, m, when, final ? "final" : "first");
      if (!sent.ok) return json(502, { error: `Brevo refused it: ${sent.reason}` });

      // Stamped only after Brevo accepted it, so a failure never looks sent.
      // Separate fields per round, so "invited" always means the round they are
      // actually on rather than something from weeks ago.
      const stamp = final ? "Second Invite Sent" : "Invite Sent";
      const saved = await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: {
          [stamp]: new Date().toISOString(),
          // A fresh invitation asks a fresh question. Clearing the answer means
          // the response fields always describe the round they are on now, and
          // a yes to the first interview never masks silence about the second.
          "Interview Response": "",
          "Interview Responded At": null,
          "Interview Chased": null,
        } }),
      }, token);
      return json(200, { mentor: shape(saved), when, round: final ? "final" : "first" });
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
      // Round two happens in Koko's room, so her page must not be handed
      // Fidel's link.
      zoomFinal: ZOOM_FINAL,
      retired: RETIRED,
      // Everyone waiting on a round with Koko, with the interview one summary
      // attached so she can prep without opening Airtable.
      secondRound: all.filter((r) => (r.fields["Status"] || "") === "Second Interview")
        .map(shape)
        .sort((a, b) => String(a.secondAt || "9999").localeCompare(String(b.secondAt || "9999"))),
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
