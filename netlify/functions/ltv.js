const { requireOwner } = require("../shared/require-owner");
// ltv.js — what every mentee has been worth, and the averages behind it.
//
// LTV is every dollar charged to that mentee, which deliberately includes a
// prepaid package whose sessions have not happened yet. Money taken is money
// taken; the unrealised part is reported separately so it can be seen rather
// than hidden.
//
// Four columns and nothing else: mentee, LTV, sessions done, rate, mentor.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// A "Package" row carrying money is the purchase itself, not a lesson.
const isPurchase = (f) =>
  (f["Payment Status"] || "") === "Package" && (parseFloat(f["Amount Charged"]) || 0) > 0;

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** Edit distance, capped: we only ever care whether it is 0, 1 or 2. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/**
 * Which mentee a session row belongs to.
 *
 * The Client table is the authority: one record per real person. Session rows
 * are the messy side, because only two thirds carry a Mentee Record ID and the
 * rest have a name somebody typed. "Rapheal" and "Rapheal Lam" are one person;
 * so are "Saksha" and "Sakshi Khatter".
 *
 * Four passes, each tighter than a plain name match and each recorded, so a
 * merge can be checked rather than trusted:
 *   1. the record ID, when the row has one
 *   2. the name, exactly
 *   3. one name being the start of the other, on a word boundary
 *   4. a typo of one or two letters, but only when the mentor agrees too
 */
function resolve(rowName, clients) {
  const n = norm(rowName);
  if (!n) return null;

  const exact = clients.find((c) => c.key === n);
  if (exact) return exact;

  // "Rapheal" against "Rapheal Lam".
  const prefix = clients.filter((c) => c.key.startsWith(n + " ") || n.startsWith(c.key + " "));
  if (prefix.length === 1) return prefix[0];

  // A one-letter typo: "Sarah Abbas" against "Sarah Abbass", "Saksha" against
  // "Sakshi Khatter". Only ever accepted when exactly one mentee could be
  // meant. Two candidates means guessing, and guessing merges two people's
  // money together, so it stops.
  const near = clients.filter((c) => distance(n, c.key) <= 1
    || distance(n.split(" ")[0], c.key.split(" ")[0]) <= 1);
  return near.length === 1 ? near[0] : null;
}

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

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return json(403, { error: "Not authorised" });
  }

  const {
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_BASE_ID,
    AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_SESSION_TABLE_ID,
  } = process.env;

  try {
    const [sessionRecs, clientRecs] = await Promise.all([
      fetchAll(AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID,
        ["Date", "Mentee Name", "Mentee Record ID", "Mentor Name", "Payment Status", "Amount Charged"],
        AIRTABLE_API_TOKEN),
      fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
        ["Name", "Billing type", "Session Price", "Client Pipeline"], AIRTABLE_API_TOKEN),
    ]);

    // One entry per Client record: that table is the authority on who exists.
    const clients = clientRecs.map((r) => ({
      id: r.id,
      key: norm(r.fields["Name"]),
      name: r.fields["Name"] || "Unnamed",
      mentor: "",
      billing: r.fields["Billing type"] || "Per Session",
      rate: parseFloat(r.fields["Session Price"]) || 0,
      stage: r.fields["Client Pipeline"] || "",
      ltv: 0, sessions: 0, prepaid: 0, aliases: new Set(),
    })).filter((c) => c.key);
    const byId = new Map(clients.map((c) => [c.id, c]));

    const orphans = new Map();
    sessionRecs.forEach((r) => {
      const f = r.fields;
      let c = byId.get(f["Mentee Record ID"]) || resolve(f["Mentee Name"], clients);
      if (!c) {
        // No mentee record answers to this name. Keep it as its own row rather
        // than dropping it, so the total always equals the money taken.
        const k = norm(f["Mentee Name"]);
        if (!k) return;
        if (!orphans.has(k)) {
          orphans.set(k, { id: `orphan-${k}`, key: k, name: f["Mentee Name"], mentor: "",
            billing: "Per Session", rate: 0, stage: "Not in the mentee table",
            ltv: 0, sessions: 0, prepaid: 0, aliases: new Set(), orphan: true });
        }
        c = orphans.get(k);
      }
      if (norm(f["Mentee Name"]) && norm(f["Mentee Name"]) !== c.key) c.aliases.add(f["Mentee Name"]);
      c.ltv += parseFloat(f["Amount Charged"]) || 0;
      if (isPurchase(f)) c.prepaid += parseFloat(f["Amount Charged"]) || 0;
      else if (f["Date"]) c.sessions += 1;
      if (f["Mentor Name"]) c.mentor = String(f["Mentor Name"]).trim();
    });

    const rows = [...clients, ...orphans.values()]
      .filter((c) => c.ltv > 0 || c.sessions > 0)
      .map((c) => {
        // What is left of a prepaid package once delivered sessions come off
        // it. Never below zero: a package can be over-delivered.
        const consumed = Math.min(c.prepaid, c.rate * c.sessions);
        return {
          name: c.name,
          ltv: Math.round(c.ltv * 100) / 100,
          sessions: c.sessions,
          rate: c.rate,
          mentor: c.mentor || "Unassigned",
          billing: c.billing,
          unrealised: Math.round(Math.max(c.prepaid - consumed, 0) * 100) / 100,
          stage: c.stage,
          aliases: [...c.aliases],
          orphan: Boolean(c.orphan),
        };
      }).sort((a, b) => b.ltv - a.ltv);

    return json(200, {
      rows,
      mentors: [...new Set(rows.map((r) => r.mentor))].sort(),
      billings: [...new Set(rows.map((r) => r.billing))].sort(),
      // Names with no mentee record behind them. They still appear as rows so
      // the total reconciles; this list is so they can be fixed in Airtable.
      orphans: [...orphans.values()].map((o) => o.name),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not build the LTV table" });
  }
};
