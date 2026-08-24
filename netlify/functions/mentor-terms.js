// mentor-terms.js — the per-mentor bits of the mentor agreement.
//
// Everything in the agreement is the same for everyone except what they are
// paid, and that is different for almost every mentor. Keeping the rate in
// Airtable and reading it when the page loads means changing someone's pay is
// an edit in Airtable, not a code change and a deploy.
//
// Read only, and it returns nothing but a name and a rate. The link carries an
// Airtable record id, which is 17 characters of random, so it is unguessable
// in practice and needs no login on a phone.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

const SENDER = { name: "Fidel @Headstart Mentoring", email: "fidel@theheadstartmentoring.com" };
const SITE = "https://theheadstartmentoring.com";
const LINKEDIN = "https://www.linkedin.com/company/the-headstartmentoring/";

/**
 * The offer email, carrying the agreement link.
 *
 * Fidel's wording, with one change: the original asked them to reply with
 * their bank details and a signed copy. The agreement page now collects both,
 * so those two steps became one link. Replying with a BSB in an email thread
 * is the thing this was built to stop.
 */
const offerSubject = () => "Welcome to Headstart Mentoring — your contract";

const offerHtml = (firstName, link) => `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#17170f;max-width:600px;">
  <p style="margin:0 0 16px;">Hi ${firstName},</p>
  <p style="margin:0 0 16px;">Thank you for your interest in being a mentor at Headstart Mentoring. We are so excited to have you on board!</p>
  <p style="margin:0 0 16px;">To confirm your offer, please action below:</p>
  <ol style="margin:0 0 16px;padding-left:22px;">
    <li style="margin-bottom:6px;"><a href="${link}" style="color:#8a6210;font-weight:600;">Open your contract here</a>, read it, add your bank details and sign it</li>
    <li style="margin-bottom:6px;">Add +61 402 238 701 &ndash; Fidel on WhatsApp &amp; send a message</li>
    <li style="margin-bottom:6px;">Follow us on <a href="${LINKEDIN}" style="color:#8a6210;">LinkedIn</a></li>
  </ol>
  <p style="margin:0 0 16px;">We will notify you the moment we have your first mentee.<br />Have fun career coaching!</p>
  <p style="margin:0;">Best Regards,<br />Fidel Hon<br />Co-Founder at Headstart Mentoring<br />+61 402 238 701</p>
</div>`;

const offerText = (firstName, link) =>
  `Hi ${firstName},\n\n` +
  `Thank you for your interest in being a mentor at Headstart Mentoring. We are so excited to have you on board!\n\n` +
  `To confirm your offer, please action below:\n\n` +
  `1. Open your contract here, read it, add your bank details and sign it: ${link}\n` +
  `2. Add +61 402 238 701 - Fidel on WhatsApp & send a message\n` +
  `3. Follow us on LinkedIn - ${LINKEDIN}\n\n` +
  `We will notify you the moment we have your first mentee.\n` +
  `Have fun career coaching!\n\n` +
  `Best Regards,\nFidel Hon\nCo-Founder at Headstart Mentoring\n+61 402 238 701`;

/**
 * Every hired mentor, for the portal's agreement list.
 *
 * Owner only, because unlike the single lookup this one hands back everybody's
 * pay in one response.
 */
async function listMentors(env) {
  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID } = env;
  const out = [];
  let offset = null;
  do {
    const fields = ["Name", "Email", "Status", "Rate", "Agreement Signed", "Rate Agreed",
                    "Legacy Agreement"]
      .map((f) => `fields[]=${encodeURIComponent(f)}`).join("&");
    const url = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}` +
      `?${fields}${offset ? `&offset=${offset}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  return out
    .filter((r) => (r.fields["Status"] || "") === "Hired")
    .map((r) => {
      const rate = parseFloat(r.fields["Rate"]) || 0;
      const agreed = parseFloat(r.fields["Rate Agreed"]) || 0;
      const signed = (r.fields["Agreement Signed"] || "").slice(0, 10);
      return {
        id: r.id,
        name: r.fields["Name"] || "Unnamed",
        email: (r.fields["Email"] || "").toLowerCase().trim(),
        rate, rateSet: rate > 0, signed,
        // Already signed the old paper version. They are done, and listing
        // them as outstanding would make this page a to-do list of 14 things
        // nobody needs to do.
        legacy: Boolean(r.fields["Legacy Agreement"]),
        // Signed at one rate, being paid at another. Worth seeing, because it
        // means somebody changed the rate after the agreement went out.
        rateChanged: Boolean(signed && agreed && agreed !== rate),
        agreedRate: agreed,
      };
    })
    .sort((a, b) => Number(Boolean(a.signed)) - Number(Boolean(b.signed))
      || a.name.localeCompare(b.name));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  if (p.action === "list") {
    if (!OWNERS.includes((p.adminEmail || "").toLowerCase().trim())) {
      return json(403, { error: "Not authorised" });
    }
    try { return json(200, { mentors: await listMentors(process.env) }); }
    catch (err) { return json(502, { error: err.message || "Could not list mentors" }); }
  }

  const id = String(p.mentorId || "").trim();
  if (!/^rec[A-Za-z0-9]{14}$/.test(id)) {
    return json(400, { error: "That link is missing its mentor code." });
  }

  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTOR_TABLE_ID } = process.env;

  // Emailing the offer. Owner only, and it refuses to send an agreement that
  // would show no rate.
  if (p.action === "offer") {
    if (!OWNERS.includes((p.adminEmail || "").toLowerCase().trim())) {
      return json(403, { error: "Not authorised" });
    }
    try {
      const rec = await (await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}/${id}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}` } })).json();
      if (!rec.fields) return json(404, { error: "That link does not match a mentor." });
      const email = (rec.fields["Email"] || "").trim();
      const name = rec.fields["Name"] || "";
      if (!email) return json(400, { error: `${name || "That mentor"} has no email on their record` });
      if (!(parseFloat(rec.fields["Rate"]) > 0)) {
        return json(400, { error: "Set a rate first, or the contract shows nothing to agree to." });
      }
      if (!process.env.BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY missing" });

      const first = name.trim().split(/\s+/)[0] || "there";
      const link = `${SITE}/mentor-agreement?m=${id}`;
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: SENDER, to: [{ email, name }], replyTo: SENDER,
          subject: offerSubject(),
          htmlContent: offerHtml(first, link),
          textContent: offerText(first, link),
        }),
      });
      if (!res.ok) {
        let reason = `HTTP ${res.status}`;
        try { const e = await res.json(); reason = e.message || e.code || reason; } catch { /* keep */ }
        return json(502, { error: `Brevo refused it: ${reason}` });
      }
      return json(200, { sent: true, to: email, name });
    } catch (err) {
      return json(502, { error: err.message || "Could not send the offer" });
    }
  }

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}/${id}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}` } });
    const rec = await res.json();
    if (!rec.fields) return json(404, { error: "That link does not match a mentor." });

    const rate = parseFloat(rec.fields["Rate"]) || 0;
    return json(200, {
      mentorId: id,
      name: rec.fields["Name"] || "",
      email: (rec.fields["Email"] || "").toLowerCase().trim(),
      rate,
      // A rate of zero means nobody has set one yet, not that the work is
      // unpaid. The page refuses to show an agreement rather than inviting
      // somebody to sign up to nothing.
      rateSet: rate > 0,
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not load the agreement" });
  }
};
