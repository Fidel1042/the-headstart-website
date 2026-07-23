const {
  FIXED_COSTS, TOTAL_OPEX, OPEX_BREAKDOWN, FOUNDER_SESSION_COST, isFounder,
} = require("../shared/pl-costs");

exports.handler = async () => {
  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_BASE_ID,
    AIRTABLE_SESSION_TABLE_ID,
    AIRTABLE_PL_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // Previous month
  const now = new Date();
  const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth(); // 1-indexed
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

  // Dedup check — skip if a record for this month already exists
  try {
    const existingRes  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_PL_TABLE_ID}` +
      `?filterByFormula=${encodeURIComponent(`{Month}="${monthLabel}"`)}&fields[]=Month`,
      { headers: airtableHeaders }
    );
    const existingData = await existingRes.json();
    if ((existingData.records || []).length > 0) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: "Record already exists", month: monthLabel }) };
    }
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Airtable unreachable during dedup check", detail: err.message }) };
  }

  let sessions;
  try {
    const formula      = encodeURIComponent(`AND(YEAR({Date})=${year},MONTH({Date})=${month})`);
    const sessionsRes  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${formula}` +
      ["Amount Charged", "Amount Due", "Payment Status", "Mentor Payout",
       "Stripe Payment ID", "Mentor Email", "Mentor Name"]
        .map((f) => `&fields[]=${encodeURIComponent(f)}`).join(""),
      { headers: airtableHeaders }
    );
    const sessionsData = await sessionsRes.json();
    sessions = sessionsData.records || [];
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Airtable unreachable fetching sessions", detail: err.message }) };
  }

  let grossRevenue  = 0;
  let stripeFees    = 0;
  let mentorPayouts = 0;
  let sessionCount  = 0;
  let founderSessions = 0;

  for (const s of sessions) {
    const status  = s.fields["Payment Status"] || "";
    const charged = parseFloat(s.fields["Amount Charged"]) || 0;
    const due     = parseFloat(s.fields["Amount Due"]) || 0;
    const payout  = parseFloat(s.fields["Mentor Payout"]) || 0;

    // A Stripe payment ID is the only reliable marker that money actually moved
    // through Stripe. When a card fails, Fidel collects manually and logs the
    // amount with no payment ID, so those rows must not be charged the
    // 3.25% + 30c. Must match preview-pl.js.
    const viaStripe = Boolean(s.fields["Stripe Payment ID"]);
    const fee       = (charged > 0 && viaStripe) ? charged * 0.0325 + 0.30 : 0;

    // Package PURCHASE row (one-off up-front charge): cash-in only, no revenue
    // or session recognised here (recognised per delivered session), but it did
    // incur a real Stripe fee when it went through Stripe.
    if (status === "Package" && charged > 0) {
      stripeFees += fee;
      continue;
    }

    // Recognised revenue: per-session at what was charged; delivered package
    // sessions at their per-session value (Amount Due). Failed/Pending = 0.
    let revenue = 0;
    if (status === "Charged")      revenue = charged;
    else if (status === "Package") revenue = due;

    // Founder sessions carry no payout. Counted so the notional replacement
    // cost can be shown separately; never added to real expenses. Must match
    // preview-pl.js.
    if (payout === 0 && isFounder(s.fields["Mentor Email"], s.fields["Mentor Name"])) {
      founderSessions += 1;
    }

    grossRevenue  += revenue;
    stripeFees    += fee;
    mentorPayouts += payout;
    sessionCount  += 1;
  }

  const grossProfit = grossRevenue - stripeFees - mentorPayouts;
  const netProfit   = grossProfit - TOTAL_OPEX;

  const round = (n) => parseFloat(n.toFixed(2));
  const pct   = (n) => grossRevenue > 0 ? parseFloat(((n / grossRevenue) * 100).toFixed(1)) : 0;

  try {
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_PL_TABLE_ID}`,
      {
        method: "POST",
        headers: airtableHeaders,
        body: JSON.stringify({
          fields: {
            "Month":           monthLabel,
            "Session Count":   sessionCount,
            "Gross Revenue":   round(grossRevenue),
            "Stripe Fees":     round(stripeFees),
            "Mentor Payouts":  round(mentorPayouts),
            "Gross Profit":    round(grossProfit),
            "Gross Margin %":  pct(grossProfit),
            ...FIXED_COSTS,
            "Opex Breakdown":  OPEX_BREAKDOWN,
            "Total Opex":      TOTAL_OPEX,
            "Net Profit":      round(netProfit),
            "Net Margin %":    pct(netProfit),
            "Founder Sessions": founderSessions,
            "Founder Cost":     round(founderSessions * FOUNDER_SESSION_COST),
          },
        }),
      }
    );
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: "Airtable unreachable writing P&L record", detail: err.message }) };
  }

  // Do not return any dollar figure: this endpoint is unauthenticated (it runs
  // on a schedule) so its response must not reveal financials.
  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, month: monthLabel }),
  };
};
