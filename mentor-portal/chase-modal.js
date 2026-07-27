// chase-modal.js — the popup for chasing a mentee whose card declined.
// Shows the ready-to-send message, a one-tap copy, and a WhatsApp button.
// The message text itself comes from the server (shared/chase-message.js) so
// the popup and the next-day reminder email always say the same thing.

let failed = [];

export function setFailed(list) { failed = list || []; }

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
