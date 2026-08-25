// mentor-drafts.js — the three profile drafts for a new mentor, waiting to be
// approved.
//
// Deliberately has no AI in it. Claude writes the drafts into Airtable from the
// interview transcript; this page is where Fidel reads them, edits the wording,
// and says yes. Generating here would mean a second, worse writer producing
// copy that goes on the public site.
//
// Approving does not publish. It marks the draft as settled so Claude can ship
// it into the website files, which needs a deploy either way.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

const DRAFTS = {
  landing: "Landing Draft",
  mentors: "Mentors Page Draft",
  internal: "Internal Profile Draft",
};

// The things that are not copy: a logo file, two photos. They cannot be
// generated, only remembered, which is exactly why they get forgotten.
const CHECKS = {
  logo: "Logo Added",
  cardPhoto: "Card Photo",
  detailPhoto: "Detail Photo",
};

const FIELDS = ["Name", "Email", "Status", "Company", "Role", "Industry", "Rate",
                "Int 1 transcript", "Int 1 summary", "Drafts Approved",
                "Profile Shipped", ...Object.values(DRAFTS), ...Object.values(CHECKS)];

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts || {}).headers },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function fetchAll(base, table, token) {
  const out = [];
  let offset = null;
  do {
    const q = `?${FIELDS.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      `&pageSize=100${offset ? `&offset=${offset}` : ""}`;
    const data = await at(`${base}/${table}${q}`, {}, token);
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

const shape = (r) => {
  const f = r.fields;
  const drafts = {};
  for (const [k, name] of Object.entries(DRAFTS)) drafts[k] = f[name] || "";
  const checks = {};
  for (const [k, name] of Object.entries(CHECKS)) checks[k] = Boolean(f[name]);
  return {
    id: r.id,
    name: f["Name"] || "Unnamed",
    role: [f["Role"], f["Company"]].filter(Boolean).join(" at "),
    industry: f["Industry"] || "",
    rate: parseFloat(f["Rate"]) || 0,
    status: f["Status"] || "",
    hasTranscript: Boolean((f["Int 1 transcript"] || "").trim()),
    summary: f["Int 1 summary"] || "",
    drafts,
    checks,
    approved: (f["Drafts Approved"] || "").slice(0, 10),
    shipped: (f["Profile Shipped"] || "").slice(0, 10),
  };
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  if (!OWNERS.includes((p.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTOR_TABLE_ID: table } = process.env;

  try {
    if (p.action === "save") {
      const fields = {};
      for (const [k, name] of Object.entries(DRAFTS)) {
        if (p.drafts && p.drafts[k] !== undefined) fields[name] = String(p.drafts[k]);
      }
      for (const [k, name] of Object.entries(CHECKS)) {
        if (p.checks && p.checks[k] !== undefined) fields[name] = Boolean(p.checks[k]);
      }
      if (!Object.keys(fields).length) return json(400, { error: "Nothing to change" });
      const saved = await at(`${base}/${table}/${p.mentorId}`,
        { method: "PATCH", body: JSON.stringify({ fields }) }, token);
      return json(200, { mentor: shape(saved) });
    }

    if (p.action === "approve" || p.action === "unapprove") {
      const on = p.action === "approve";
      if (on) {
        // Approving an empty draft would tell Claude to publish nothing.
        const rec = await at(`${base}/${table}/${p.mentorId}`, {}, token);
        const missing = Object.entries(DRAFTS)
          .filter(([, name]) => !(rec.fields[name] || "").trim())
          .map(([k]) => k);
        if (missing.length === 3) {
          return json(400, { error: "There are no drafts on this mentor yet." });
        }
      }
      const saved = await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Drafts Approved": on ? new Date().toISOString().slice(0, 10) : null } }),
      }, token);
      return json(200, { mentor: shape(saved) });
    }

    const all = (await fetchAll(base, table, token)).map(shape);
    // Only people who are actually joining. A dropped candidate's transcript is
    // not a profile waiting to be written.
    const relevant = all.filter((m) =>
      (m.status === "Hired" || m.status === "Waiting on signed contract") && !m.shipped);

    return json(200, {
      // Drafts exist and are waiting on a yes.
      waiting: relevant.filter((m) => !m.approved && Object.values(m.drafts).some((d) => d.trim())),
      // Said yes, not on the site yet. Claude's queue.
      approved: relevant.filter((m) => m.approved),
      // Hired with an interview on file and nothing written. Ask Claude.
      needsDrafts: relevant.filter((m) => !m.approved && !Object.values(m.drafts).some((d) => d.trim())),
      shipped: all.filter((m) => m.shipped).length,
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not load drafts" });
  }
};
