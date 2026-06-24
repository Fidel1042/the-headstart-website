// Fires on every mentee-agreement Netlify form submission.
// Finds the mentee's Airtable record by email and writes the Stripe Customer ID automatically.
//
// Wiring (do once in Netlify dashboard):
//   Site → Forms → mentee-agreement → Notifications → Add outgoing webhook
//   URL: https://<your-site>.netlify.app/.netlify/functions/agreement-sync
//   Event: New form submission

const headers = { "Content-Type": "application/json" };

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

  const data             = netlifyPayload.payload?.data || netlifyPayload.data || netlifyPayload;
  const email            = (data.email || "").trim().toLowerCase();
  const stripeCustomerId = (data.stripe_customer_id || "").trim();

  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No email in submission" }) };
  }
  if (!stripeCustomerId) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No stripe_customer_id in submission" }) };
  }

  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // Find mentee record by email
  let recordId;
  try {
    const searchRes  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
      `?filterByFormula=${encodeURIComponent(`{Gmail}="${email}"`)}&fields[]=Gmail`,
      { headers: airtableHeaders }
    );
    const searchData = await searchRes.json();

    if (!searchData.records || searchData.records.length === 0) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: `No mentee record found for ${email}` }) };
    }

    recordId = searchData.records[0].id;
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable unreachable during lookup", detail: err.message }) };
  }

  // Write Stripe Customer ID to Airtable
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
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable update failed", detail: body }) };
    }
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Airtable unreachable during update", detail: err.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, email, stripeCustomerId, recordId }) };
};
