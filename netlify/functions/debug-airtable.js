// Temporary debug function — delete after Airtable issue is resolved
exports.handler = async () => {
  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_BASE_ID,
    AIRTABLE_SESSION_TABLE_ID,
  } = process.env;

  const envCheck = {
    AIRTABLE_API_TOKEN:      AIRTABLE_API_TOKEN ? `set (${AIRTABLE_API_TOKEN.length} chars)` : "MISSING",
    AIRTABLE_BASE_ID:        AIRTABLE_BASE_ID || "MISSING",
    AIRTABLE_SESSION_TABLE_ID: AIRTABLE_SESSION_TABLE_ID || "MISSING",
  };

  // Try writing a test record
  let writeStatus = null;
  let writeBody   = null;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: {
            "Mentor Email":      "debug@test.com",
            "Mentee Name":       "Debug Test",
            "Date":              "2026-06-17",
            "Extra Notes":       "AUTO-GENERATED DEBUG RECORD — DELETE ME",
            "Amount Charged":    0,
            "Stripe Payment ID": "debug",
            "Payment Status":    "Failed",
            "Failure Reason":    "debug test",
            "Mentor Payout":     0,
          },
        }),
      }
    );
    writeStatus = res.status;
    writeBody   = await res.json();
  } catch (e) {
    writeBody = { networkError: e.message };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ envCheck, writeStatus, writeBody }, null, 2),
  };
};
