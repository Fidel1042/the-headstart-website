const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  // Owners only: this returns revenue, which would reveal mentee pricing.
  let ownerEmail = "";
  try { ownerEmail = (JSON.parse(event.body || "{}").ownerEmail || "").toLowerCase().trim(); } catch {}
  if (!OWNERS.includes(ownerEmail)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Owners only" }) };
  }

  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_BASE_ID,
    AIRTABLE_PL_TABLE_ID,
  } = process.env;

  try {
    const res  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_PL_TABLE_ID}` +
      `?sort[0][field]=Month&sort[0][direction]=desc`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" } }
    );
    const data = await res.json();

    const records = (data.records || []).map((r) => ({
      month:          r.fields["Month"]          || "",
      sessionCount:   r.fields["Session Count"]  || 0,
      grossRevenue:   r.fields["Gross Revenue"]  || 0,
      stripeFees:     r.fields["Stripe Fees"]    || 0,
      mentorPayouts:  r.fields["Mentor Payouts"] || 0,
      grossProfit:    r.fields["Gross Profit"]   || 0,
      grossMargin:    r.fields["Gross Margin %"] || 0,
      claudePro:      r.fields["Claude Pro"]     || 0,
      makeCom:        r.fields["Make.com"]       || 0,
      totalOpex:      r.fields["Total Opex"]     || 0,
      netProfit:      r.fields["Net Profit"]     || 0,
      netMargin:      r.fields["Net Margin %"]   || 0,
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ records }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
