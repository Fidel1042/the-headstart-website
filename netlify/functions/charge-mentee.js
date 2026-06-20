const Stripe = require("stripe");

const MENTOR_RATES = {
  "angelicagrace160272@gmail.com": 55,
  "edrickkoda@gmail.com":          20,
  "aidanmwibrata@gmail.com":       20,
  "dhulipatideepika@gmail.com":    20,
  "wooheehan3@gmail.com":          50,
  "laljimkf@gmail.com":            45,
  "raunaqrsa@gmail.com":           20,
  "jai.arora115@gmail.com":        20,
  "fidelhon@gmail.com":             0,
  "kokoro.araki1015@gmail.com":     0,
};

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

  const { menteeRecordId, mentorEmail, sessionDate, notes } = payload;

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

  // ── Step 1: get mentee details ──
  const menteeRes = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${menteeRecordId}`,
    { headers: airtableHeaders }
  );
  const menteeRecord = await menteeRes.json();

  const stripeCustomerId = menteeRecord.fields?.["Stripe Customer ID"];
  const menteeName       = menteeRecord.fields?.["Name"] || "Unknown";
  const menteeEmail      = menteeRecord.fields?.["Gmail"] || "";
  const sessionPriceAUD  = parseFloat(menteeRecord.fields?.["Session Price"]) || 30;
  const amountCents      = Math.round(sessionPriceAUD * 100);

  // ── Step 2: attempt charge (skip if no payment setup) ──
  let paymentSucceeded = false;
  let paymentIntentId  = null;
  let failureReason    = null;

  if (!stripeCustomerId) {
    failureReason = "No Stripe Customer ID on file — mentee hasn't completed payment setup";
  } else {
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });
    const customer = await stripe.customers.retrieve(stripeCustomerId);

    if (!customer.email && menteeEmail) {
      await stripe.customers.update(stripeCustomerId, { email: menteeEmail });
    }

    let paymentMethodId = customer.invoice_settings?.default_payment_method;
    if (!paymentMethodId) {
      const methods = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" });
      if (methods.data.length) {
        paymentMethodId = methods.data[0].id;
      }
    }

    if (!paymentMethodId) {
      failureReason = "No saved card on file — mentee hasn't added a payment method";
    } else {
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "aud",
          customer: stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          description: `Headstart session — ${menteeName} — ${sessionDate}`,
        });
        paymentSucceeded = true;
        paymentIntentId  = paymentIntent.id;
      } catch (stripeErr) {
        failureReason = stripeErr.message || "Charge failed";
      }
    }
  }

  // ── Step 4: always log the session ──
  let logError = null;
  try {
    if (AIRTABLE_SESSION_TABLE_ID) {
      const logRes  = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
        {
          method: "POST",
          headers: airtableHeaders,
          body: JSON.stringify({
            fields: {
              "Mentor Email":      mentorEmail,
              "Mentee Name":       menteeName,
              "Date":              sessionDate,
              "Extra Notes":       notes || "",
              "Amount Charged":    paymentSucceeded ? amountCents / 100 : 0,
              "Stripe Payment ID": paymentIntentId || "",
              "Payment Status":    paymentSucceeded ? "Charged" : "Failed",
              "Failure Reason":    failureReason || "",
              "Mentor Payout":     MENTOR_RATES[mentorEmail.toLowerCase().trim()] ?? 0,
            },
          }),
        }
      );
      if (!logRes.ok) {
        const logBody = await logRes.json().catch(() => ({}));
        logError = logBody?.error?.message || `Airtable status ${logRes.status}`;
      }
    }
  } catch (e) {
    logError = e.message;
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      menteeName,
      amountCharged: paymentSucceeded ? amountCents / 100 : 0,
      paymentSucceeded,
      paymentIntentId,
      failureReason,
      logError,
    }),
  };
};
