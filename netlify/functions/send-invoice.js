// send-invoice.js — owner-only. Emails a mentee an itemised invoice for the
// sessions they have already paid for, via Brevo. Sent on request, usually
// when a mentee needs it for reimbursement or their own records.
//
//   { adminEmail, recordId, preview: true }  → the invoice data, sends nothing
//   { adminEmail, recordId }                 → sends it to the mentee
//
// Read-only against money: this never charges anything.

const { OWNERS, airtableHeaders, menteeRecord } = require("../shared/charge-engine");

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const money = (n) => (Number(n) || 0).toFixed(2);
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtDate = (d) => d
  ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
  : "";

// A stable, human-readable invoice number: mentee record + today.
const invoiceNo = (recordId) =>
  `HS-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(recordId).slice(-4).toUpperCase()}`;

async function paidRows(recordId, name) {
  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const fields = ["Date", "Mentee Name", "Mentee Record ID", "Amount Charged", "Payment Status", "Package Sessions"];
  const out = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` + (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: airtableHeaders() });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);

  const key = String(name || "").trim().toLowerCase();
  return out
    .filter((r) => {
      const f = r.fields;
      const isMine = (f["Mentee Record ID"] && f["Mentee Record ID"] === recordId) ||
        String(f["Mentee Name"] || "").trim().toLowerCase() === key;
      // Only money the mentee actually paid belongs on an invoice.
      return isMine && (parseFloat(f["Amount Charged"]) || 0) > 0;
    })
    .sort((a, b) => String(a.fields["Date"] || "").localeCompare(String(b.fields["Date"] || "")))
    .map((r) => {
      const f = r.fields;
      const pkg = f["Payment Status"] === "Package";
      return {
        date: String(f["Date"] || "").slice(0, 10),
        amount: parseFloat(f["Amount Charged"]) || 0,
        label: pkg
          ? `Prepaid package${f["Package Sessions"] ? ` (${f["Package Sessions"]} sessions)` : ""}`
          : "Mentoring session",
      };
    });
}

function buildHtml({ name, no, lines, total }) {
  const rows = lines.map((l) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">${fmtDate(l.date)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;">${esc(l.label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f0f0f0;text-align:right;">$${money(l.amount)}</td>
    </tr>`).join("");

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;background:#f9f9f9;">
  <div style="max-width:620px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.07);">
    <div style="background:#000;padding:28px 32px;">
      <p style="margin:0;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#c79b3b;font-weight:700;">The Headstart</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">Invoice ${no}</p>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 6px;font-size:14px;color:#555;">Hi ${esc(name)},</p>
      <p style="margin:0 0 22px;font-size:14px;color:#555;">Here's your invoice for the mentoring sessions you've paid for. Everything below has already been settled, so there's nothing to pay.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="background:#f5f5f5;">
          <th style="padding:10px 12px;text-align:left;">Date</th>
          <th style="padding:10px 12px;text-align:left;">Item</th>
          <th style="padding:10px 12px;text-align:right;">Amount</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="2" style="padding:14px 12px;font-weight:700;">Total paid</td>
          <td style="padding:14px 12px;text-align:right;font-weight:700;">$${money(total)} AUD</td>
        </tr></tfoot>
      </table>
      <p style="margin:22px 0 0;font-size:13px;color:#777;">Any questions about this invoice, just reply to this email.</p>
    </div>
    <div style="background:#f5f5f5;padding:16px 32px;"><p style="margin:0;font-size:12px;color:#aaa;">The Headstart Mentoring</p></div>
  </div>
</body></html>`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  if (!OWNERS.includes((payload.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }

  try {
    const rec = await menteeRecord(payload.recordId);
    if (!rec) return json(404, { error: "Mentee not found" });
    const name = rec.fields["Name"] || "there";
    const to = payload.email || rec.fields["Gmail"] || "";

    const lines = await paidRows(payload.recordId, name);
    if (!lines.length) return json(400, { error: `${name} has no paid sessions yet, so there is nothing to invoice.` });

    const total = lines.reduce((s, l) => s + l.amount, 0);
    const no = invoiceNo(payload.recordId);

    if (payload.preview) {
      return json(200, { preview: true, name, to, no, lines, total: parseFloat(total.toFixed(2)) });
    }
    if (!to) return json(400, { error: `No email on file for ${name}.` });
    if (!process.env.BREVO_API_KEY) return json(500, { error: "Email is not configured." });

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: SENDER,
        to: [{ email: to, name }],
        subject: `Your Headstart invoice ${no}`,
        htmlContent: buildHtml({ name, no, lines, total }),
      }),
    });
    if (!res.ok) return json(502, { error: "Brevo rejected the email. Nothing was sent." });

    return json(200, { sent: true, to, no, total: parseFloat(total.toFixed(2)), lines: lines.length });
  } catch (err) {
    return json(502, { error: err.message || "Could not build the invoice" });
  }
};
