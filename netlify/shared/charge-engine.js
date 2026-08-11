// charge-engine.js — the shared machinery behind every mentee charge.
//
// Used by charge-week.js (the weekly run over Pending sessions) and
// retry-failed.js (a re-run over sessions that previously declined). Both move
// real money, so the logic lives in one place: two copies would eventually
// disagree about what counts as paid.
//
// The golden rule enforced here: a session is only ever marked "Charged" when
// Stripe actually confirms the payment. A decline stays "Failed" with the
// reason attached, because the P&L reads "Charged" as recognised revenue.

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// Billing types that mean "already paid up front, do not charge per session".
// Both spellings are accepted so the Airtable option can be renamed from
// "Package" to "Prepayment" without a window where prepaid mentees get billed
// twice. Every comparison goes through isPrepaid(), never a bare === "Package".
// "Prepayment" first: the Airtable option has been renamed, so writing
// "Package" now fails. The old spelling stays in the list so reads of any
// historic value still register as prepaid.
const PREPAID_TYPES = ["Prepayment", "Package"];
const isPrepaid = (billingType) => PREPAID_TYPES.includes(String(billingType || "").trim());

// Airtable formula fragment for "this mentee is prepaid".
const PREPAID_FORMULA = `OR(${PREPAID_TYPES.map((t) => `{Billing type}="${t}"`).join(",")})`;

const SESSION_FIELDS = ["Mentee Name", "Mentee Record ID", "Date", "Amount Due", "Failure Reason"];

/** Owner allowlist plus the billing passphrase. Returns an error string, or null. */
function authorise(payload) {
  const adminEmail = (payload.adminEmail || "").toLowerCase().trim();
  if (!OWNERS.includes(adminEmail)) return "Not authorised";
  if (!process.env.BILLING_PASSCODE || (payload.passcode || "") !== process.env.BILLING_PASSCODE) {
    return "Wrong passcode";
  }
  return null;
}

function airtableHeaders() {
  return {
    Authorization: `Bearer ${process.env.AIRTABLE_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

/** Every session row currently sitting at the given Payment Status. */
async function fetchByStatus(status) {
  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const records = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}` +
      `?filterByFormula=${encodeURIComponent(`{Payment Status}="${status}"`)}` +
      SESSION_FIELDS.map((f) => `&fields[]=${encodeURIComponent(f)}`).join("") +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: airtableHeaders() });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    records.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return records;
}

/** One combined charge per mentee, so nobody gets several card hits at once. */
function groupByMentee(records) {
  const byMentee = {};
  for (const s of records) {
    const recId = s.fields["Mentee Record ID"] || "";
    const name = s.fields["Mentee Name"] || "Unknown";
    const amount = parseFloat(s.fields["Amount Due"]) || 0;
    const key = recId || `name:${name}`;
    if (!byMentee[key]) byMentee[key] = { recordId: recId, name, sessionIds: [], total: 0, reason: "" };
    byMentee[key].sessionIds.push(s.id);
    byMentee[key].total += amount;
    // Keep the first decline reason: they are the same across a mentee's rows,
    // and it decides how the chase message explains the problem.
    if (!byMentee[key].reason && s.fields["Failure Reason"]) {
      byMentee[key].reason = s.fields["Failure Reason"];
    }
  }
  return Object.values(byMentee);
}

/** One mentee record from the Client table, or null. */
async function menteeRecord(recordId) {
  if (!recordId) return null;
  const { AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_CORE_BASE_ID}/${AIRTABLE_MENTEE_TABLE_ID}/${recordId}`,
      { headers: airtableHeaders() }
    );
    const data = await res.json();
    return data.fields ? data : null;
  } catch {
    return null;
  }
}

async function customerFor(recordId) {
  const rec = await menteeRecord(recordId);
  return rec?.fields?.["Stripe Customer ID"] || null;
}

// wa.me wants digits only, no plus. AU locals (04...) become 614....
function normalizePhone(raw, aussie) {
  if (!raw) return "";
  const s = String(raw).trim().replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) return s.replace(/^\+/, "");
  if (s.startsWith("00")) return s.slice(2);
  if (s.startsWith("0")) return "61" + s.slice(1);
  if (/^4\d{8}$/.test(s)) return "61" + s;
  if (aussie === "Aussie" && /^\d{8,9}$/.test(s)) return "61" + s.replace(/^0/, "");
  return s.replace(/\D/g, "");
}

/**
 * The card to charge: the most recently added one.
 *
 * Nothing in this codebase ever sets invoice_settings.default_payment_method.
 * The agreement flow creates a SetupIntent and the card link uses a Checkout
 * setup session, and neither writes a default. So the old code fell through to
 * paymentMethods.list()[0] and trusted Stripe's list ordering, which is not a
 * documented guarantee. When a mentee replaces a dead card, that is exactly the
 * case where guessing wrong means charging the card that already failed.
 *
 * Newest-first is chosen deliberately: Fidel only ever sends a card link when
 * the card on file has stopped working, so the newest card is always the one
 * the mentee intends to be charged.
 *
 * The winner is written back as the customer's default, so Stripe agrees with
 * us from then on and the next run does no extra work.
 */
// A card saved through Stripe Link is wrapped in a wallet. Link can refuse an
// off-session charge and demand the customer verify at link.com, which is not
// something a weekly batch run can do anything about. A directly entered card
// has no such gate, so those are always preferred. Link is used only when it is
// the only thing on file, where a Link charge that might work still beats a
// guaranteed "no card".
const isLinkBacked = (pm) => pm?.card?.wallet?.type === "link";

async function activeCard(stripe, customerId) {
  const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
  if (!methods.data.length) return null;

  const byNewest = (a, b) => (b.created || 0) - (a.created || 0);
  const plain = methods.data.filter((pm) => !isLinkBacked(pm)).sort(byNewest);
  const newest = (plain.length ? plain : methods.data.slice().sort(byNewest))[0];

  const customer = await stripe.customers.retrieve(customerId);
  if (customer?.invoice_settings?.default_payment_method !== newest.id) {
    // Best effort. A failure here must not stop the charge going through.
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: newest.id },
    }).catch(() => {});
  }
  return newest.id;
}

/** Card details for display: brand, last 4, expiry, when it was added. */
async function cardSummary(stripe, customerId) {
  if (!customerId) return null;
  try {
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 100 });
    if (!methods.data.length) return null;
    // Mirror activeCard's choice exactly, so the portal shows the card that
    // will actually be charged rather than merely the newest one.
    const byNewest = (a, b) => (b.created || 0) - (a.created || 0);
    const plain = methods.data.filter((pm) => !isLinkBacked(pm)).sort(byNewest);
    const sorted = plain.length ? plain : methods.data.slice().sort(byNewest);
    const c = sorted[0];
    return {
      brand: c.card?.brand || "card",
      // Link cards can block an off-session charge, so this has to be visible
      // before a run rather than discovered in the failure reason afterwards.
      viaLink: isLinkBacked(c),
      last4: c.card?.last4 || "",
      expMonth: c.card?.exp_month || null,
      expYear: c.card?.exp_year || null,
      country: c.card?.country || "",
      addedAt: c.created ? new Date(c.created * 1000).toISOString().slice(0, 10) : "",
      // More than one means older cards are still attached. Harmless, but worth
      // showing so a replaced card is visibly a replacement.
      total: sorted.length,
    };
  } catch {
    return null;
  }
}

/**
 * Charge each group once. `label` appears on the Stripe description so a retry
 * is distinguishable from the original weekly run in the Stripe dashboard.
 */
async function chargeGroups(groups, stripe, label = "weekly") {
  const results = [];

  for (const m of groups) {
    const amountCents = Math.round(m.total * 100);

    // Nothing to charge (e.g. all zero-priced): settle without hitting Stripe.
    if (amountCents <= 0) {
      results.push({ ...m, status: "Charged", reason: "", paymentIntentId: "" });
      continue;
    }

    const customerId = await customerFor(m.recordId);
    if (!customerId) {
      results.push({ ...m, status: "Failed", reason: "No Stripe customer on file", paymentIntentId: "" });
      continue;
    }

    let paymentMethodId = null;
    try {
      paymentMethodId = await activeCard(stripe, customerId);
    } catch {
      results.push({ ...m, status: "Failed", reason: "Stripe customer not found", paymentIntentId: "" });
      continue;
    }

    if (!paymentMethodId) {
      results.push({ ...m, status: "Failed", reason: "No saved card on file", paymentIntentId: "" });
      continue;
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: "aud",
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Headstart ${label} — ${m.name} — ${m.sessionIds.length} session(s)`,
      });
      results.push({ ...m, status: "Charged", reason: "", paymentIntentId: pi.id });
    } catch (err) {
      results.push({ ...m, status: "Failed", reason: err.message || "Charge declined", paymentIntentId: "" });
    }
  }

  return results;
}

/** Write each outcome back onto its session rows, 10 at a time (Airtable cap). */
async function writeResults(results) {
  const { AIRTABLE_BASE_ID, AIRTABLE_SESSION_TABLE_ID } = process.env;
  const updates = [];
  for (const r of results) {
    for (const id of r.sessionIds) {
      updates.push({
        id,
        fields: {
          "Payment Status": r.status,
          "Failure Reason": r.reason || "",
          "Amount Charged": r.status === "Charged" ? (r.total / r.sessionIds.length) : 0,
          "Stripe Payment ID": r.paymentIntentId || "",
        },
      });
    }
  }
  for (let i = 0; i < updates.length; i += 10) {
    await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_SESSION_TABLE_ID}`,
      { method: "PATCH", headers: airtableHeaders(), body: JSON.stringify({ records: updates.slice(i, i + 10) }) }
    );
  }
}

const summarise = (results) => {
  const charged = results.filter((r) => r.status === "Charged");
  const failed = results.filter((r) => r.status === "Failed");
  return {
    charged, failed,
    chargedTotal: charged.reduce((s, r) => s + r.total, 0),
    failedTotal: failed.reduce((s, r) => s + r.total, 0),
  };
};

module.exports = {
  OWNERS, authorise, airtableHeaders, menteeRecord, normalizePhone,
  PREPAID_TYPES, isPrepaid, PREPAID_FORMULA,
  fetchByStatus, groupByMentee, chargeGroups, writeResults, summarise,
  activeCard, cardSummary,
};
