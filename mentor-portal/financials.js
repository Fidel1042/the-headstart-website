// financials.js — Mentee Financials screen. Search a mentee, read their
// money state, charge them behind a confirm step, or send an invoice.
//
// Nothing here decides an amount. The page asks the server what a charge would
// come to, shows that back, and sends the same figure to be checked again on
// the way in. See charge-custom.js for the reasoning.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";
import { openConfirm } from "./financials-charge.js";
import { configureRecord, renderRecord } from "./financials-record.js";

initTheme();

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
let ADMIN_EMAIL = "";
let MENTEES = [];
let CURRENT = null;

const money = (n) => "$" + (Number(n) || 0).toFixed(2);
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDate = (d) => d
  ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
  : "—";

requireAuth((session) => {
  const email = session?.user?.email || "";
  const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  ADMIN_EMAIL = email;
  mountPortalNav({ email, isOwner: true, active: "financials" });
  configureRecord({ api, adminEmail: email, onDone: () => loadMentee(CURRENT.id) });
  loadList();
});

async function api(fn, body) {
  const res = await fetch(`/.netlify/functions/${fn}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminEmail: ADMIN_EMAIL, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function loadList() {
  if (isLocal) {
    MENTEES = [{ id: "rec1", name: "Mary Chen", billingType: "Per Session" }];
  } else {
    try { MENTEES = (await api("mentee-financials", {})).mentees; }
    catch { document.getElementById("fin-empty").textContent = "Could not load mentees. Refresh to try again."; return; }
  }
  document.getElementById("fin-names").innerHTML =
    MENTEES.map((m) => `<option value="${esc(m.name)}"></option>`).join("");
}

document.getElementById("fin-search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const hit = MENTEES.find((m) => m.name.toLowerCase() === q);
  if (hit) loadMentee(hit.id);
});

async function loadMentee(id) {
  const loading = document.getElementById("fin-loading");
  const empty = document.getElementById("fin-empty");
  const detail = document.getElementById("fin-detail");
  loading.hidden = false; empty.hidden = true; detail.hidden = true;

  try {
    CURRENT = await api("mentee-financials", { recordId: id });
  } catch (err) {
    loading.hidden = true; empty.textContent = err.message; empty.hidden = false; return;
  }
  loading.hidden = true;
  render(CURRENT);
  detail.hidden = false;
}

function render(d) {
  document.getElementById("fin-name").textContent = d.name;

  // A price that will not parse is a charge that must not happen, so it is
  // called out here rather than discovered at the moment of charging.
  const priceOk = Number.isFinite(d.sessionPrice) && d.sessionPrice > 0;
  const bits = [
    d.billingType,
    priceOk ? `${money(d.sessionPrice)} a session` : `<span class="fin-bad">price unreadable ("${esc(d.sessionPriceRaw)}")</span>`,
    d.hasCard ? "card on file" : '<span class="fin-bad">no card on file</span>',
  ];
  document.getElementById("fin-sub").innerHTML = bits.join(" &middot; ");

  const tiles = [
    ["Outstanding", money(d.outstanding), d.outstanding > 0 ? "bad" : ""],
    ["Failed", money(d.failedTotal), d.failedTotal > 0 ? "bad" : ""],
    ["Paid to date", money(d.lifetimeCharged), ""],
    ["Sessions", String(d.counts.total), ""],
  ];
  if (d.packageRemaining !== null) {
    tiles.push(["Package left", `${d.packageRemaining} of ${d.packageBought}`, d.packageRemaining <= 1 ? "warn" : ""]);
  }
  document.getElementById("fin-tiles").innerHTML = tiles.map(([lbl, val, tone]) => `
    <div class="total-box">
      <div class="lbl">${lbl}</div>
      <div class="val ${tone ? "fin-" + tone : ""}">${val}</div>
    </div>`).join("") + historyHtml(d.history);

  const wa = document.getElementById("fin-wa");
  wa.hidden = !d.phone;
  if (d.phone) wa.href = `https://wa.me/${d.phone}`;

  renderRecord(d);
}

function historyHtml(history) {
  if (!history.length) return '<p class="fin-none">No sessions logged yet.</p>';
  return `
    <details class="fin-history">
      <summary>Charge history (${history.length})</summary>
      <div class="table-scroll">
        <table class="fin-table">
          <thead><tr><th>Date</th><th>Item</th><th>Status</th><th class="num">Charged</th></tr></thead>
          <tbody>${history.map((h) => `
            <tr>
              <td>${fmtDate(h.date)}</td>
              <td>${h.kind === "purchase" ? "Package purchase" : "Session"}</td>
              <td>${esc(h.status)}${h.reason ? ` <span class="fin-bad">${esc(h.reason)}</span>` : ""}</td>
              <td class="num">${h.charged ? money(h.charged) : "—"}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </details>`;
}

// Show only the inputs the chosen charge type actually uses.
document.getElementById("ch-kind").addEventListener("change", (e) => {
  const k = e.target.value;
  document.getElementById("ch-sessions-wrap").hidden = k === "custom";
  document.getElementById("ch-rate-wrap").hidden = k !== "package";
  document.getElementById("ch-amount-wrap").hidden = k !== "custom";
  document.getElementById("ch-reason-wrap").hidden = k !== "custom";
  document.getElementById("ch-out").textContent = "";
});

document.getElementById("ch-check").addEventListener("click", async (btn) => {
  const out = document.getElementById("ch-out");
  if (!CURRENT) { out.textContent = "Pick a mentee first."; return; }
  const kind = document.getElementById("ch-kind").value;
  const body = {
    recordId: CURRENT.id, kind, preview: true,
    sessions: document.getElementById("ch-sessions").value,
    rate: document.getElementById("ch-rate").value,
    amount: document.getElementById("ch-amount").value,
    reason: document.getElementById("ch-reason").value,
  };
  out.textContent = "Checking…";
  try {
    const q = await api("charge-custom", body);
    out.textContent = "";
    openConfirm({ quote: q, body, adminEmail: ADMIN_EMAIL, onDone: () => loadMentee(CURRENT.id) });
  } catch (err) {
    out.innerHTML = `<span class="fin-bad">${esc(err.message)}</span>`;
  }
});

document.getElementById("fin-invoice").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const out = document.getElementById("fin-invoice-out");
  if (!CURRENT) return;
  btn.disabled = true; out.textContent = "Preparing…";
  try {
    const p = await api("send-invoice", { recordId: CURRENT.id, preview: true });
    if (!confirm(`Email invoice ${p.no} to ${p.to}?\n\n${p.lines.length} item(s), total ${money(p.total)}.`)) {
      out.textContent = ""; btn.disabled = false; return;
    }
    const sent = await api("send-invoice", { recordId: CURRENT.id });
    out.innerHTML = `<span class="fin-ok">Invoice ${sent.no} sent to ${esc(sent.to)}.</span>`;
  } catch (err) {
    out.innerHTML = `<span class="fin-bad">${esc(err.message)}</span>`;
  }
  btn.disabled = false;
});
