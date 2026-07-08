// log-session.js
// Records a mentor's session WITHOUT charging the mentee.
// Charging happens once a week from the admin "Weekly Billing" page
// (preview-week.js + charge-week.js). This keeps logging bulletproof:
// a card issue can never block a mentor from logging a session.
//
// Requires these fields on the Airtable Sessions table:
//   Mentor Email       (text)
//   Mentor Name        (text)
//   Mentee Name        (text)
//   Mentee Record ID   (text)      ← NEW: reliable link back to the mentee
//   Date               (date)
//   Extra Notes        (text)
//   Amount Due         (number)    ← NEW: price to charge in the weekly run
//   Mentor Payout      (number)
//   Payment Status     (single select: Pending / Charged / Failed / Package)
//   Mentor Paid        (checkbox / text)

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
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_SESSION_TABLE_ID,
    AIRTABLE_MENTOR_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // ── Step 1: pull mentee + mentor details in parallel ──
  let menteeName, isPackage, sessionPriceAUD, mentorName, mentorRate;
  try {
    const mentorLookupUrl =
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}` +
      `?filterByFormula=${encodeURIComponent(`LOWER({Email})="${mentorEmail.toLowerCase().trim()}"`)}` +
      `&fields[]=Name&fields[]=Rate`;

    const [menteeRes, mentorRes] = await Promise.all([
      fetch(`https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${menteeRecordId}`, { headers: airtableHeaders }),
      fetch(mentorLookupUrl, { headers: airtableHeaders }),
    ]);

    const menteeRecord = await menteeRes.json();
    const mentorData   = await mentorRes.json();

    if (!menteeRecord.fields) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: "Mentee record not found in Airtable" }) };
    }

    menteeName      = menteeRecord.fields["Name"] || "Unknown";
    isPackage       = (menteeRecord.fields["Billing type"] || "Per Session") === "Package";
    sessionPriceAUD = isPackage ? 0 : (parseFloat(menteeRecord.fields["Session Price"]) || 30);
    mentorName      = mentorData.records?.[0]?.fields?.["Name"] || mentorEmail;
    mentorRate      = parseFloat(mentorData.records?.[0]?.fields?.["Rate"]) || 0;
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  // ── Step 2: log the session as Pending (or Package if pre-paid) ──
  // Self-healing write: if the Sessions table is missing a field (e.g. it was
  // never created, or named slightly differently), Airtable rejects the whole
  // write with "Unknown field name: X". Rather than block the mentor, we drop
  // just that field and retry. The session always saves; any dropped fields are
  // reported back so Fidel can fix the schema, but the mentor never sees an error.
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`;

  let fields = {
    "Mentor Email":     mentorEmail,
    "Mentor Name":      mentorName,
    "Mentee Name":      menteeName,
    "Mentee Record ID": menteeRecordId,
    "Date":             sessionDate,
    "Extra Notes":      notes || "",
    "Amount Due":       isPackage ? 0 : sessionPriceAUD,
    "Mentor Payout":    mentorRate,
    "Payment Status":   isPackage ? "Package" : "Pending",
  };

  const droppedFields = [];
  let saved = false;
  let lastError = null;

  try {
    // At most 9 attempts — one per possible field to drop.
    for (let attempt = 0; attempt < 9; attempt++) {
      const logRes = await fetch(url, {
        method: "POST",
        headers: airtableHeaders,
        body: JSON.stringify({ fields }),
      });

      if (logRes.ok) { saved = true; break; }

      const logBody = await logRes.json().catch(() => ({}));
      const msg = logBody?.error?.message || `Airtable status ${logRes.status}`;
      lastError = msg;

      // If Airtable names an unknown field, drop it and retry.
      const match = msg.match(/Unknown field name:\s*"?([^"]+?)"?$/i);
      if (match && Object.prototype.hasOwnProperty.call(fields, match[1])) {
        droppedFields.push(match[1]);
        delete fields[match[1]];
        continue;
      }
      // A different error (auth, table not found, bad value) — stop.
      break;
    }
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: e.message || "Could not log session" }) };
  }

  if (!saved) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: lastError || "Could not log session" }),
    };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      menteeName,
      status: isPackage ? "Package" : "Pending",
      // Present only if the Sessions table is missing fields — a signal to fix
      // the schema. Charging needs "Amount Due" + "Mentee Record ID", so if
      // either is dropped it'll show up here (and as $0 in the weekly preview).
      droppedFields: droppedFields.length ? droppedFields : undefined,
    }),
  };
};
