// financials-charge.js — the confirm step in front of every manual charge.
//
// It shows the exact figure the SERVER worked out (never one this page
// calculated), requires the billing passcode, and sends that same figure back
// as `expectedAmount`. charge-custom.js recomputes it and refuses if the two
// disagree, so a stale screen can never charge yesterday's number.

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function close() {
  const el = document.getElementById("confirm-modal");
  if (el) el.hidden = true;
}

export function openConfirm({ quote, body, adminEmail, onDone }) {
  const box = document.getElementById("confirm-modal");
  const panel = document.getElementById("confirm-body");
  if (!box || !panel) return;

  panel.innerHTML = `
    <h3 class="chase-title">Confirm charge</h3>
    <p class="confirm-amount">${money(quote.amount)}</p>
    <p class="confirm-line">to <strong>${esc(quote.name)}</strong></p>
    <p class="confirm-line confirm-line--muted">${esc(quote.summary)}</p>
    <p class="confirm-note">This figure came from Airtable, not from the form. It is checked again before the card is charged.</p>
    <input type="password" class="passcode-input" id="confirm-pass" placeholder="Billing passcode" autocomplete="off" />
    <div class="chase-actions">
      <button type="button" class="btn" id="confirm-go">Charge ${money(quote.amount)}</button>
      <button type="button" class="btn ghost" id="confirm-cancel">Cancel</button>
    </div>
    <p class="result" id="confirm-out"></p>`;

  box.hidden = false;
  document.getElementById("confirm-cancel").onclick = close;

  document.getElementById("confirm-go").onclick = async (e) => {
    const btn = e.currentTarget;
    const out = document.getElementById("confirm-out");
    const passcode = document.getElementById("confirm-pass").value.trim();
    if (!passcode) { out.innerHTML = '<span class="fin-bad">Enter the billing passcode.</span>'; return; }

    btn.disabled = true;
    btn.textContent = "Charging…";
    out.textContent = "";
    try {
      const res = await fetch("/.netlify/functions/charge-custom", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...body, adminEmail, passcode,
          preview: false,
          expectedAmount: quote.amount,   // the server re-derives and compares
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Charge failed");

      if (data.charged) {
        out.innerHTML = `<span class="fin-ok">Charged ${money(data.amount)} to ${esc(data.name)}.</span>`;
        btn.textContent = "Charged";
        setTimeout(() => { close(); if (onDone) onDone(); }, 1400);
      } else {
        // Declined is a normal outcome, not an error: nothing was taken.
        out.innerHTML = `<span class="fin-bad">Declined: ${esc(data.reason)}. Nothing was charged.</span>`;
        btn.disabled = false;
        btn.textContent = `Charge ${money(quote.amount)}`;
      }
    } catch (err) {
      out.innerHTML = `<span class="fin-bad">${esc(err.message)}</span>`;
      btn.disabled = false;
      btn.textContent = `Charge ${money(quote.amount)}`;
    }
  };
}

document.addEventListener("click", (e) => {
  if (e.target.id === "confirm-modal" || e.target.id === "confirm-close") close();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
