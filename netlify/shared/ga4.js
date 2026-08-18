// ga4.js — service-account auth and reporting for the GA4 Data API.
//
// Hand-rolled RS256 JWT rather than the Google client library, so a Netlify
// function needs no npm install. Lifted out of leads-attribution.js when the
// customer-journey page needed the same three helpers; one copy, not two.

const crypto = require("crypto");

function b64url(input) {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Rebuild a usable PEM from however the key survived being pasted.
 *
 * Environment variable UIs mangle multi-line secrets in several ways: escaping
 * newlines as \n, replacing them with spaces, or stripping them entirely. All
 * three produce "DECODER routines::unsupported" from OpenSSL. Since the body
 * is just base64, throw away all whitespace and re-wrap it at 64 characters.
 */
function normalizePrivateKey(raw) {
  let key = String(raw || "").trim();
  if (!key) throw new Error("GA4_PRIVATE_KEY is empty");

  // A pasted JSON value can arrive still wrapped in quotes.
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, "\n");

  const match = key.match(/-----BEGIN ([A-Z ]+?)-----([\s\S]*?)-----END \1-----/);

  let label, body;
  if (match) {
    label = match[1];
    body = match[2].replace(/\s+/g, "");
  } else {
    // No header lines. Copying a service-account key out of the JSON without
    // the BEGIN/END lines is an easy miss, and the body alone is still a
    // perfectly good PKCS#8 key, so rebuild the envelope around it.
    const stripped = key.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]+$/.test(stripped) || stripped.length < 600) {
      throw new Error(
        "GA4_PRIVATE_KEY does not look like a private key. Paste the whole " +
        "private_key value from the service account JSON. " +
        `Received ${key.length} characters.`
      );
    }
    label = "PRIVATE KEY";
    body = stripped;
  }
  if (!body) throw new Error("GA4_PRIVATE_KEY has no key body");

  return `-----BEGIN ${label}-----\n${(body.match(/.{1,64}/g) || []).join("\n")}\n-----END ${label}-----\n`;
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
  const sig = b64url(signer.sign(normalizePrivateKey(privateKey)));

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

const dateRange = (days, offset = 0) => [{
  startDate: `${days + offset}daysAgo`,
  endDate: offset ? `${offset}daysAgo` : "today",
}];

const eventFilter = (names) => ({
  filter: { fieldName: "eventName", inListFilter: { values: names } },
});

module.exports = { ga4Token, runReport, dateRange, eventFilter, normalizePrivateKey };
