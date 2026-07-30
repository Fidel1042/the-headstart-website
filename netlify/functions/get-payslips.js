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

  // Every UNPAID session, regardless of age. "Mentor Paid" is the source of
  // truth for what's already been paid (marked "Yes" after a payslip run), so
  // no date window is needed — and a date window would silently orphan any
  // session that missed its 7-day slot (which is how Koda's got skipped).
  const formula = encodeURIComponent(`AND(NOT({Mentor Paid}="Yes"),NOT({Payout Held}))`);
  // Held sessions are fetched separately. They are real money owed, just not
  // being paid yet, so they must stay on screen; silently missing pay is how a
  // mentor gets underpaid without anyone noticing.
  const heldFormula = encodeURIComponent(`AND(NOT({Mentor Paid}="Yes"),{Payout Held})`);

  let sessions;
  let heldRows = [];
  try {
    const res  = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${formula}` +
      `&fields[]=Mentor%20Email&fields[]=Mentor%20Name&fields[]=Mentee%20Name&fields[]=Date&fields[]=Mentor%20Payout`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" } }
    );
    const data = await res.json();
    sessions   = data.records || [];

    const heldRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${heldFormula}` +
      `&fields[]=Mentor%20Name&fields[]=Mentee%20Name&fields[]=Date&fields[]=Mentor%20Payout&fields[]=Logged%20By&fields[]=Mentor%20Logged%20At`,
      { headers: { Authorization: `Bearer ${AIRTABLE_API_TOKEN}`, "Content-Type": "application/json" } }
    );
    const heldData = await heldRes.json();
    heldRows = (heldData.records || []).map((r) => ({
      id: r.id,
      date: r.fields["Date"] || "",
      mentor: r.fields["Mentor Name"] || "—",
      mentee: r.fields["Mentee Name"] || "—",
      payout: parseFloat(r.fields["Mentor Payout"]) || 0,
      loggedBy: r.fields["Logged By"] || "",
      // Set when the mentor later logged this session himself. It is the cue to
      // release him, so held rows carrying it sort to the top of the panel.
      caughtUp: r.fields["Mentor Logged At"] || "",
    })).sort((a, b) => (b.caughtUp ? 1 : 0) - (a.caughtUp ? 1 : 0) || a.date.localeCompare(b.date));
  } catch {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Could not reach Airtable — try again in a moment" }) };
  }

  const byMentor = {};
  for (const s of sessions) {
    const email  = (s.fields["Mentor Email"] || "").toLowerCase().trim();
    const payout = parseFloat(s.fields["Mentor Payout"]) || 0;
    if (!email || payout === 0) continue;
    const name = s.fields["Mentor Name"] || email;
    if (!byMentor[email]) byMentor[email] = { email, name, sessions: [], recordIds: [], total: 0 };
    byMentor[email].recordIds.push(s.id);
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
    body: JSON.stringify({ weekLabel, mentors, held: heldRows,
      heldTotal: parseFloat(heldRows.reduce((a, r) => a + r.payout, 0).toFixed(2)) }),
  };
};
