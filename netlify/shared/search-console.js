// search-console.js — what people searched to find Headstart, and where the
// site ranked when they did.
//
// GA4 says 493 people arrived from search. It cannot say what any of them
// typed. This is the other half, and it is the only source for impressions,
// which is the closest thing to reach that search has.
//
// Reuses the GA4 service account: same key, different scope. The account just
// needs adding as a user on the Search Console property.

const crypto = require("crypto");
const { normalizePrivateKey } = require("./ga4");

const SITE = "sc-domain:theheadstartmentoring.com";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

// Search Console data lags roughly two days. Asking for yesterday returns an
// empty row and makes a working site look dead.
const LAG_DAYS = 2;

const b64url = (input) => Buffer.from(input).toString("base64")
  .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function gscToken(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: clientEmail, scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600, iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(normalizePrivateKey(privateKey)));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || "Search Console auth failed");
  return data.access_token;
}

/** YYYY-MM-DD, n days back from today. */
const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function query(token, body) {
  const res = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`,
    { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "Search Console query failed");
  return data.rows || [];
}

/**
 * Everything the dashboards need, for a window that ends where Search Console's
 * data actually ends rather than today.
 *
 * @param {number} windowDays  length of the window
 * @param {number} offsetDays  how far back the window sits, for "vs previous"
 */
async function searchStats(env, windowDays, offsetDays = 0) {
  const clientEmail = env.GA4_CLIENT_EMAIL;
  const privateKey = env.GA4_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;

  try {
    const token = await gscToken(clientEmail, privateKey);
    const endDate = day(LAG_DAYS + offsetDays);
    const startDate = day(LAG_DAYS + offsetDays + windowDays);

    const [totals, queries, pages] = await Promise.all([
      query(token, { startDate, endDate }),
      query(token, { startDate, endDate, dimensions: ["query"], rowLimit: 25 }),
      query(token, { startDate, endDate, dimensions: ["page"], rowLimit: 25 }),
    ]);

    const t = totals[0] || {};
    const clean = (rows, key) => rows.map((r) => ({
      key: key === "page" ? r.keys[0].replace("https://theheadstartmentoring.com", "") || "/" : r.keys[0],
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0,
    }));

    return {
      from: startDate, to: endDate,
      clicks: t.clicks || 0,
      impressions: t.impressions || 0,
      ctr: t.ctr || 0,
      position: t.position || 0,
      queries: clean(queries, "query"),
      pages: clean(pages, "page"),
    };
  } catch (e) {
    return null;
  }
}

module.exports = { searchStats, gscToken, query, SITE, LAG_DAYS };
