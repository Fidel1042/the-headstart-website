// journey.js — the four-stage customer journey page.
//
// Four circles in a row joined by dotted links, one per stage. Clicking one
// opens the panel underneath it. Every number comes from journey-stats; this
// file decides only how it looks.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

let ADMIN_EMAIL = "";
let DATA = null;
let OPEN = 0;

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Split a headline like "93% show rate" into the big bit and the words. */
function split(headline) {
  const m = String(headline || "").match(/^([\d.,]+%?|[\d.,]+)\s*(.*)$/);
  return m ? { big: m[1], unit: m[2] } : { big: headline || "—", unit: "" };
}

requireAuth((session) => {
  const email = session?.user?.email || "";
  const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  ADMIN_EMAIL = email;
  mountPortalNav({ email, isOwner: true, active: "journey" });
  load();
});

async function load() {
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  loading.hidden = false; errorEl.hidden = true;
  try {
    const res = await fetch("/.netlify/functions/journey-stats", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: ADMIN_EMAIL }),
    });
    // A static preview has no functions runtime, so the call comes back as the
    // site's 404 page. Say that, rather than letting JSON.parse complain about
    // an unexpected "<" and leaving it looking like the page is broken.
    const body = await res.text();
    if (body.trim().startsWith("<")) {
      throw new Error("This page needs the live site. Preview mode cannot run " +
        "the data function, so there is nothing to show until it is pushed.");
    }
    DATA = JSON.parse(body);
    if (!res.ok) throw new Error(DATA.error || "Could not load");
  } catch (err) {
    loading.hidden = true;
    errorEl.textContent = err.message || "Could not load — refresh to try again.";
    errorEl.hidden = false;
    return;
  }
  loading.hidden = true;
  renderFlow();
  renderPanel();
  document.getElementById("content").hidden = false;

  const foot = document.getElementById("foot");
  const when = new Date(DATA.generatedAt).toLocaleString("en-AU",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  foot.textContent = (DATA.notes || []).length
    ? `${DATA.notes.join(" · ")} — everything else is live as of ${when}`
    : `Live as of ${when}`;
}

/** Built once. Selecting a stage only toggles classes, so the buttons are
    never replaced mid-interaction and keyboard focus survives a click. */
function renderFlow() {
  const dots = "<i></i><i></i><i></i>";
  document.getElementById("flow").innerHTML = DATA.stages.map((s, i) => {
    const { big, unit } = split(s.headline);
    const node = `
      <button type="button" class="node${s.unavailable ? " is-off" : ""}"
              data-i="${i}" aria-pressed="false">
        <span class="node__dot">
          <span class="node__big">${esc(big)}</span>
          ${unit ? `<span class="node__unit">${esc(unit)}</span>` : ""}
        </span>
        <span class="node__name">${esc(s.label)}</span>
        <span class="node__cap">${esc(s.sub)}</span>
      </button>`;
    return i === 0 ? node : `<span class="link">${dots}</span>${node}`;
  }).join("");
  markOpen();
}

function markOpen() {
  document.querySelectorAll(".node").forEach((n) => {
    const on = Number(n.dataset.i) === OPEN;
    n.classList.toggle("is-on", on);
    n.setAttribute("aria-pressed", String(on));
  });
}

function select(i) {
  OPEN = i;
  markOpen();
  renderPanel();
}

function renderPanel() {
  const s = DATA.stages[OPEN];
  const cells = (s.stats || []).map((x) => `
    <div class="cell${x.warn ? " is-warn" : ""}">
      <div class="cell__v">${esc(x.value)}</div>
      <div class="cell__l">${esc(x.label)}</div>
      <div class="cell__n">${esc(x.note || "")}</div>
    </div>`).join("");

  const table = s.table ? `
    <div class="tbl-wrap">
      <table>
        <thead><tr>${s.table.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${s.table.rows.map((r) =>
          `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    ${s.table.note ? `<p class="tbl-note">${esc(s.table.note)}</p>` : ""}` : "";

  document.getElementById("panel").innerHTML = `
    <div class="panel">
      <div class="panel__top">
        <span class="panel__name">${esc(s.label)}</span>
        <span class="panel__sub">${esc(s.sub)}</span>
      </div>
      ${cells ? `<div class="grid">${cells}</div>` : ""}
      ${table}
    </div>`;
}

document.addEventListener("click", (e) => {
  const node = e.target.closest("[data-i]");
  if (node) select(Number(node.dataset.i));
});

// Left and right arrows walk the flow, so the whole page works from the
// keyboard once a circle has focus.
document.addEventListener("keydown", (e) => {
  if (!DATA || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
  if (!document.activeElement?.closest(".node")) return;
  e.preventDefault();
  select((OPEN + (e.key === "ArrowRight" ? 1 : -1) + DATA.stages.length) % DATA.stages.length);
  document.querySelector(`.node[data-i="${OPEN}"]`)?.focus();
});
