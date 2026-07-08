// package-tracker.js
// Owner-only. For every Package (pre-paid) mentee, counts how many sessions
// they've used vs. how many they bought, so you can see who's running out.
//
//   used      = number of "Package" sessions logged for that mentee
//   total     = the mentee's "Package Sessions" field (how many they paid for)
//   remaining = total - used   (negative = they've gone over)
//
// Requires a "Package Sessions" (number) field on the Mentee table.
// If it's blank, total shows as null and remaining can't be computed.

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
    AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID,
    AIRTABLE_SESSION_TABLE_ID,
  } = process.env;

  const airtableHeaders = {
    Authorization: `Bearer ${AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  const norm = (s) => (s || "").toString().toLowerCase().trim();

  try {
    // ── 1. Every Package mentee ──
    const packageMentees = [];
    let offset = null;
    do {
      const formula = encodeURIComponent(`{Billing type}="Package"`);
      const url = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        `&fields[]=Name&fields[]=Package%20Sessions&fields[]=Mentor%20Email%20Plain` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      packageMentees.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    // ── 2. Every "Package" session, grouped by mentee (by record ID, then name) ──
    const usedById   = {};
    const usedByName = {};
    offset = null;
    do {
      const formula = encodeURIComponent(`{Payment Status}="Package"`);
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        `&fields[]=Mentee%20Name&fields[]=Mentee%20Record%20ID` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      for (const s of (data.records || [])) {
        const rid  = s.fields["Mentee Record ID"] || "";
        const name = norm(s.fields["Mentee Name"]);
        if (rid)  usedById[rid]   = (usedById[rid]   || 0) + 1;
        if (name) usedByName[name] = (usedByName[name] || 0) + 1;
      }
      offset = data.offset || null;
    } while (offset);

    // ── 3. Merge: used count per package mentee (prefer record-ID match) ──
    // Packages are 5 sessions by default. If you ever sell a non-standard
    // package, add a "Package Sessions" number field on that mentee and it
    // overrides the default; otherwise 5 is assumed and there's nothing to set.
    const DEFAULT_PACKAGE_SESSIONS = 5;

    const mentees = packageMentees.map((m) => {
      const id    = m.id;
      const name  = m.fields["Name"] || "Unnamed mentee";
      const totalRaw = m.fields["Package Sessions"];
      const total = (totalRaw === undefined || totalRaw === "" || totalRaw === null)
        ? DEFAULT_PACKAGE_SESSIONS : parseInt(totalRaw, 10);
      const used  = usedById[id] != null ? usedById[id] : (usedByName[norm(name)] || 0);
      const remaining = total - used;
      return {
        name,
        mentor: m.fields["Mentor Email Plain"] || "",
        used,
        total,
        remaining,
        status: remaining <= 0 ? "exhausted"
              : remaining <= 1 ? "low"
              : "ok",
      };
    });

    mentees.sort((a, b) => {
      const rank = { exhausted: 0, low: 1, ok: 2 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.name.localeCompare(b.name);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ count: mentees.length, mentees }),
    };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: err.message || "Could not reach Airtable" }) };
  }
};
