// preview-week.js
// Read-only. Shows every mentee about to be charged in the weekly run,
// grouped so each mentee is ONE combined charge for all their Pending
// sessions. Nothing is charged here — this only reads Airtable + Stripe.
//
// Owner-gated: the caller's email must be in OWNERS.

const Stripe = require("stripe");
const { requireOwner } = require("../shared/require-owner");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

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

  // ── Pull every Pending session (mentee not yet charged) ──
  const pending = [];
  try {
    let offset = null;
    do {
      const formula = encodeURIComponent(`{Payment Status}="Pending"`);
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        `&fields[]=Mentee%20Name&fields[]=Mentee%20Record%20ID&fields[]=Date&fields[]=Amount%20Due` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      pending.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  // ── Group by mentee ──
  const byMentee = {};
  for (const s of pending) {
    const recId  = s.fields["Mentee Record ID"] || "";
    const name   = s.fields["Mentee Name"] || "Unknown";
    const amount = parseFloat(s.fields["Amount Due"]) || 0;
    const key = recId || `name:${name}`;
    if (!byMentee[key]) byMentee[key] = { recordId: recId, name, sessions: [], total: 0 };
    byMentee[key].sessions.push({ date: s.fields["Date"] || "", amount });
    byMentee[key].total += amount;
  }

  // ── Check each mentee has a usable Stripe card on file ──
  const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" }) : null;

  const mentees = await Promise.all(Object.values(byMentee).map(async (m) => {
    let hasCard = false;
    let customerId = null;
    if (m.recordId) {
      try {
        const mRes = await fetch(
          `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${m.recordId}`,
          { headers: airtableHeaders }
        );
        const mData = await mRes.json();
        customerId = mData.fields?.["Stripe Customer ID"] || null;
      } catch { /* leave customerId null */ }
    }
    if (customerId && stripe) {
      try {
        const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 1 });
        hasCard = methods.data.length > 0;
      } catch { hasCard = false; }
    }
    return {
      recordId: m.recordId,
      name:     m.name,
      count:    m.sessions.length,
      total:    parseFloat(m.total.toFixed(2)),
      hasCard,
      sessions: m.sessions.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }));

  mentees.sort((a, b) => a.name.localeCompare(b.name));

  const chargeableTotal = mentees.filter((m) => m.hasCard).reduce((s, m) => s + m.total, 0);
  const grandTotal      = mentees.reduce((s, m) => s + m.total, 0);

  const today = new Date();
  const weekLabel = `As of ${today.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      weekLabel,
      mentees,
      grandTotal:      parseFloat(grandTotal.toFixed(2)),
      chargeableTotal: parseFloat(chargeableTotal.toFixed(2)),
    }),
  };
};
