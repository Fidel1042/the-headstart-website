const Stripe = require("stripe");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { menteeRecordId, mentorEmail, sessionDate, sessionType, notes } = payload;

  if (!menteeRecordId || !mentorEmail || !sessionDate) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: "menteeRecordId, mentorEmail, and sessionDate are required" }),
    };
  }

  const {
    STRIPE_SECRET_KEY,
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_SESSION_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  try {
    // ── Step 1: get mentee details from Airtable ──
    const menteeRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${menteeRecordId}`,
      { headers: airtableHeaders }
    );
    const menteeRecord = await menteeRes.json();

    const stripeCustomerId = menteeRecord.fields?.["Stripe Customer ID"];
    const menteeName       = menteeRecord.fields?.["Name"] || "Unknown";
    const menteeEmail      = menteeRecord.fields?.["Gmail"] || "";

    if (!stripeCustomerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `No Stripe Customer ID on file for ${menteeName}` }),
      };
    }

    // ── Step 2: get the saved payment method, backfill email if missing ──
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    const customer = await stripe.customers.retrieve(stripeCustomerId);

    // If the Stripe customer has no email (old mentees), push it from Airtable
    if (!customer.email && menteeEmail) {
      await stripe.customers.update(stripeCustomerId, { email: menteeEmail });
    }

    let paymentMethodId = customer.invoice_settings?.default_payment_method;

    if (!paymentMethodId) {
      const methods = await stripe.paymentMethods.list({
        customer: stripeCustomerId,
        type: "card",
      });
      if (!methods.data.length) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `No saved card on file for ${menteeName}` }),
        };
      }
      paymentMethodId = methods.data[0].id;
    }

    // ── Step 3: charge the card (price from mentee record, fallback $150 AUD) ──
    const sessionPriceAUD = parseFloat(menteeRecord.fields?.["Session Price"]) || 30;
    const amountCents = Math.round(sessionPriceAUD * 100);

    // Idempotency key prevents double-charge if browser retries the same request
    const idempotencyKey = `session-${menteeRecordId}-${mentorEmail}-${sessionDate}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "aud",
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Headstart session — ${menteeName} — ${sessionDate}`,
      },
      { idempotencyKey }
    );

    // ── Step 4: log the session to Airtable (non-blocking — charge already succeeded) ──
    try {
      if (AIRTABLE_SESSION_TABLE_ID) {
        await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
          {
            method: "POST",
            headers: airtableHeaders,
            body: JSON.stringify({
              fields: {
                "Mentor Email": mentorEmail,
                "Mentee Name": menteeName,
                "Date": sessionDate,
                "Extra Notes": notes || "",
                "Amount Charged": amountCents / 100,
                "Stripe Payment ID": paymentIntent.id,
              },
            }),
          }
        );
      }
    } catch {
      // Logging failed but charge succeeded — Stripe has the record
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        menteeName,
        amountCharged: amountCents / 100,
        paymentIntentId: paymentIntent.id,
      }),
    };
  } catch (err) {
    // Stripe off-session failures (e.g. card declined) land here
    return {
      statusCode: 402,
      headers,
      body: JSON.stringify({ error: err.message || "Charge failed" }),
    };
  }
};
