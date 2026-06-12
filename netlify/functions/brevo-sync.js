// Fires every time a new submission lands in the job-alerts-signup Netlify form.
// Pushes the contact + their preferences into Brevo so the list stays in sync
// without manual CSV exports.
//
// Wiring:
//   Netlify dashboard -> Site -> Forms -> Notifications -> Add outgoing webhook
//   URL: https://<your-site>.netlify.app/.netlify/functions/brevo-sync
//   Event: New form submission
//   Form: job-alerts-signup
//
// Required environment variables (Netlify -> Site -> Environment variables):
//   BREVO_API_KEY        Brevo -> Settings -> SMTP & API -> API Keys (v3 key)
//   BREVO_LIST_ID        Numeric ID of the "Job Alerts Subscribers" list
//                        (open the list in Brevo, the URL ends with /list/<id>)

const headers = { "Content-Type": "application/json" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  const listId = parseInt(process.env.BREVO_LIST_ID, 10);
  if (!apiKey || !listId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Missing BREVO_API_KEY or BREVO_LIST_ID env var" }) };
  }

  let netlifyPayload;
  try {
    netlifyPayload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON body" }) };
  }

  // Netlify webhook shape is the form-data fields directly on the body for
  // outgoing webhooks; if wrapped in `payload.data`, support that too.
  const data = netlifyPayload.payload?.data || netlifyPayload.data || netlifyPayload;
  const email = (data.email || "").trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "No email in submission" }) };
  }

  const body = {
    email,
    listIds: [listId],
    updateEnabled: true, // upsert: create on first signup, update on re-signup
    attributes: {
      // Take the first word of the submitted name as the first name; avoids
      // emails greeting people by their full multi-word name.
      FIRSTNAME: (data.name || "").trim().split(/\s+/)[0] || "",
      INDUSTRY: (data.industries || "").trim(), // singular attribute name in Brevo; value can be comma-separated
    },
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("Brevo error", res.status, text);
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Brevo rejected", status: res.status, detail: text }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, email }) };
  } catch (err) {
    console.error("Brevo sync failed", err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "Unknown error" }) };
  }
};
