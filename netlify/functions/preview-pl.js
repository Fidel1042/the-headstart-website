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
      `?filterByFormula=${formula}&fields[]=Amount%20Charged&fields[]=Mentor%20Email`,
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

  for (const s of sessions) {
    const amount      = parseFloat(s.fields["Amount Charged"]) || 0;
    const mentorEmail = (s.fields["Mentor Email"] || "").toLowerCase().trim();
    if (amount <= 0) continue;
    grossRevenue  += amount;
    stripeFees    += amount * 0.0325 + 0.30;
    mentorPayouts += MENTOR_RATES[mentorEmail] ?? 0;
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
      sessionCount:  sessions.filter((s) => (parseFloat(s.fields["Amount Charged"]) || 0) > 0).length,
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
