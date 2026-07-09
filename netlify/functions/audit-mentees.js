// audit-mentees.js
// Owner-only diagnostic. Explains why mentees go missing from a mentor's
// dropdown. Scans every mentee, cross-references "Mentor Email Plain" against
// the real Mentor table, and flags:
//   - blank    : no mentor email set (invisible to every mentor)
//   - unknown  : mentor email doesn't match any real mentor (typo / old email)
//   - nocard   : no Stripe customer and not a Package mentee (can't be charged)
// Also returns a per-mentor count so you can see "Raunaq: 1 matched" at a glance.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST")    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const adminEmail = (payload.adminEmail || "").toLowerCase().trim();
  if (!OWNERS.includes(adminEmail)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Not authorised" }) };
  }

  const {
    AIRTABLE_API_TOKEN,
    AIRTABLE_CORE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_MENTOR_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  const norm = (s) => (s || "").toString().toLowerCase().trim();

  // Hired-mentor allowlist (the portal's ALLOWED_MENTOR_EMAILS, passed from the
  // page). Used to keep non-hired mentor candidates out of the summary. If none
  // is passed, every mentor in the table is shown.
  const allowedSet = new Set(
    (Array.isArray(payload.allowlist) ? payload.allowlist : []).map(norm).filter(Boolean)
  );

  try {
    // ── All real mentors ──
    const mentors = [];
    let offset = null;
    do {
      const url = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTOR_TABLE_ID}` +
        `?fields[]=Name&fields[]=Email` + (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      mentors.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    const mentorByEmail = {};
    for (const m of mentors) {
      const email = norm(m.fields["Email"]);
      if (email) mentorByEmail[email] = {
        email,
        name: m.fields["Name"] || email,
        menteeCount: 0,
        mentees: [],
        hired: allowedSet.size === 0 || allowedSet.has(email),
      };
    }

    // ── All mentees ──
    const mentees = [];
    offset = null;
    do {
      const url = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
        `?fields[]=Name&fields[]=Mentor%20Email%20Plain&fields[]=Stripe%20Customer%20ID&fields[]=Billing%20type` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      mentees.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    const issues = [];
    for (const r of mentees) {
      const name        = r.fields["Name"] || "Unnamed mentee";
      const mentorPlain = r.fields["Mentor Email Plain"] || "";
      const isPackage   = (r.fields["Billing type"] || "Per Session") === "Package";
      const hasCard     = Boolean(r.fields["Stripe Customer ID"]);
      const key         = norm(mentorPlain);

      const problems = [];
      if (!key) {
        problems.push("blank");
      } else if (!mentorByEmail[key]) {
        problems.push("unknown");
      } else {
        mentorByEmail[key].menteeCount += 1;
        mentorByEmail[key].mentees.push(name);
      }
      if (!hasCard && !isPackage) problems.push("nocard");

      if (problems.length) {
        issues.push({ mentee: name, mentorEmailPlain: mentorPlain, problems });
      }
    }

    // Only hired mentors in the summary; unknown-detection above still used the
    // full mentor table, so mentees under real-but-not-yet-hired mentors aren't
    // falsely flagged.
    const summary = Object.values(mentorByEmail)
      .filter((m) => m.hired)
      .map(({ hired, ...m }) => m)
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        mentorCount: summary.length,
        menteeCount: mentees.length,
        summary,
        issues: issues.sort((a, b) => a.mentee.localeCompare(b.mentee)),
      }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
