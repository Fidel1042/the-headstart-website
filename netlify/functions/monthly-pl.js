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

const FIXED_COSTS = {
  "Claude Pro": 34,   // AUD
  "Make.com":   15,   // AUD approx (9.5 USD)
};

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

  const formula = encodeURIComponent(
    `AND(YEAR({Date})=${year},MONTH({Date})=${month})`
  );

  const sessionsRes = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
    `?filterByFormula=${formula}&fields[]=Amount%20Charged&fields[]=Mentor%20Email`,
    { headers: airtableHeaders }
  );
  const sessionsData = await sessionsRes.json();
  const sessions = sessionsData.records || [];

  let grossRevenue  = 0;
  let stripeFees    = 0;
  let mentorPayouts = 0;

  for (const s of sessions) {
    const amount      = parseFloat(s.fields["Amount Charged"]) || 0;
    const mentorEmail = (s.fields["Mentor Email"] || "").toLowerCase().trim();

    grossRevenue  += amount;
    stripeFees    += amount * 0.0325 + 0.30; // 1.75% domestic + 1.5% international card surcharge
    mentorPayouts += MENTOR_RATES[mentorEmail] ?? 0;
  }

  const grossProfit = grossRevenue - stripeFees - mentorPayouts;
  const totalOpex   = Object.values(FIXED_COSTS).reduce((a, b) => a + b, 0);
  const netProfit   = grossProfit - totalOpex;

  const round = (n) => parseFloat(n.toFixed(2));
  const pct   = (n) => grossRevenue > 0 ? parseFloat(((n / grossRevenue) * 100).toFixed(1)) : 0;

  await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_PL_TABLE_ID}`,
    {
      method: "POST",
      headers: airtableHeaders,
      body: JSON.stringify({
        fields: {
          "Month":           monthLabel,
          "Session Count":   sessions.length,
          "Gross Revenue":   round(grossRevenue),
          "Stripe Fees":     round(stripeFees),
          "Mentor Payouts":  round(mentorPayouts),
          "Gross Profit":    round(grossProfit),
          "Gross Margin %":  pct(grossProfit),
          "Claude Pro":      FIXED_COSTS["Claude Pro"],
          "Make.com":        FIXED_COSTS["Make.com"],
          "Total Opex":      totalOpex,
          "Net Profit":      round(netProfit),
          "Net Margin %":    pct(netProfit),
        },
      }),
    }
  );

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, month: monthLabel, netProfit: round(netProfit) }),
  };
};
