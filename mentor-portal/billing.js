// billing.js — owner billing screen: weekly charge preview + run,
// retry of declined cards, card links, package usage, audit, schema check.
// Extracted from billing.html to keep that file under the 250-line cap.
// Module scripts are deferred by default, so the DOM is ready when this runs.

import { requireAuth, ALLOWED_MENTOR_EMAILS } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";
import { setToolsAdmin } from "./billing-tools.js";
import { setFailed } from "./chase-modal.js";

initTheme();

let ADMIN_EMAIL = "";

requireAuth((session) => {
  const email = session?.user?.email || "";
  const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  ADMIN_EMAIL = email;
  setToolsAdmin(email);   // the tools module needs the same owner identity
  mountPortalNav({ email, isOwner: true, active: "billing" });
  loadPreview();
  loadFailed();
  runSchemaCheck(document.getElementById("schema-btn")); // auto-run on open
});

const BASE_TITLE = "Weekly Billing – The Headstart";

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

// ── Weekly charge preview ──
async function loadPreview() {
  const loading = document.getElementById("bill-loading");
  const empty   = document.getElementById("bill-empty");
  const content = document.getElementById("bill-content");
  loading.hidden = false; empty.hidden = true; content.hidden = true;

  let data;
  if (isLocal) {
    data = {
      weekLabel: "As of 5 Jul 2026",
      grandTotal: 210, chargeableTotal: 180,
      mentees: [
        { recordId: "rec1", name: "Mary Chen",   count: 3, total: 90, hasCard: true,  sessions: [{date:"2026-06-30"},{date:"2026-07-02"},{date:"2026-07-04"}] },
        { recordId: "rec2", name: "Priya Sharma", count: 3, total: 90, hasCard: true,  sessions: [{date:"2026-07-01"},{date:"2026-07-03"},{date:"2026-07-05"}] },
        { recordId: "rec3", name: "James Liu",    count: 1, total: 30, hasCard: false, sessions: [{date:"2026-07-02"}] },
      ],
    };
  } else {
    try {
      const res = await fetch("/.netlify/functions/preview-week", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: ADMIN_EMAIL }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e) {
      loading.hidden = true; empty.textContent = "Could not load — refresh to try again."; empty.hidden = false; return;
    }
  }

  loading.hidden = true;
  if (!data.mentees || data.mentees.length === 0) { empty.hidden = false; return; }

  document.getElementById("bill-week").textContent = data.weekLabel;
  document.getElementById("bill-list").innerHTML = data.mentees.map((m) => `
    <div class="row">
      <div class="row-main">
        <span class="row-name">${m.name}${m.hasCard ? "" : ' <span class="warn">no card</span>'}</span>
        <span class="row-sub">${m.count} session${m.count !== 1 ? "s" : ""} · ${m.sessions.map(s => fmtDate(s.date)).join(", ")}</span>
      </div>
      <span class="row-amount">$${m.total.toFixed(2)}</span>
    </div>`).join("");

  document.getElementById("bill-grand").textContent   = `$${data.grandTotal.toFixed(2)} AUD`;
  document.getElementById("bill-charge").textContent  = `$${data.chargeableTotal.toFixed(2)} AUD`;
  content.hidden = false;
}

window.chargeAll = async function (btn) {
  const passcode = document.getElementById("passcode").value.trim();
  if (!passcode) { alert("Enter the billing passcode first."); return; }
  if (!confirm("Charge every mentee listed above? This moves real money.")) return;

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Charging…";
  const resultEl = document.getElementById("charge-result");
  resultEl.textContent = "";

  if (isLocal) {
    btn.textContent = "Charged ✓ (mock)";
    resultEl.innerHTML = '<span style="color:#4caf81;">Mock: charged 2 mentees $180. 1 declined (James Liu — no card) — charge manually in Stripe.</span>';
    return;
  }

  try {
    const res  = await fetch("/.netlify/functions/charge-week", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: ADMIN_EMAIL, passcode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Charge failed");
    if (data.message) { resultEl.textContent = data.message; btn.textContent = original; btn.disabled = false; return; }
    btn.textContent = `Charged ${data.chargedCount} ✓`;
    let msg = `Charged ${data.chargedCount} mentee(s) — $${data.chargedTotal.toFixed(2)}.`;
    if (data.failedCount) {
      const names = data.results.filter(r => r.status === "Failed").map(r => `${r.name} (${r.reason})`).join(", ");
      msg += ` <span style="color:#e0a030;">${data.failedCount} declined. Chase them below.</span>`;
    }
    resultEl.innerHTML = msg;
    if (data.failedCount) {
      // The Retry Failed panel is built once on page load, so a fresh decline
      // would not appear there until a manual refresh. Rebuild it and take him
      // straight to it, since chasing is the next thing he has to do.
      await loadFailed();
      document.getElementById("retry-block").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (e) {
    btn.textContent = "Failed — try again"; btn.disabled = false;
    resultEl.innerHTML = `<span style="color:#e05050;">${e.message}</span>`;
  }
};

// ── Retry failed charges ──
async function loadFailed() {
  const loading = document.getElementById("retry-loading");
  const empty   = document.getElementById("retry-empty");
  const content = document.getElementById("retry-content");
  loading.hidden = false; empty.hidden = true; content.hidden = true;

  let data;
  if (isLocal) {
    data = { count: 1, total: 55, mentees: [{ name: "Patience Nduwayesu", sessions: 1, total: 55 }] };
  } else {
    try {
      const res = await fetch("/.netlify/functions/retry-failed", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: ADMIN_EMAIL, preview: true }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error);
    } catch (e) {
      loading.hidden = true; empty.textContent = "Could not load — refresh to try again."; empty.hidden = false; return;
    }
  }

  loading.hidden = true;
  if (!data.mentees || !data.mentees.length) { empty.hidden = false; return; }

  // Kept so the chase popup can read a mentee by index, rather than stuffing a
  // whole message into a DOM attribute and having to escape it.
  setFailed(data.mentees);
  document.getElementById("retry-list").innerHTML = data.mentees.map((m, i) => `
    <div class="row">
      <div class="row-main">
        <span class="row-name">${m.name}</span>
        <span class="row-sub">${m.sessions} session${m.sessions !== 1 ? "s" : ""} · ${m.reason || "declined"}</span>
      </div>
      <span class="row-amount">$${m.total.toFixed(2)}</span>
      <button class="btn ghost chase-btn" onclick="openChase(${i})">Chase</button>
    </div>`).join("");
  document.getElementById("retry-total").textContent = `$${data.total.toFixed(2)} AUD`;
  content.hidden = false;
}

window.retryFailed = async function (btn) {
  const passcode = document.getElementById("retry-passcode").value.trim();
  if (!passcode) { alert("Enter the billing passcode first."); return; }
  if (!confirm("Retry every declined card above? This moves real money.")) return;

  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Retrying…";
  const resultEl = document.getElementById("retry-result");
  resultEl.textContent = "";

  if (isLocal) {
    btn.textContent = "Retried ✓ (mock)";
    resultEl.innerHTML = '<span style="color:#4caf81;">Mock: charged 1 mentee $55.00.</span>';
    return;
  }

  try {
    const res  = await fetch("/.netlify/functions/retry-failed", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: ADMIN_EMAIL, passcode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Retry failed");
    if (data.message) { resultEl.textContent = data.message; btn.textContent = original; btn.disabled = false; return; }
    btn.textContent = `Charged ${data.chargedCount} ✓`;
    let msg = `Charged ${data.chargedCount} mentee(s) — $${data.chargedTotal.toFixed(2)}. Marked as Charged in Airtable.`;
    if (data.failedCount) {
      const names = data.results.filter(r => r.status === "Failed").map(r => `${r.name} (${r.reason})`).join(", ");
      msg += ` <span style="color:#e0a030;">${data.failedCount} declined again, still marked Failed: ${names}</span>`;
    }
    resultEl.innerHTML = msg;
    loadFailed();          // refresh the list; anything charged drops off
  } catch (e) {
    btn.textContent = "Failed — try again"; btn.disabled = false;
    resultEl.innerHTML = `<span style="color:#e05050;">${e.message}</span>`;
  }
};
