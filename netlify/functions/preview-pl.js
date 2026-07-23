const { TOTAL_OPEX, OPEX_LINES, FOUNDER_SESSION_COST, isFounder } = require("../shared/pl-costs");

const headers = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
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

  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;

  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-indexed current month
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;

  // Pull a 60 day window rather than just this month. The month-to-date figures
  // are filtered out of it below, but the uncharged-session alert needs to keep
  // showing an unpaid session from last month: if it only looked at the current
  // month, every unpaid session would silently disappear on the 1st and never
  // get chased. 60 days always fully covers the current month.
  const since = new Date(now);
  since.setDate(since.getDate() - 60);
  const sinceLabel = since.toISOString().slice(0, 10);
  const formula = encodeURIComponent(`IS_AFTER({Date}, '${sinceLabel}')`);

  let sessions;
  try {
    const res  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${formula}` +
      ["Amount Charged", "Amount Due", "Payment Status", "Mentor Payout",
       "Date", "Mentee Name", "Mentor Name", "Mentor Email", "Stripe Payment ID"]
        .map((f) => `&fields[]=${encodeURIComponent(f)}`).join("") +
      `&sort[0][field]=Date&sort[0][direction]=asc`,
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
  let founderSessions = 0;
  const lines = [];   // one row per session this month, for the breakdown
  const needsCharging = [];   // any session in the window with nothing collected

  for (const s of sessions) {
    const status  = s.fields["Payment Status"] || "";
    const charged = parseFloat(s.fields["Amount Charged"]) || 0;
    const due     = parseFloat(s.fields["Amount Due"]) || 0;
    const payout  = parseFloat(s.fields["Mentor Payout"]) || 0;

    // A Stripe payment ID is the only reliable marker that money actually moved
    // through Stripe. When a card fails, Fidel collects manually (bank transfer
    // or similar) and logs the amount with no payment ID, so those rows must not
    // be charged the 3.25% + 30c. Deducting a fee that was never paid
    // understates profit on roughly 40% of collected revenue.
    const viaStripe = Boolean(s.fields["Stripe Payment ID"]);
    const fee       = (charged > 0 && viaStripe) ? charged * 0.0325 + 0.30 : 0;

    const date    = (s.fields["Date"] || "").slice(0, 10);
    const inMonth = date.startsWith(monthLabel);

    const line = {
      date,
      mentee: s.fields["Mentee Name"] || "",
      mentor: s.fields["Mentor Name"] || "",
      status, method: viaStripe ? "Stripe" : "Manual",
      charged, fee, payout,
    };

    // Package PURCHASE row (the one-off up-front charge): cash-in only. Revenue
    // is recognised across the delivered sessions instead, so it is not counted
    // as revenue or as a session, but it did incur a real Stripe fee.
    if (status === "Package" && charged > 0) {
      if (inMonth) {
        stripeFees += fee;
        lines.push({ ...line, revenue: 0, payout: 0, margin: -fee, kind: "purchase" });
      }
      continue;
    }

    // Recognised revenue: per-session mentees at what was charged; delivered
    // package sessions at their per-session value (Amount Due). Failed/Pending = 0.
    let revenue = 0;
    if (status === "Charged")      revenue = charged;
    else if (status === "Package") revenue = due;

    // Nothing collected on a session that is not covered by a package: the
    // charge never ran, or it failed. Surfaced so it can be chased rather than
    // quietly absorbed as a loss.
    //
    // "Written Off" is a deliberate decision not to charge, so it is excluded.
    // Without it a written-off session sits in the alert forever and the alert
    // stops being something worth reading. (Add the option to the Payment
    // Status field in Airtable; this line already handles it.)
    if (revenue === 0 && status !== "Package" && status !== "Written Off") {
      needsCharging.push({ ...line, revenue: 0, margin: -fee - payout, kind: "session" });
    }

    if (!inMonth) continue;

    // Founder sessions with no payout recorded. If Fidel ever does pay himself,
    // that payout is already a real cost, so it must not be counted twice.
    if (payout === 0 && isFounder(s.fields["Mentor Email"], s.fields["Mentor Name"])) {
      founderSessions += 1;
    }

    grossRevenue  += revenue;
    stripeFees    += fee;
    mentorPayouts += payout;
    sessionCount  += 1;
    lines.push({ ...line, revenue, margin: revenue - fee - payout, kind: "session" });
  }

  const grossProfit = grossRevenue - stripeFees - mentorPayouts;
  const netProfit   = grossProfit - TOTAL_OPEX;
  const round = (n) => parseFloat(n.toFixed(2));
  const pct   = (n) => grossRevenue > 0 ? parseFloat(((n / grossRevenue) * 100).toFixed(1)) : 0;

  // Per-mentor rollup, so it is obvious at a glance who is driving the month.
  const byMentor = {};
  for (const l of lines) {
    if (l.kind !== "session") continue;
    const k = l.mentor || "Unassigned";
    byMentor[k] = byMentor[k] || { mentor: k, sessions: 0, revenue: 0, payout: 0, margin: 0 };
    byMentor[k].sessions += 1;
    byMentor[k].revenue  += l.revenue;
    byMentor[k].payout   += l.payout;
    byMentor[k].margin   += l.margin;
  }

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
      opexLines:     OPEX_LINES,
      totalOpex:     TOTAL_OPEX,
      netProfit:     round(netProfit),
      netMargin:     pct(netProfit),
      // Shown separately, never mixed into costs above.
      founderSessions,
      founderRate:   FOUNDER_SESSION_COST,
      founderCost:   round(founderSessions * FOUNDER_SESSION_COST),
      netAfterFounder: round(netProfit - founderSessions * FOUNDER_SESSION_COST),
      netAfterFounderMargin: pct(netProfit - founderSessions * FOUNDER_SESSION_COST),
      // Detailed breakdown
      lines:   lines.map((l) => ({
        ...l,
        charged: round(l.charged), fee: round(l.fee),
        payout: round(l.payout), revenue: round(l.revenue), margin: round(l.margin),
      })),
      mentors: Object.values(byMentor)
        .map((m) => ({ ...m, revenue: round(m.revenue), payout: round(m.payout), margin: round(m.margin) }))
        .sort((a, b) => b.margin - a.margin),
      // Uncharged sessions across the whole 60 day window, newest first.
      needsCharging: needsCharging
        .map((l) => ({ ...l, payout: round(l.payout), margin: round(l.margin) }))
        .sort((a, b) => (b.date || "").localeCompare(a.date || "")),
      windowFrom: sinceLabel,
    }),
  };
};
