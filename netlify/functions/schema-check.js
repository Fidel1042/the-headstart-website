const { requireOwner } = require("../shared/require-owner");
// schema-check.js
// Owner-only. Reads the Airtable schema (via the Meta API) and verifies every
// field and single-select option the portal depends on actually exists and is
// spelled right — so a mentor never discovers a schema gap by being blocked.
//
// Needs the Airtable token to have the "schema.bases:read" scope. If it doesn't,
// this returns a clear message telling you to add that scope.

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
    AIRTABLE_MENTOR_TABLE_ID,
  } = process.env;

  const authHeaders = { Authorization: `Bearer ${AIRTABLE_API_TOKEN}` };

  async function getTables(baseId) {
    const res = await fetch(`https://api.airtable.com/v0/meta/bases/${baseId}/tables`, { headers: authHeaders });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      const msg = b?.error?.message || b?.error?.type || `Meta API status ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    return data.tables || [];
  }

  const findTable = (tables, idOrName) =>
    tables.find((t) => t.id === idOrName || t.name === idOrName);

  // Build the check list for one table.
  function checkTable(table, tableLabel, requiredFields, selectRules) {
    const checks = [];
    if (!table) {
      checks.push({ label: `Table "${tableLabel}" found`, ok: false, detail: "Table not found in this base" });
      return { table: tableLabel, checks };
    }
    const fieldsByName = {};
    for (const f of table.fields) fieldsByName[f.name] = f;

    for (const name of requiredFields) {
      checks.push({
        label: `Field: ${name}`,
        ok: Boolean(fieldsByName[name]),
        detail: fieldsByName[name] ? "" : "missing or misspelled",
      });
    }

    for (const rule of (selectRules || [])) {
      const f = fieldsByName[rule.field];
      if (!f) {
        checks.push({ label: `Options on: ${rule.field}`, ok: false, detail: "field missing" });
        continue;
      }
      const choices = (f.options && f.options.choices) ? f.options.choices.map((c) => c.name) : [];
      for (const opt of rule.options) {
        checks.push({
          label: `${rule.field} option: ${opt}`,
          ok: choices.includes(opt),
          detail: choices.includes(opt) ? "" : "add this dropdown option",
        });
      }
    }
    return { table: tableLabel, checks };
  }

  try {
    const [sessionTables, coreTables] = await Promise.all([
      getTables(AIRTABLE_BASE_ID),
      AIRTABLE_CORE_BASE_ID && AIRTABLE_CORE_BASE_ID !== AIRTABLE_BASE_ID
        ? getTables(AIRTABLE_CORE_BASE_ID)
        : Promise.resolve(null),
    ]);
    const core = coreTables || sessionTables;

    const groups = [];

    groups.push(checkTable(
      findTable(sessionTables, AIRTABLE_SESSION_TABLE_ID),
      "Session Log",
      ["Mentor Email", "Mentor Name", "Mentee Name", "Mentee Record ID", "Date",
       "Extra Notes", "Amount Due", "Amount Charged", "Stripe Payment ID",
       "Payment Status", "Failure Reason", "Mentor Payout", "Mentor Paid"],
      [{ field: "Payment Status", options: ["Pending", "Charged", "Failed", "Package"] }]
    ));

    groups.push(checkTable(
      findTable(core, AIRTABLE_MENTEE_TABLE_ID),
      "Mentees",
      ["Name", "Billing type", "Session Price", "Stripe Customer ID", "Mentor Email Plain", "Gmail"],
      [{ field: "Billing type", options: ["Per Session", "Package", "Prepayment"] }]
    ));

    groups.push(checkTable(
      findTable(core, AIRTABLE_MENTOR_TABLE_ID),
      "Mentors",
      ["Name", "Email", "Rate"],
      []
    ));

    const allChecks = groups.flatMap((g) => g.checks);
    const failCount = allChecks.filter((c) => !c.ok).length;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ allOk: failCount === 0, failCount, groups }),
    };
  } catch (err) {
    const scopeHint = err.status === 403 || err.status === 401;
    return {
      statusCode: 200, // return 200 so the page can show a friendly message
      headers,
      body: JSON.stringify({
        error: scopeHint
          ? "Airtable token can't read the schema. In Airtable → your token → add the \"schema.bases:read\" scope, then retry."
          : (err.message || "Could not read schema"),
      }),
    };
  }
};
