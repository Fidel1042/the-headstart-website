const FIXED_COSTS = {
  claudePro: 34,
  makeCom:   15,
};

const headers = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed current month
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

  const formula = encodeURIComponent(`AND(YEAR({Date})=${year},MONTH({Date})=${month})`);

  let sessions;
  try {
    const res  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${formula}&fields[]=Amount%20Charged&fields[]=Amount%20Due&fields[]=Payment%20Status&fields[]=Mentor%20Payout`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" } }
    );
    const data = await res.json();
    sessions   = data.records || [];
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  let grossRevenue  = 0;
  let stripeFees    = 0;
  let mentorPayouts = 0;
  let sessionCount  = 0;

  for (const s of sessions) {
    const status  = s.fields["Payment Status"] || "";
    const charged = parseFloat(s.fields["Amount Charged"]) || 0;
    const due     = parseFloat(s.fields["Amount Due"]) || 0;
    const payout  = parseFloat(s.fields["Mentor Payout"]) || 0;

    // Package PURCHASE row (the one-off $150 charge): cash-in only. Revenue is
    // recognised across the delivered sessions instead, so it's not counted as
    // revenue or as a session — but it did incur a real Stripe fee.
    if (status === "Package" && charged > 0) {
      stripeFees += charged * 0.0325 + 0.30;
      continue;
    }

    // Recognised revenue: per-session mentees at what was charged; delivered
    // package sessions at their per-session value (Amount Due). Failed/Pending = 0.
    let revenue = 0;
    if (status === "Charged")      revenue = charged;
    else if (status === "Package") revenue = due;

    grossRevenue  += revenue;
    if (charged > 0) stripeFees += charged * 0.0325 + 0.30;
    mentorPayouts += payout;
    sessionCount  += 1;
  }

  const grossProfit = grossRevenue - stripeFees - mentorPayouts;
  const totalOpex   = FIXED_COSTS.claudePro + FIXED_COSTS.makeCom;
  const netProfit   = grossProfit - totalOpex;
  const round = (n) => parseFloat(n.toFixed(2));
  const pct   = (n) => grossRevenue > 0 ? parseFloat(((n / grossRevenue) * 100).toFixed(1)) : 0;

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      month:         monthLabel,
      sessionCount,
      grossRevenue:  round(grossRevenue),
      stripeFees:    round(stripeFees),
      mentorPayouts: round(mentorPayouts),
      grossProfit:   round(grossProfit),
      grossMargin:   pct(grossProfit),
      claudePro:     FIXED_COSTS.claudePro,
      makeCom:       FIXED_COSTS.makeCom,
      totalOpex,
      netProfit:     round(netProfit),
      netMargin:     pct(netProfit),
    }),
  };
};
