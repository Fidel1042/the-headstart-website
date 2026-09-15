// Fires on every mentee-agreement Netlify form submission.
// Writes the Stripe Customer ID onto the correct Airtable mentee record.
//
// Preferred path: use the mentee_record_id token passed from the agreement URL.
// Fallback: look up by email (kept for links generated before tokenisation).
//
// Wiring (do once in Netlify dashboard):
//   Site → Forms → mentee-agreement → Notifications → Add outgoing webhook
//   URL: https://<your-site>.netlify.app/.netlify/functions/agreement-sync
//   Event: New form submission

const headers = { "Content-Type": "application/json" };


/**
 * Tell Fidel, rather than telling Netlify.
 *
 * Netlify reads a non-2xx as "this webhook is broken", marks the hook failing,
 * and eventually disables it. That is right for a crash and wrong for the
 * commonest case here: somebody signs using a different email from the one on
 * their CRM record, which is a five second human fix and not a fault in the
 * plumbing. One of those used to be enough to put the whole form at risk for
 * everyone behind it.
 *
 * So an unmatchable signature now returns 200 with a flag, and this email is
 * what makes sure it is not silently dropped instead.
 */
async function alertUnmatched(data, reason) {
  const key = process.env.BREVO_API_KEY;
  if (!key) return;
  const row = (k, v) => `<p style="margin:0 0 4px"><b>${k}:</b> ${String(v || "&mdash;")}</p>`;
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "The Headstart", email: "fidel@theheadstartmentoring.com" },
      to: [{ email: "fidelhon@gmail.com", name: "Fidel" }],
      subject: `Signed agreement could not be matched: ${data.full_name || data.email || "unknown"}`,
      htmlContent:
        `<p>Somebody signed the mentee agreement and it could not be attached to a CRM record.</p>` +
        `<p><b>${reason}</b></p>` +
        row("Name", data.full_name) + row("Email on the agreement", data.email) +
        row("Phone", data.phone) + row("Stripe customer", data.stripe_customer_id) +
        row("Payment option", data.payment_option) + row("Signed", data.date_signed) +
        `<p style="margin-top:14px">The signature itself is safe in Netlify Forms. ` +
        `Find them in the Client table, put this email on the record or paste the ` +
        `Stripe customer id in by hand, and nothing is lost.</p>`,
    }),
  }).catch(() => {});
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let netlifyPayload;
  try {
    netlifyPayload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const data              = netlifyPayload.payload?.data || netlifyPayload.data || netlifyPayload;
  const email             = (data.email || "").trim().toLowerCase();
  const stripeCustomerId  = (data.stripe_customer_id || "").trim();
  const menteeRecordId    = (data.mentee_record_id || "").trim();

  // Both of these are a signature that arrived without enough to place it, and
  // both are worth a human look rather than a failed delivery.
  if (!stripeCustomerId) {
    await alertUnmatched(data, "The submission carried no Stripe customer id, so there is no card to attach.");
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, unmatched: true, reason: "no stripe_customer_id" }) };
  }
  if (!menteeRecordId && !email) {
    await alertUnmatched(data, "The submission carried neither a record id nor an email.");
    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, unmatched: true, reason: "nothing to match on" }) };
  }

  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  let recordId = menteeRecordId;
  let matchedVia = menteeRecordId ? "record-id" : null;

  // Fallback: find mentee record by email when no token was passed
  if (!recordId) {
    try {
      const searchRes = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
        `?filterByFormula=${encodeURIComponent(`{Gmail}="${email}"`)}&fields[]=Gmail`,
        { headers: airtableHeaders }
      );
      const searchData = await searchRes.json();

      if (!searchData.records || searchData.records.length === 0) {
        // 200 on purpose. See alertUnmatched above: this is a person to chase,
        // not a broken webhook, and a 404 here costs everyone behind them.
        await alertUnmatched(data, `No client record has the email ${email}.`);
        return { statusCode: 200, headers,
          body: JSON.stringify({ ok: false, unmatched: true, email, reason: "no record for that email" }) };
      }

      recordId = searchData.records[0].id;
      matchedVia = "email";
    } catch (err) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable unreachable during lookup", detail: err.message }) };
    }
  }

  // Write Stripe Customer ID to the resolved Airtable record
  try {
    const updateRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${recordId}`,
      {
        method: "PATCH",
        headers: airtableHeaders,
        body: JSON.stringify({ fields: { "Stripe Customer ID": stripeCustomerId } }),
      }
    );

    if (!updateRes.ok) {
      const body = await updateRes.json().catch(() => ({}));
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable update failed", detail: body, recordId }) };
    }
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable unreachable during update", detail: err.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, email, stripeCustomerId, recordId, matchedVia }) };
};
