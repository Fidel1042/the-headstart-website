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

document.addEventListener("change", (e) => {
  if (e.target.classList?.contains("rec-tick")) updateTotal();
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("#rec-save");
  if (!btn || !CURRENT) return;
  const out = document.getElementById("rec-out");
  const recordIds = ticked().map((el) => el.value);
  if (!recordIds.length) return;

  const method = document.getElementById("rec-method").value;
  const note = document.getElementById("rec-note").value;
  btn.disabled = true;
  out.textContent = "Checking…";

  try {
    // The server re-reads the rows and totals them from Airtable, so the figure
    // confirmed here is Airtable's, not this page's.
    const p = await deps.api("record-payment", {
      recordIds, method, note, adminEmail: deps.adminEmail, preview: true,
    });
    const skipNote = p.skipped ? `\n\n${p.skipped} already marked charged and will be left alone.` : "";
    if (!confirm(
      `Record ${money(p.total)} received from ${CURRENT.name} by ${method}?\n\n` +
      `${p.count} session(s) will be marked as charged. No card is touched.${skipNote}`
    )) {
      out.textContent = ""; updateTotal(); return;
    }
    const done = await deps.api("record-payment", { recordIds, method, note, adminEmail: deps.adminEmail });
    out.innerHTML = `<span class="fin-ok">Recorded ${money(done.total)} across ${done.recorded} session(s).</span>`;
    document.getElementById("rec-note").value = "";
    if (deps.onDone) deps.onDone();
  } catch (err) {
    out.innerHTML = `<span class="fin-bad">${String(err.message || "Could not record")}</span>`;
    updateTotal();
  }
});
