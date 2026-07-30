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

const { isPrepaid } = require("../shared/charge-engine");

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

  const { menteeRecordId, mentorEmail, sessionDate, nextSessionDate, notes, payoutHeld, loggedBy } = payload;

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

  // ── Step 0: has this session already been logged? ──
  // Fidel logs sessions on behalf of mentors who have not got round to it. When
  // the mentor eventually logs the same session himself, a second row would mean
  // paying the same session twice. Same mentee + same date = the same session, so
  // no duplicate row is written. A held payout stays held: releasing it is
  // Fidel's decision alone, never something a mentor can trigger by logging.
  try {
    const dupeFormula =
      `AND({Mentee Record ID}="${menteeRecordId}",{Date}="${sessionDate}")`;
    const dupeRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${encodeURIComponent(dupeFormula)}&maxRecords=1` +
      `&fields[]=Mentee Name&fields[]=Payout Held`,
      { headers: airtableHeaders }
    );
    const dupe = (await dupeRes.json()).records?.[0];
    if (dupe) {
      // The mentor has caught up on a session Fidel logged for him. Stamp the
      // date so the held panel can say "he has logged this, pay him". The
      // payout itself stays held; only Fidel's click releases it.
      if (dupe.fields["Payout Held"] && !loggedBy) {
        await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}/${dupe.id}`, {
          method: "PATCH",
          headers: airtableHeaders,
          body: JSON.stringify({ fields: { "Mentor Logged At": new Date().toISOString().slice(0, 10) } }),
        }).catch(() => {});
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          duplicate: true,
          message: "This session is already logged, so nothing was added.",
        }),
      };
    }
  } catch {
    // A failed duplicate check must never block a mentor from logging. Worst
    // case is the old behaviour: a possible double row, which Fidel can see.
  }

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
    isPackage       = isPrepaid(menteeRecord.fields["Billing type"]);
    // Per-session value. For package mentees this is the recognised value of a
    // delivered session (e.g. $150 package / 5 = $30) — it is NOT charged (the
    // weekly run only charges "Pending" rows), it just lets the P&L value each
    // package session instead of showing $0.
    sessionPriceAUD = parseFloat(menteeRecord.fields["Session Price"]) || 30;
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
    "Amount Due":       sessionPriceAUD,
    "Mentor Payout":    mentorRate,
    "Payment Status":   isPackage ? "Package" : "Pending",
  };

  // Logged by an owner on a mentor's behalf. The payout is recorded in full but
  // held back from the next payslip, so the mentor sees the money is there and
  // waiting rather than losing it. Untick "Payout Held" in Airtable to release.
  if (payoutHeld) fields["Payout Held"] = true;
  if (loggedBy) fields["Logged By"] = loggedBy;

  // "Next Session" is an optional DATE field. Airtable rejects an empty string
  // on a date field ('Cannot parse date value ""'), which would fail the whole
  // write — so only include it when the mentor actually picked a date.
  if (nextSessionDate) fields["Next Session"] = nextSessionDate;

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

      // Whenever Airtable names a specific field as the problem, drop that field
      // and retry — so a mentor is never blocked by a schema or value issue.
      // Covers both:
      //   "Unknown field name: \"X\""                    (field doesn't exist)
      //   "Cannot parse date value \"\" for field X"     (bad value for the field)
      //   "Invalid value for column X"                   (bad value, other types)
      const badField =
        (msg.match(/Unknown field name:\s*"?([^"]+?)"?\.?$/i)   || [])[1] ||
        (msg.match(/for field\s+"?([^"]+?)"?\.?$/i)             || [])[1] ||
        (msg.match(/for column\s+"?([^"]+?)"?\.?$/i)            || [])[1];

      if (badField && Object.prototype.hasOwnProperty.call(fields, badField)) {
        droppedFields.push(badField);
        delete fields[badField];
        continue;
      }
      // Anything else (auth, table not found) — genuinely can't recover.
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

  // ── Package-completion alert ──
  // When a package mentee's delivered sessions reach the package size, email
  // Fidel so he can follow up on a renewal. Fires once, on the session that
  // completes the package. Best-effort: never blocks or fails the log.
  let packageComplete = false;
  if (isPackage) {
    try {
      const PACKAGE_TOTAL = 5; // default package size
      const listRes = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${encodeURIComponent(`AND({Mentee Record ID}="${menteeRecordId}",{Payment Status}="Package")`)}` +
        `&fields[]=Amount%20Charged`,
        { headers: airtableHeaders }
      );
      const listData = await listRes.json();
      // Delivered sessions = Package rows that were NOT actually charged. The
      // one-off $150 purchase row has Amount Charged > 0 and is excluded;
      // delivered sessions carry their value in Amount Due, not Amount Charged.
      const delivered = (listData.records || []).filter((r) => {
        const c = parseFloat(r.fields["Amount Charged"]) || 0;
        return c <= 0;
      }).length;

      // Fire only on the transition to complete (or over), so it alerts once.
      if (delivered >= PACKAGE_TOTAL && (delivered - 1) < PACKAGE_TOTAL) {
        packageComplete = true;
        if (process.env.BREVO_API_KEY) {
          await fetch("https://api.brevo.com/v3/smtp/email", {
            method: "POST",
            headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
            body: JSON.stringify({
              sender:  { name: "The Headstart", email: "fidel@theheadstartmentoring.com" },
              to:      [{ email: "fidelhon@gmail.com", name: "Fidel" }],
              subject: `Package complete — ${menteeName} used all ${PACKAGE_TOTAL} sessions`,
              htmlContent: `<p><strong>${menteeName}</strong> (mentor ${mentorName}) just completed session ${delivered} of ${PACKAGE_TOTAL} — their package is fully used.</p><p>Time to follow up on a renewal.</p>`,
            }),
          }).catch(() => {});
        }
      }
    } catch { /* alert is best-effort; never block logging */ }
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      menteeName,
      status: isPackage ? "Package" : "Pending",
      packageComplete,
      // Present only if the Sessions table is missing fields — a signal to fix
      // the schema. Charging needs "Amount Due" + "Mentee Record ID", so if
      // either is dropped it'll show up here (and as $0 in the weekly preview).
      droppedFields: droppedFields.length ? droppedFields : undefined,
    }),
  };
};
