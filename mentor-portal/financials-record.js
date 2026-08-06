// financials-record.js — recording money that arrived outside Stripe.
//
// Split from financials.js to keep that file readable. The rule this screen
// exists to protect: a session is only ever "Charged" against a real payment,
// so recording one is a deliberate act with a confirm step, not a checkbox
// someone brushes past.

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const fmtDate = (d) => d
  ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
  : "—";

let deps = { api: null, adminEmail: "", onDone: null };
let CURRENT = null;

export function configureRecord({ api, adminEmail, onDone }) {
  deps = { api, adminEmail, onDone };
}

/** Draws the outstanding rows for a mentee, or hides the block when none. */
export function renderRecord(d) {
  CURRENT = d;
  const block = document.getElementById("rec-block");
  const list = document.getElementById("rec-list");
  const out = document.getElementById("rec-out");
  if (!block) return;
  out.textContent = "";

  // Default the prepayment date to today, so the common case needs no typing.
  const dateEl = document.getElementById("pre-date");
  if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

  const rows = d.outstandingRows || [];
  if (!rows.length) { block.hidden = true; return; }
  block.hidden = false;

  // Everything owed is ticked by default, since paying the lot is the common
  // case. Untick for a partial payment.
  list.innerHTML = rows.map((r) => `
    <label class="fin-rec__row">
      <input type="checkbox" class="rec-tick" value="${r.id}" data-due="${r.due}" checked />
      <span class="fin-rec__date">${fmtDate(r.date)}</span>
      <span class="fin-rec__status${r.status === "Failed" ? " fin-bad" : ""}">${r.status}</span>
      <span class="fin-rec__due">${money(r.due)}</span>
    </label>`).join("");

  updateTotal();
}

function ticked() {
  return [...document.querySelectorAll(".rec-tick:checked")];
}

function updateTotal() {
  const btn = document.getElementById("rec-save");
  const rows = ticked();
  const total = rows.reduce((a, el) => a + (parseFloat(el.dataset.due) || 0), 0);
  btn.textContent = rows.length ? `Record ${money(total)} received` : "Record payment";
  btn.disabled = !rows.length;
}

const STRIPE_METHOD = "Stripe (charged by hand)";

document.addEventListener("change", (e) => {
  if (e.target.classList?.contains("rec-tick")) updateTotal();
  // The Stripe id field only means anything for a Stripe charge.
  const wraps = { "rec-method": "rec-stripe-wrap", "pre-method": "pre-stripe-wrap" };
  if (wraps[e.target.id]) {
    const wrap = document.getElementById(wraps[e.target.id]);
    if (wrap) wrap.hidden = e.target.value !== STRIPE_METHOD;
  }
});

// ── Recording a prepayment taken outside the weekly run ──
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#pre-save");
  if (!btn || !CURRENT) {
    if (btn) window.alert("Search for a mentee first.");
    return;
  }
  const out = document.getElementById("pre-out");
  const amount = document.getElementById("pre-amount").value;
  const sessions = document.getElementById("pre-sessions").value;
  const method = document.getElementById("pre-method").value;
  const body = {
    kind: "prepay",
    recordId: CURRENT.id,
    amount, sessions, method,
    date: document.getElementById("pre-date").value,
    stripeId: document.getElementById("pre-stripe").value,
    note: document.getElementById("pre-note").value,
    adminEmail: deps.adminEmail,
  };

  btn.disabled = true;
  out.textContent = "Checking…";
  try {
    const p = await deps.api("record-payment", { ...body, preview: true });
    const feeLine = p.viaStripe
      ? `\n\nStripe's fee of ${money(p.fee)} will be counted as a cost.`
      : `\n\nNo Stripe fee will be counted, since the money did not go through Stripe.`;
    if (!confirm(
      `Record a ${money(p.amount)} prepayment for ${p.name}?\n\n` +
      `${p.sessions} sessions at ${money(p.each)} each.\n` +
      `They will be switched to prepaid, so the weekly run stops charging them per session.${feeLine}`
    )) {
      out.textContent = ""; btn.disabled = false; return;
    }
    const done = await deps.api("record-payment", body);
    out.innerHTML = `<span class="fin-ok">Recorded ${money(done.amount)} for ${done.sessions} sessions.` +
      (done.billingType ? ` Billing type set to ${done.billingType}.` : " Set their billing type by hand, it could not be updated.") +
      `</span>`;
    if (deps.onDone) deps.onDone();
  } catch (err) {
    out.innerHTML = `<span class="fin-bad">${String(err.message || "Could not record")}</span>`;
  }
  btn.disabled = false;
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#rec-save");
  if (!btn || !CURRENT) return;
  const out = document.getElementById("rec-out");
  const recordIds = ticked().map((el) => el.value);
  if (!recordIds.length) return;

  const method = document.getElementById("rec-method").value;
  const note = document.getElementById("rec-note").value;
  const stripeId = document.getElementById("rec-stripe").value;
  btn.disabled = true;
  out.textContent = "Checking…";

  try {
    // The server re-reads the rows and totals them from Airtable, so the figure
    // confirmed here is Airtable's, not this page's.
    const p = await deps.api("record-payment", {
      recordIds, method, note, stripeId, adminEmail: deps.adminEmail, preview: true,
    });
    const skipNote = p.skipped ? `\n\n${p.skipped} already marked charged and will be left alone.` : "";
    // The fee consequence is stated up front, because picking the wrong method
    // is the one mistake here that quietly corrupts the P&L.
    const feeLine = p.viaStripe
      ? `\n\nStripe's fee of ${money(p.fee)} will be counted as a cost.`
      : `\n\nNo Stripe fee will be counted, since the money did not go through Stripe.`;
    if (!confirm(
      `Mark ${CURRENT.name} as charged, ${money(p.total)} via ${method}?\n\n` +
      `${p.count} session(s) will be marked Charged in Airtable.${feeLine}${skipNote}`
    )) {
      out.textContent = ""; updateTotal(); return;
    }
    const done = await deps.api("record-payment", { recordIds, method, note, stripeId, adminEmail: deps.adminEmail });
    out.innerHTML = `<span class="fin-ok">Recorded ${money(done.total)} across ${done.recorded} session(s).</span>`;
    document.getElementById("rec-note").value = "";
    if (deps.onDone) deps.onDone();
  } catch (err) {
    out.innerHTML = `<span class="fin-bad">${String(err.message || "Could not record")}</span>`;
    updateTotal();
  }
});
