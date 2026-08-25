// portal-access.js — is this email allowed in the mentor portal?
//
// Access used to be a hardcoded array in auth.js, so hiring somebody meant
// editing code and pushing, and dropping somebody meant remembering to edit it
// again. It almost never happened, which left former mentors with working
// logins.
//
// Airtable is the authority now: Hired gets in, anything else does not. The
// hardcoded list still exists in auth.js purely as a fallback for when this
// function cannot be reached, so an outage never locks the team out.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

// Always in, regardless of the Mentors table. Fidel and Koko run the business
// and are not managed as pipeline records.
const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];

const ALLOWED_STATUS = "Hired";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const email = String(p.email || "").trim().toLowerCase();
  if (!email) return json(400, { error: "No email given" });

  if (OWNERS.includes(email)) return json(200, { allowed: true, reason: "owner" });

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTOR_TABLE_ID: table } = process.env;
  if (!token || !base || !table) {
    // Cannot answer, so do not pretend to. The caller falls back to its own
    // list rather than treating a broken lookup as a refusal.
    return json(503, { error: "Lookup unavailable" });
  }

  try {
    // Matched in the formula rather than by pulling the whole table, so one
    // person's login never ships every mentor's email to the browser.
    const safe = email.replace(/["\\]/g, "");
    const formula = `LOWER(TRIM({Email})) = "${safe}"`;
    const url = `https://api.airtable.com/v0/${base}/${table}` +
      `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1` +
      `&fields[]=Name&fields[]=Status`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) return json(503, { error: "Lookup unavailable" });

    const rec = (data.records || [])[0];
    if (!rec) return json(200, { allowed: false, reason: "not a mentor" });

    const status = rec.fields["Status"] || "";
    return json(200, {
      allowed: status === ALLOWED_STATUS,
      reason: status === ALLOWED_STATUS ? "hired" : status.toLowerCase() || "no status",
      name: rec.fields["Name"] || "",
    });
  } catch (err) {
    return json(503, { error: "Lookup unavailable" });
  }
};
