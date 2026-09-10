const { requireOwner } = require("../shared/require-owner");
// intern-pipeline.js — the internship applicant list and its interview invite.
//
// Applications arrive on the Netlify form "marketing-intern-application",
// go through the Make scenario "Marketing Intern" (id 6760278), and land in
// Airtable base appj7BK6XELWQyNXe, table "Intern Applications". That path
// already worked and is left alone; this only reads what it wrote and adds the
// step that was missing, which is inviting somebody to an interview.
//
// A separate base from the core CRM, because that is where the webhook already
// writes. Rewiring a working intake to move a table is a lot of risk for
// tidiness, so the base id lives here instead.
//
// Sends through Brevo directly rather than through Make. Make is on a hard cap
// of 10,000 operations a month with roughly 2,200 spare, and an invite that
// goes out a handful of times a month should not be paying rent there.
// See Operations/make-ops-budget.md.

const BASE = "appj7BK6XELWQyNXe";
const TABLE = "tblysLwYfG5wAjn1l";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };
const REPLY_TO = { name: "Fidel", email: "fidel@theheadstartmentoring.com" };

// Fidel's room, the same one the first mentor interview uses. One room means
// one link to remember and one place to be at 5pm.
const ZOOM = {
  link: "https://us05web.zoom.us/j/2123046742?pwd=yjlZs0E8tBH3CEkLVuH4txJUoYnabe.1&omn=84465105461",
  passcode: "cRsn5u",
};

/**
 * The invite, in the same register as the mentor one so the two read as one
 * company. Different in the one way that matters: an intern is interviewing
 * for a role inside the team, not to take mentees, so it talks about the team.
 *
 * There is no confirm button. The mentor version has a page behind it because
 * mentors are booked weeks out and go quiet; interns are a handful a month and
 * a reply is enough. Add one only when chasing them becomes a real job.
 */
const inviteSubject = (role) => `Interview invitation — ${role || "Internship"} at Headstart Mentoring`;

const inviteHtml = (firstName, role, when) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:600px;">
  <p style="margin:0 0 16px;">Hi ${firstName},</p>
  <p style="margin:0 0 16px;">Thank you for applying for the ${role ? role + " role" : "internship"} at Headstart Mentoring. We&rsquo;d like to invite you to an online interview.</p>
  <p style="margin:0 0 16px;">It is a half hour chat about your experience, what you would work on with us, and anything you want to know about the role.</p>
  <ul style="margin:0 0 16px;padding-left:22px;">
    <li style="margin-bottom:4px;"><strong>Date:</strong> ${when}</li>
    <li style="margin-bottom:4px;"><strong>Time:</strong> Sydney time</li>
    <li style="margin-bottom:4px;"><strong>Zoom link:</strong> <a href="${ZOOM.link}" target="_blank" style="color:#8a6210;text-decoration:underline;font-weight:600;">join here</a></li>
    <li style="margin-bottom:4px;"><strong>Passcode:</strong> ${ZOOM.passcode}</li>
  </ul>
  <p style="margin:0 0 16px;">Just reply to this email to confirm. If the time does not suit, send me a couple of alternatives and I will work around you.</p>
  <p style="margin:0 0 16px;">Looking forward to speaking with you.</p>
  <p style="margin:0;">Best Regards,<br /><strong>Fidel Hon</strong><br />Co-Founder at Headstart Mentoring</p>
</div>`;

const inviteText = (firstName, role, when) =>
  `Hi ${firstName},\n\n` +
  `Thank you for applying for the ${role ? role + " role" : "internship"} at Headstart Mentoring. We'd like to invite you to an online interview.\n\n` +
  `It is a half hour chat about your experience, what you would work on with us, and anything you want to know about the role.\n\n` +
  `Date: ${when} (Sydney time)\n` +
  `Zoom link: ${ZOOM.link}\n` +
  `Passcode: ${ZOOM.passcode}\n\n` +
  `Just reply to this email to confirm. If the time does not suit, send me a couple of alternatives and I will work around you.\n\n` +
  `Looking forward to speaking with you.\n\n` +
  `Best Regards,\nFidel Hon\nCo-Founder at Headstart Mentoring`;

// Exported so the copy can be previewed without sending a real one.
exports.preview = { inviteSubject, inviteHtml, inviteText };

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

/** "Tuesday 16 September 2026, 5:00 PM" from an ISO instant, in Sydney. */
function sydney(iso) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long",
    year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso));
}

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) return json(403, { error: "Not authorised" });

  const { AIRTABLE_API_TOKEN: token, BREVO_API_KEY } = process.env;
  if (!token) return json(500, { error: "AIRTABLE_API_TOKEN is not set" });

  try {
    // --- send an invite -----------------------------------------------
    if (p.action === "invite") {
      if (!p.id || !p.when) return json(400, { error: "Need an applicant and a time" });
      if (!BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY is not set" });

      const rec = await at(`${BASE}/${TABLE}/${p.id}`, {}, token);
      const f = rec.fields || {};
      const email = (f["Email"] || "").trim();
      if (!email) return json(400, { error: "That applicant has no email on the record" });

      const first = String(f["Name"] || "").trim().split(/\s+/)[0] || "there";
      const role = f["Role"] || "";
      const when = sydney(p.when);

      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: SENDER, replyTo: REPLY_TO,
          to: [{ email, name: f["Name"] || email }],
          subject: inviteSubject(role),
          htmlContent: inviteHtml(first, role, when),
          textContent: inviteText(first, role, when),
        }),
      });
      if (!res.ok) {
        // Keep the reason. Marking somebody invited who never got the email is
        // the one failure that costs a candidate.
        let reason = `HTTP ${res.status}`;
        try { const e = await res.json(); reason = e.message || e.code || reason; } catch { /* keep status */ }
        return json(502, { error: `Brevo rejected the email: ${reason}` });
      }

      // Stamped only after Brevo accepts, so a blank Invite Sent always means
      // the email did not go.
      await at(`${BASE}/${TABLE}/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: {
          "Status": "Invited",
          "Invite Sent": ymd(new Date()),
          "Interview Date": p.when,
        } }),
      }, token);
      return json(200, { ok: true, sentTo: email, when });
    }

    // --- update a field -----------------------------------------------
    if (p.action === "set") {
      if (!p.id || !p.fields) return json(400, { error: "Nothing to save" });
      const allowed = ["Status", "Interview Response", "Notes", "Interview Date", "Role"];
      const fields = {};
      Object.entries(p.fields).forEach(([k, v]) => { if (allowed.includes(k)) fields[k] = v; });
      if (!Object.keys(fields).length) return json(400, { error: "No writable fields" });
      await at(`${BASE}/${TABLE}/${p.id}`, { method: "PATCH", body: JSON.stringify({ fields }) }, token);
      return json(200, { ok: true });
    }

    // --- the list -----------------------------------------------------
    const data = await at(`${BASE}/${TABLE}?pageSize=100`, {}, token);
    const applicants = (data.records || [])
      // The intake wrote three empty rows during testing in July. A row with no
      // name and no email is not a person, so it never reaches the page.
      .filter((r) => (r.fields["Name"] || "").trim() || (r.fields["Email"] || "").trim())
      .map((r) => {
        const f = r.fields;
        const resume = Array.isArray(f["Resume"]) && f["Resume"].length ? f["Resume"][0] : null;
        return {
          id: r.id,
          name: f["Name"] || "Unnamed",
          email: f["Email"] || "",
          phone: f["Phone Number"] || "",
          linkedin: f["Linkedin"] || "",
          portfolio: f["Portfolio"] || "",
          resume: resume ? resume.url : "",
          role: f["Role"] || "",
          status: f["Status"] || "New",
          applied: (f["Applied"] || r.createdTime || "").slice(0, 10),
          inviteSent: (f["Invite Sent"] || "").slice(0, 10),
          interviewAt: f["Interview Date"] || "",
          response: f["Interview Response"] || "",
          notes: f["Notes"] || "",
        };
      })
      // Newest application first: the people worth answering are the new ones.
      .sort((a, b) => (b.applied || "").localeCompare(a.applied || ""));

    return json(200, { applicants });
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }
};
