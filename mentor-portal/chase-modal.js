// chase-modal.js — the popup for chasing a mentee whose card declined.
// Shows the ready-to-send message, a one-tap copy, and a WhatsApp button.
// The message text itself comes from the server (shared/chase-message.js) so
// the popup and the next-day reminder email always say the same thing.

let failed = [];

export function setFailed(list) { failed = list || []; }

// Some declines can never be retried: Nikhil's Indian-issued card needs a
// mandate Stripe cannot create off-session, so the money can only ever arrive
// another way. This records that it did, without touching a card.
export function configurePaid({ api, adminEmail, onDone }) { paidDeps = { api, adminEmail, onDone }; }
let paidDeps = { api: null, adminEmail: "", onDone: null };

window.markPaid = async function (index, btn) {
  const m = failed[index];
  if (!m || !paidDeps.api) return;
  const ids = m.sessionIds || [];
  if (!ids.length) { window.alert("No session rows found for this mentee. Reload and try again."); return; }

  // Charging by hand in the Stripe dashboard is the usual reason a row gets
  // settled outside the weekly run, so it is the default. The choice is not
  // cosmetic: it decides whether the P&L deducts Stripe's fee.
  const method = window.prompt(
    `How was ${m.name}'s $${m.total.toFixed(2)} paid?\n\n` +
    `1 = Stripe (charged by hand)\n2 = Bank transfer\n3 = Cash\n4 = Other`,
    "1"
  );
  if (method === null) return;
  const chosen = { 1: "Stripe (charged by hand)", 2: "Bank transfer", 3: "Cash", 4: "Other" }[method.trim()];
  if (!chosen) { window.alert("Type 1, 2, 3 or 4."); return; }

  // Optional: pasting the real Stripe id makes the row traceable back to the
  // dashboard. Skipping it still records the fee, just without the link.
  let stripeId = "";
  if (chosen === "Stripe (charged by hand)") {
    stripeId = window.prompt("Stripe payment ID (optional, starts pi_). Leave blank to skip.", "") || "";
  }

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Recording…";
  try {
    // The server totals the rows from Airtable, so the figure confirmed is
    // Airtable's rather than whatever this page happens to be showing.
    const p = await paidDeps.api("record-payment", {
      recordIds: ids, method: chosen, stripeId, adminEmail: paidDeps.adminEmail, preview: true,
    });
    const feeLine = p.viaStripe
      ? `\n\nStripe's fee of $${p.fee.toFixed(2)} will be counted as a cost.`
      : `\n\nNo Stripe fee will be counted, since the money did not go through Stripe.`;
    if (!window.confirm(
      `Mark ${m.name} as charged, $${p.total.toFixed(2)} via ${chosen}?\n\n` +
      `${p.count} session(s) will be marked Charged in Airtable.${feeLine}`
    )) {
      btn.disabled = false; btn.textContent = original; return;
    }
    await paidDeps.api("record-payment", { recordIds: ids, method: chosen, stripeId, adminEmail: paidDeps.adminEmail });
    if (paidDeps.onDone) paidDeps.onDone();
  } catch (e) {
    btn.disabled = false; btn.textContent = original;
    window.alert(e.message || "Could not record — try again.");
  }
};

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function close() {
  const el = document.getElementById("chase-modal");
  if (el) el.hidden = true;
}

// Opened from the Chase button on each failed row.
window.openChase = function (index) {
  const m = failed[index];
  if (!m) return;
  const box = document.getElementById("chase-modal");
  const body = document.getElementById("chase-modal-body");
  if (!box || !body) return;

  const wa = m.phone
    ? `<a class="btn" href="https://wa.me/${m.phone}?text=${encodeURIComponent(m.message)}" target="_blank" rel="noopener">Open WhatsApp</a>`
    : `<span class="chase-nophone">No phone number on file</span>`;

  body.innerHTML = `
    <h3 class="chase-title">Chase ${esc(m.name)}</h3>
    <p class="chase-meta">$${m.total.toFixed(2)} declined${m.reason ? ` &middot; ${esc(m.reason)}` : ""}</p>
    <pre class="chase-text" id="chase-text">${esc(m.message)}</pre>
    <div class="chase-actions">
      <button type="button" class="btn ghost" id="chase-copy">Copy message</button>
      ${wa}
    </div>
    <p class="chase-note">WhatsApp opens with the message already filled in. Retry the charge once they confirm they've topped up.</p>`;

  box.hidden = false;
  document.getElementById("chase-copy").onclick = async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(m.message);
    } catch {
      // Insecure context or blocked clipboard: select the text so it can be
      // copied by hand rather than failing silently.
      const range = document.createRange();
      range.selectNodeContents(document.getElementById("chase-text"));
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = "Copy message"; }, 2000);
  };
};

document.addEventListener("click", (e) => {
  if (e.target.id === "chase-modal" || e.target.id === "chase-close") close();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
