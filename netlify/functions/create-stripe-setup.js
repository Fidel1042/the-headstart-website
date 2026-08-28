const Stripe = require("stripe");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Fetch the mentee's existing Stripe Customer ID from Airtable (if any).
// Returns { stripeCustomerId, email, name } or null when the record is not found.
async function fetchMenteeFromAirtable(recordId) {
  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;
  if (!AIRTABLE_API_TOKEN || !AIRTABLE_CORE_BASE_ID || !AIRTABLE_MENTEE_TABLE_ID) return null;

  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return {
      stripeCustomerId: data.fields?.["Stripe Customer ID"] || null,
      email: data.fields?.["Gmail"] || null,
      name: data.fields?.["Name"] || null,
    };
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Stripe key not configured on server" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const name = (payload.name || "").trim();
  const email = (payload.email || "").trim();
  const menteeRecordId = (payload.menteeRecordId || "").trim();

  if (!name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Name is required" }) };
  }

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    let customer;
    let source; // for debugging / return payload

    // 1. Preferred path: token-based dedupe using the Airtable record ID
    if (menteeRecordId) {
      const menteeRecord = await fetchMenteeFromAirtable(menteeRecordId);
      if (menteeRecord?.stripeCustomerId) {
        try {
          customer = await stripe.customers.retrieve(menteeRecord.stripeCustomerId);
          source = "airtable-record";
        } catch {
          // Stored ID points to a deleted / non-existent customer, fall through
          customer = null;
        }
      }
    }

    // 2. Fallback: match by email (existing behaviour, preserves back-compat)
    if (!customer && email) {
      const existing = await stripe.customers.list({ email, limit: 1 });
      customer = existing.data[0];
      if (customer) source = source || "email-match";
    }

    // 3. No match found: create fresh
    if (!customer) {
      customer = await stripe.customers.create({
        name,
        email: email || undefined,
        metadata: {
          source: "mentee-agreement",
          ...(menteeRecordId ? { mentee_record_id: menteeRecordId } : {}),
        },
      });
      source = "created";
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customer.id,
      payment_method_types: ["card"],
      usage: "off_session",
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        client_secret: setupIntent.client_secret,
        customer_id: customer.id,
        source, // "airtable-record" | "email-match" | "created"
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message || "Stripe error" }),
    };
  }
};
