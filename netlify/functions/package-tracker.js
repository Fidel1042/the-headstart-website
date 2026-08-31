// package-tracker.js
// Owner-only. For every Package (pre-paid) mentee, counts how many sessions
// they've used vs. how many they bought, so you can see who's running out.
//
//   used      = number of delivered "Package" sessions logged for that mentee
//   total     = sessions bought, summed from their package PURCHASE rows
//   remaining = total - used   (negative = they've gone over)
//
// Buying a second package extends the allowance rather than replacing it. A
// purchase row with no "Package Sessions" value counts as one standard pack.

const { PREPAID_FORMULA } = require("../shared/charge-engine");
const { requireOwner } = require("../shared/require-owner");

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
  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
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
    // No fields[] filter on purpose: "Package Sessions" is optional (default 5),
    // and asking Airtable for a field that doesn't exist rejects the whole
    // request. Fetching all fields is safe and reads the override if present.
    const packageMentees = [];
    let offset = null;
    do {
      const formula = encodeURIComponent(PREPAID_FORMULA);
      const url = `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      packageMentees.push(...(data.records || []));
      offset = data.offset || null;
    } while (offset);

    // ── 2. Every "Package" session. Count by record ID when present, otherwise
    // by name — so a mentee with a mix of old (name-only) and new (record-ID)
    // sessions is counted correctly, with no double-count and no undercount. ──
    const byId       = {};
    const byNameNoId = {};
    const boughtById       = {};   // sessions purchased, from the purchase rows
    const boughtByNameNoId = {};
    const DEFAULT_PACKAGE_SESSIONS = 5;
    offset = null;
    do {
      const formula = encodeURIComponent(`{Payment Status}="Package"`);
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
        `?filterByFormula=${formula}` +
        (offset ? `&offset=${offset}` : "");
      const res  = await fetch(url, { headers: airtableHeaders });
      const data = await res.json();
      for (const s of (data.records || [])) {
        // A "Package" row that was actually charged (Amount Charged > 0) is the
        // one-off package PURCHASE, not a delivered session — skip it so it
        // doesn't eat into the allowance. Delivered sessions carry their value
        // in Amount Due, and have Amount Charged of 0/blank.
        const charged = parseFloat(s.fields["Amount Charged"]) || 0;
        const rid  = s.fields["Mentee Record ID"] || "";
        const name = norm(s.fields["Mentee Name"]);

        // A purchase row is where the allowance comes from. Each one adds the
        // sessions it bought, so a mentee who buys a second package gets both
        // counted rather than being stuck at one package's worth.
        if (charged > 0) {
          const bought = parseInt(s.fields["Package Sessions"], 10) || DEFAULT_PACKAGE_SESSIONS;
          if (rid)       boughtById[rid]        = (boughtById[rid]        || 0) + bought;
          else if (name) boughtByNameNoId[name] = (boughtByNameNoId[name] || 0) + bought;
          continue;
        }

        if (rid)       byId[rid]        = (byId[rid]        || 0) + 1;
        else if (name) byNameNoId[name] = (byNameNoId[name] || 0) + 1;
      }
      offset = data.offset || null;
    } while (offset);

    // ── 3. Merge: bought vs used per package mentee (prefer record-ID match) ──
    // The allowance is the sum of what their purchase rows actually bought, so
    // buying a second package extends it. A mentee marked Package with no
    // purchase row logged yet falls back to one standard package.
    const num = (v) => (v === undefined || v === "" || v === null) ? null : (parseInt(v, 10) || 0);

    const mentees = packageMentees.map((m) => {
      const id    = m.id;
      const name  = m.fields["Name"] || "Unnamed mentee";
      const bought = (boughtById[id] || 0) + (boughtByNameNoId[norm(name)] || 0);
      const total = bought || DEFAULT_PACKAGE_SESSIONS;

      // Sessions used before logging existed (set per mentee mid-package).
      const prior  = num(m.fields["Sessions Already Used"]) || 0;
      const logged = (byId[id] || 0) + (byNameNoId[norm(name)] || 0);
      const used   = prior + logged;
      const remaining = total - used;
      return {
        name,
        mentor: m.fields["Mentor Email Plain"] || "",
        used,
        prior,
        logged,
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
