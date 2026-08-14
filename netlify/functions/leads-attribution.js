// leads-attribution.js
// Owner-only feed for the portal's Leads page. Joins two sources:
//   GA4      - where traffic comes from and what it does on the site
//   Airtable - what happened after the call (consulted, signed, close rate)
//
// GA4 auth is a hand-rolled service-account JWT so this function needs no npm
// dependencies. Node's crypto does the RS256 signing.

const crypto = require("crypto");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

// Fidel only. The nav hides this page from Koko; this is the matching
// server-side check so hiding the link is not the only thing protecting it.
const OWNERS = ["fidelhon@gmail.com"];

const CONVERSION_EVENTS = ["generate_lead", "discovery_form_submit", "invitee_meeting_scheduled"];

/* ---------------------------------------------------------------- GA4 --- */

function b64url(input) {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function ga4Token(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/analytics.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  // Netlify stores the key with literal \n, turn those back into newlines.
  const sig = b64url(signer.sign(privateKey.replace(/\\n/g, "\n")));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("GA4 auth failed: " + (json.error_description || json.error || "unknown"));
  return json.access_token;
}

async function runReport(token, propertyId, body) {
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const json = await res.json();
  if (json.error) throw new Error("GA4: " + json.error.message);
  return (json.rows || []).map((r) => ({
    dims: (r.dimensionValues || []).map((d) => d.value),
    mets: (r.metricValues || []).map((m) => Number(m.value) || 0),
  }));
}

const dateRange = (days) => [{ startDate: `${days}daysAgo`, endDate: "today" }];

const eventFilter = (names) => ({
  filter: { fieldName: "eventName", inListFilter: { values: names } },
});

/* ----------------------------------------------------------- Airtable --- */

async function fetchAll(baseId, tableId, token) {
  const records = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?pageSize=100` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (data.error) throw new Error("Airtable: " + (data.error.message || data.error));
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

// Collapse the free-text Lead Source field into stable buckets.
function bucketSource(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "Unattributed";
  if (s.includes("linkedin")) return "LinkedIn";
  if (s.includes("insta") || s === "ig") return "Instagram";
  if (s.includes("refer") || s.includes("friend") || s.includes("recommend")) return "Referral";
  if (s.includes("google") || s.includes("seo") || s.includes("search")) return "Search";
  if (s.includes("career fair") || s.includes("event") || s.includes("society")) return "Events";
  if (s.includes("outreach") || s.includes("direct")) return "Outreach";
  return "Other";
}

const truthy = (v) => v === 1 || v === true || v === "Yes" || v === "yes";

/* ------------------------------------------------------------ handler --- */

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) }; }

  const ownerEmail = (payload.ownerEmail || "").toLowerCase().trim();
  if (!OWNERS.includes(ownerEmail)) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: "Owners only" }) };
  }

  const days = Math.min(Math.max(parseInt(payload.days, 10) || 28, 1), 365);

  const {
    GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY,
    AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
  } = process.env;

  const out = { days, generatedAt: new Date().toISOString(), errors: [] };

  /* ---- GA4 side ---- */
  try {
    if (!GA4_PROPERTY_ID || !GA4_CLIENT_EMAIL || !GA4_PRIVATE_KEY) {
      throw new Error("GA4 environment variables are not set in Netlify");
    }
    const token = await ga4Token(GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY);
    const P = GA4_PROPERTY_ID;

    const [visitors, conversions, campaigns, weekly] = await Promise.all([
      // People arriving, by original source
      runReport(token, P, {
        dateRanges: dateRange(days),
        dimensions: [{ name: "customEvent:first_source" }, { name: "customEvent:first_medium" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 100,
      }),
      // Conversions, by source and by which of the three things they signed up for
      runReport(token, P, {
        dateRanges: dateRange(days),
        dimensions: [
          { name: "customEvent:first_source" },
          { name: "eventName" },
          { name: "customEvent:signup_type" },
        ],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(CONVERSION_EVENTS),
        limit: 400,
      }),
      // Per-post performance
      runReport(token, P, {
        dateRanges: dateRange(days),
        dimensions: [{ name: "customEvent:first_campaign" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view", ...CONVERSION_EVENTS]),
        limit: 400,
      }),
      // Weekly trend by source
      runReport(token, P, {
        dateRanges: dateRange(days),
        dimensions: [{ name: "week" }, { name: "customEvent:first_source" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: eventFilter(["page_view"]),
        limit: 500,
      }),
    ]);

    const channels = {};
    const chan = (k) => (channels[k] = channels[k] || {
      source: k, medium: "", visitors: 0,
      signups: { job_alerts: 0, audit_roadmap: 0, discovery_call: 0 },
      callForms: 0, booked: 0,
    });

    visitors.forEach(({ dims, mets }) => {
      const c = chan(dims[0] || "(unknown)");
      c.visitors += mets[0];
      if (!c.medium) c.medium = dims[1] || "";
    });

    conversions.forEach(({ dims, mets }) => {
      const [src, evName, signupType] = dims;
      const c = chan(src || "(unknown)");
      if (evName === "discovery_form_submit") c.callForms += mets[0];
      if (evName === "invitee_meeting_scheduled") c.booked += mets[0];
      if (Object.prototype.hasOwnProperty.call(c.signups, signupType)) {
        c.signups[signupType] += mets[0];
      }
    });

    out.channels = Object.values(channels)
      .filter((c) => c.visitors || c.booked || c.callForms)
      .sort((a, b) => b.visitors - a.visitors);

    const camp = {};
    campaigns.forEach(({ dims, mets }) => {
      const [name, evName] = dims;
      if (!name || name === "none" || name === "(not set)") return;
      const c = (camp[name] = camp[name] || { campaign: name, visitors: 0, conversions: 0 });
      if (evName === "page_view") c.visitors += mets[0];
      else c.conversions += mets[0];
    });
    out.campaigns = Object.values(camp).sort((a, b) => b.visitors - a.visitors).slice(0, 25);

    const wk = {};
    weekly.forEach(({ dims, mets }) => {
      const [week, src] = dims;
      wk[week] = wk[week] || { week, sources: {} };
      wk[week].sources[src || "(unknown)"] = mets[0];
    });
    out.weekly = Object.values(wk).sort((a, b) => a.week.localeCompare(b.week));
  } catch (err) {
    out.errors.push("GA4: " + err.message);
    out.channels = [];
    out.campaigns = [];
    out.weekly = [];
  }

  /* ---- Airtable side: what happened after the call ---- */
  try {
    const recs = await fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID, AIRTABLE_API_TOKEN);
    const since = new Date(Date.now() - days * 86400000);

    const bySource = {};
    let totals = { leads: 0, consulted: 0, signed: 0 };

    recs.forEach((r) => {
      const f = r.fields || {};
      // Date the call happened; fall back to record creation for pure leads.
      const when = new Date(f["Meeting Time"] || f["Created"] || 0);
      if (!when || isNaN(when) || when < since) return;

      const key = bucketSource(f["Lead Source"]);
      const b = (bySource[key] = bySource[key] || { source: key, leads: 0, consulted: 0, signed: 0 });

      b.leads++; totals.leads++;
      if (truthy(f["Did Consultation?"]) || f["Showed Up Rate"] === 1) { b.consulted++; totals.consulted++; }
      if (truthy(f["Signed"])) { b.signed++; totals.signed++; }
    });

    out.sales = {
      totals: {
        ...totals,
        showUpRate: totals.leads ? totals.consulted / totals.leads : null,
        closeRate: totals.consulted ? totals.signed / totals.consulted : null,
      },
      bySource: Object.values(bySource)
        .map((b) => ({ ...b, closeRate: b.consulted ? b.signed / b.consulted : null }))
        .sort((a, b) => b.signed - a.signed || b.leads - a.leads),
    };
  } catch (err) {
    out.errors.push("Airtable: " + err.message);
    out.sales = { totals: {}, bySource: [] };
  }

  return { statusCode: 200, headers, body: JSON.stringify(out) };
};
