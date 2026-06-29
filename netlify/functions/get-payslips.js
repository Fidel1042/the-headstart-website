const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};


exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;

  const today     = new Date();
  const weekLabel = `Outstanding as of ${today.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const formula = encodeURIComponent(`AND({Mentor Paid}=0, IS_AFTER({Date}, DATEADD(TODAY(), -7, 'days')))`);

  let sessions;
  try {
    const res  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${formula}` +
      `&fields[]=Mentor%20Email&fields[]=Mentor%20Name&fields[]=Mentee%20Name&fields[]=Date&fields[]=Mentor%20Payout`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" } }
    );
    const data = await res.json();
    sessions   = data.records || [];
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  const byMentor = {};
  for (const s of sessions) {
    const email  = (s.fields["Mentor Email"] || "").toLowerCase().trim();
    const payout = parseFloat(s.fields["Mentor Payout"]) || 0;
    if (!email || payout === 0) continue;
    const name = s.fields["Mentor Name"] || email;
    if (!byMentor[email]) byMentor[email] = { email, name, sessions: [], total: 0 };
    byMentor[email].sessions.push({
      date:   s.fields["Date"] || "",
      mentee: s.fields["Mentee Name"] || "—",
      payout,
    });
    byMentor[email].total += payout;
  }

  const mentors = Object.values(byMentor).map((m) => ({
    ...m,
    sessions: m.sessions.sort((a, b) => a.date.localeCompare(b.date)),
    total: parseFloat(m.total.toFixed(2)),
  }));

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ weekLabel, mentors }),
  };
};
