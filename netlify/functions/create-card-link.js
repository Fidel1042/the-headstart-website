// create-card-link.js
// Owner-only. Generates a Stripe-hosted "add your card" link for a mentee who
// ALREADY has a Stripe customer on file. The new card attaches to that same
// customer (the one the weekly charge uses).
//
// It NEVER creates a customer and NEVER writes to Airtable — read-only lookup
// only, so it can't produce duplicate Stripe customers. If the mentee has no
// Stripe customer yet, it errors and tells you to set them up via the agreement.

const Stripe = require("stripe");
const { requireOwner } = require("../shared/require-owner");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];
const SITE = "https://theheadstartmentoring.com";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const adminEmail = (payload.adminEmail || "").toLowerCase().trim();
  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Not authorised" }) };
  }

  const email = (payload.email || "").trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Mentee email is required" }) };
  }

  const {
    STRIPE_SECRET_KEY,
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  // ── Find the mentee's Client record by Gmail (read-only) ──
  let record;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
      `?filterByFormula=${encodeURIComponent(`LOWER({Gmail})="${email}"`)}` +
      `&fields[]=Name&fields[]=Gmail&fields[]=Stripe%20Customer%20ID&maxRecords=1`,
      { headers: airtableHeaders }
    );
    const data = await res.json();
    record = (data.records || [])[0];
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  if (!record) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: `No mentee found with email ${email}` }) };
  }

  const menteeName = record.fields["Name"] || "Mentee";
  const customerId = record.fields["Stripe Customer ID"] || null;

  // No customer on file — do NOT create one (would risk a duplicate). Tell Fidel.
  if (!customerId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        error: `${menteeName} has no Stripe customer on file. This link only re-adds a card to an existing customer — set them up via the agreement first.`,
      }),
    };
  }

  try {
    // Stripe-hosted setup checkout for the EXISTING customer — saves a card,
    // takes no payment. If the customer ID is somehow invalid, Stripe errors
    // here (no new customer is created).
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      payment_method_types: ["card"],
      customer: customerId,
      success_url: `${SITE}/?card=saved`,
      cancel_url:  `${SITE}/?card=cancelled`,
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url, mentee: menteeName, customerId }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Stripe error" }) };
  }
};
