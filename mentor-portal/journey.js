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
let OPEN = "s0";  // "s<i>" for a circle, "l<i>" for a connector
let WINDOW_DAYS = 28;

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
      body: JSON.stringify({ adminEmail: ADMIN_EMAIL, windowDays: WINDOW_DAYS }),
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
  document.querySelectorAll(".win__b").forEach((b) =>
    b.classList.toggle("is-on", Number(b.dataset.w) === WINDOW_DAYS));

  const foot = document.getElementById("foot");
  const when = new Date(DATA.generatedAt).toLocaleString("en-AU",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const span = DATA.from ? `${DATA.from} to ${DATA.to} · ` : "";
  foot.textContent = span + ((DATA.notes || []).length
    ? `${DATA.notes.join(" · ")} — everything else is live as of ${when}`
    : `live as of ${when}`);
}

/** Built once. Selecting a stage only toggles classes, so the buttons are
    never replaced mid-interaction and keyboard focus survives a click. */
function renderFlow() {
  const links = DATA.links || [];
  document.getElementById("flow").innerHTML = DATA.stages.map((s, i) => {
    const { big, unit } = split(s.headline);
    const node = `
      <button type="button" class="node${s.unavailable ? " is-off" : ""}"
              data-k="s${i}" aria-pressed="false">
        <span class="node__dot">
          <span class="node__big">${esc(big)}</span>
          ${unit ? `<span class="node__unit">${esc(unit)}</span>` : ""}
        </span>
        <span class="node__name">${esc(s.label)}</span>
        <span class="node__cap">${esc(s.sub)}</span>
      </button>`;
    if (i === 0) return node;
    // The gap between two circles is itself a number worth opening, so the
    // arrow is a button carrying the conversion rate rather than decoration.
    const l = links[i - 1];
    const arrow = l
      ? `<button type="button" class="link" data-k="l${i - 1}" aria-pressed="false"
                 title="${esc(l.question)}">
           <span class="link__rate">${esc(l.headline)}</span>
           <span class="link__arrow">&rarr;</span>
         </button>`
      : `<span class="link"><span class="link__arrow">&rarr;</span></span>`;
    return arrow + node;
  }).join("");
  markOpen();
}

function markOpen() {
  document.querySelectorAll("[data-k]").forEach((n) => {
    const on = n.dataset.k === OPEN;
    n.classList.toggle("is-on", on);
    n.setAttribute("aria-pressed", String(on));
  });
}

function select(key) {
  OPEN = key;
  markOpen();
  renderPanel();
}

/** Whatever is open: a stage, or the connector between two stages. */
function current() {
  const i = Number(OPEN.slice(1));
  return OPEN[0] === "l"
    ? { ...(DATA.links || [])[i], sub: (DATA.links || [])[i].question }
    : DATA.stages[i];
}

function renderPanel() {
  const s = current();
  if (!s) return;
  const cells = (s.stats || []).map((x) => `
    <div class="cell${x.warn ? " is-warn" : ""}">
      <div class="cell__v">${esc(x.value)}</div>
      <div class="cell__l">${esc(x.label)}</div>
      <div class="cell__n">${esc(x.note || "")}</div>
    </div>`).join("");

  // A stage may carry one table or several; both shapes render the same way.
  const list = s.tables || (s.table ? [s.table] : []);
  const table = list.map((t) => `
    ${t.title ? `<p class="tbl-title">${esc(t.title)}</p>` : ""}
    <div class="tbl-wrap">
      <table>
        <thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${t.rows.map((r) =>
          `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
    ${t.note ? `<p class="tbl-note">${esc(t.note)}</p>` : ""}`).join("");

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
  const node = e.target.closest("[data-k]");
  if (node) { select(node.dataset.k); return; }

  // Switching the window refetches. The open circle stays open, so comparing
  // one stage across 7, 28 and 90 days is three clicks in the same place.
  const win = e.target.closest("[data-w]");
  if (win) {
    const next = Number(win.dataset.w);
    if (next === WINDOW_DAYS) return;
    WINDOW_DAYS = next;
    document.querySelectorAll(".win__b").forEach((b) =>
      b.classList.toggle("is-on", Number(b.dataset.w) === next));
    document.getElementById("win").classList.add("is-busy");
    load().finally(() => document.getElementById("win").classList.remove("is-busy"));
  }
});

// Left and right arrows walk the flow, so the whole page works from the
// keyboard once a circle has focus.
document.addEventListener("keydown", (e) => {
  if (!DATA || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
  if (!document.activeElement?.closest("[data-k]")) return;
  e.preventDefault();
  // Arrows walk the whole row, circles and connectors alike, in visual order.
  const keys = [...document.querySelectorAll("[data-k]")].map((n) => n.dataset.k);
  const at = keys.indexOf(OPEN);
  select(keys[(at + (e.key === "ArrowRight" ? 1 : -1) + keys.length) % keys.length]);
  document.querySelector(`[data-k="${OPEN}"]`)?.focus();
});
