// mentor-stats.js — the numbers behind a mentor's own dashboard.
//
// Month on month: sessions delivered, what they earned, and sessions per
// student. Plus the cadence figure: the average gap between one mentee's
// sessions, which is the number that actually moves earnings. A mentor seeing
// two mentees weekly earns more than one seeing six mentees monthly.
//
// Read-only. Every mentor sees only their own rows; the only shared number is
// the cadence target, which is deliberately the same for everybody.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

// The cadence every mentor is asked to aim at, in days between a mentee's
// sessions. Weekly, matching what the onboarding already asks for, so the
// dashboard and the training say the same thing. Change it here and every
// dashboard follows.
const TARGET_GAP_DAYS = 7;

const MONTHS = 6;

async function fetchAll(baseId, tableId, fields, token) {
  const out = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

/** Average days between consecutive sessions for the same mentee. */
function averageGap(sessionsByMentee) {
  const gaps = [];
  Object.values(sessionsByMentee).forEach((dates) => {
    const sorted = [...new Set(dates)].sort();
    for (let i = 1; i < sorted.length; i++) {
      const d = (new Date(sorted[i] + "T00:00:00Z") - new Date(sorted[i - 1] + "T00:00:00Z")) / 86400000;
      // A gap over three months is someone coming back, not a cadence.
      if (d > 0 && d <= 90) gaps.push(d);
    }
  });
  if (!gaps.length) return null;
  return Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10;
}

/** The last N months as YYYY-MM, oldest first, so empty months still show. */
function monthKeys(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setMonth(x.getMonth() - i);
    out.push(x.toISOString().slice(0, 7));
  }
  return out;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const wanted = String(payload.mentorEmail || "").toLowerCase().trim();
  if (!wanted) return json(400, { error: "mentorEmail is required" });

  const { AIRTABLE_API_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;

  try {
    const rows = await fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
      ["Date", "Mentee Name", "Mentor Email", "Mentor Payout", "Payment Status", "Amount Charged"],
      AIRTABLE_API_TOKEN);

    // A "Package" row carrying money is the purchase itself, not a lesson.
    const delivered = rows.filter((r) => {
      const f = r.fields;
      if (!f["Date"]) return false;
      return !(f["Payment Status"] === "Package" && (parseFloat(f["Amount Charged"]) || 0) > 0);
    });

    const mine = delivered.filter((r) =>
      String(r.fields["Mentor Email"] || "").toLowerCase().trim() === wanted);

    const keys = monthKeys(MONTHS);
    const buckets = {};
    keys.forEach((k) => { buckets[k] = { month: k, sessions: 0, earnings: 0, mentees: new Set() }; });

    mine.forEach((r) => {
      const f = r.fields;
      const k = String(f["Date"]).slice(0, 7);
      if (!buckets[k]) return;
      buckets[k].sessions += 1;
      buckets[k].earnings += parseFloat(f["Mentor Payout"]) || 0;
      buckets[k].mentees.add(String(f["Mentee Name"] || "").trim().toLowerCase());
    });

    const months = keys.map((k) => {
      const b = buckets[k];
      const mentees = b.mentees.size;
      return {
        month: k,
        sessions: b.sessions,
        earnings: Math.round(b.earnings * 100) / 100,
        mentees,
        // The number that separates a busy month from a productive one.
        perStudent: mentees ? Math.round((b.sessions / mentees) * 10) / 10 : 0,
      };
    });

    // Cadence, mine and everyone's. The all-mentor figure is returned so the
    // page can show where the group actually sits, separately from the target.
    const group = (list) => {
      const byMentee = {};
      list.forEach((r) => {
        const name = String(r.fields["Mentee Name"] || "").trim().toLowerCase();
        if (!name) return;
        (byMentee[name] = byMentee[name] || []).push(String(r.fields["Date"]).slice(0, 10));
      });
      return byMentee;
    };

    const myGap = averageGap(group(mine));

    // Per mentee, so the number stops being abstract. "Your average is 9 days"
    // is not actionable; "Vikrant is on 15 days, Ahmed is on 7" is.
    const byMenteeName = {};
    mine.forEach((r) => {
      const name = String(r.fields["Mentee Name"] || "").trim();
      if (!name) return;
      (byMenteeName[name] = byMenteeName[name] || []).push(String(r.fields["Date"]).slice(0, 10));
    });
    const todayISO = new Date().toISOString().slice(0, 10);
    const mentees = Object.entries(byMenteeName).map(([name, dates]) => {
      const sorted = [...new Set(dates)].sort();
      const gap = averageGap({ x: sorted });
      const last = sorted[sorted.length - 1];
      const since = Math.round((new Date(todayISO + "T00:00:00Z") - new Date(last + "T00:00:00Z")) / 86400000);
      return { name, sessions: sorted.length, gap, last, since };
    })
    // Worst cadence first: that is where the next session is hiding.
    .sort((a, b) => (b.gap === null ? -1 : b.gap) - (a.gap === null ? -1 : a.gap));

    const perMentor = {};
    delivered.forEach((r) => {
      const e = String(r.fields["Mentor Email"] || "").toLowerCase().trim();
      if (!e) return;
      (perMentor[e] = perMentor[e] || []).push(r);
    });
    const gaps = Object.values(perMentor).map((list) => averageGap(group(list))).filter((g) => g !== null);
    const allMentorGap = gaps.length
      ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10
      : null;

    const totals = months.reduce((a, m) => ({
      sessions: a.sessions + m.sessions,
      earnings: Math.round((a.earnings + m.earnings) * 100) / 100,
    }), { sessions: 0, earnings: 0 });

    return json(200, {
      months,
      totals,
      gap: myGap,
      mentees,
      allMentorGap,
      targetGap: TARGET_GAP_DAYS,
      // How many more sessions this month would come from hitting the target
      // with the mentees they already have. Concrete beats abstract.
      upside: (() => {
        const now = months[months.length - 1];
        if (!now.mentees || !myGap) return null;
        const atTarget = Math.round((30 / TARGET_GAP_DAYS) * now.mentees);
        const extra = atTarget - now.sessions;
        if (extra <= 0) return null;
        const rate = now.sessions ? now.earnings / now.sessions : 0;
        return { extraSessions: extra, extraEarnings: Math.round(extra * rate) };
      })(),
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }
};
