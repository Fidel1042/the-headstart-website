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
// Ticked comparisons. A key is either a window length ("7", "90") or "prev",
// meaning the same length shifted back by one of itself.
const COMPARE = new Set();
const CACHE = new Map();     // cache key -> payload, so re-ticking is instant

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

/** The request behind a compare key, and the label shown against it. */
function spec(key) {
  return key === "prev"
    ? { windowDays: WINDOW_DAYS, previousPeriod: true, label: "prev" }
    : { windowDays: Number(key), previousPeriod: false, label: `${key}d` };
}
// A function declaration, not a const: requireAuth calls back synchronously on
// localhost, so load() can run before a const further down has initialised.
function cacheKey(sp) { return `${sp.windowDays}|${sp.previousPeriod ? 1 : 0}`; }

/** One window's payload, cached so ticking a comparison does not refetch. */
async function fetchWindow(sp) {
  const ck = cacheKey(sp);
  if (CACHE.has(ck)) return CACHE.get(ck);
  const res = await fetch("/.netlify/functions/journey-stats", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      adminEmail: ADMIN_EMAIL, windowDays: sp.windowDays, previousPeriod: sp.previousPeriod,
    }),
  });
  const body = await res.text();
  if (body.trim().startsWith("<")) {
    throw new Error("This page needs the live site. Preview mode cannot run " +
      "the data function, so there is nothing to show until it is pushed.");
  }
  const data = JSON.parse(body);
  if (!res.ok) throw new Error(data.error || "Could not load");
  CACHE.set(ck, data);
  return data;
}

async function load() {
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  loading.hidden = false; errorEl.hidden = true;
  try {
    DATA = await fetchWindow(spec(String(WINDOW_DAYS)));
    await Promise.all([...COMPARE].map((k) => fetchWindow(spec(k))));
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
  renderCompareBar();

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
    // A gap either holds a midpoint of its own, drawn as a small circle
    // between two arrows, or it is just an arrow. The other gaps carry no
    // number because it would repeat the circle they point at.
    const l = links[i - 1];
    const arrow = `<span class="link"><span class="link__arrow">&rarr;</span></span>`;
    if (!l) return arrow + node;
    return arrow + `
      <button type="button" class="mid" data-k="l${i - 1}" aria-pressed="false"
              title="${esc(l.question)}">
        <span class="mid__dot">${esc(l.headline)}</span>
        <span class="mid__name">${esc(l.label)}</span>
      </button>` + arrow + node;
  }).join("");
  markOpen();
}

/** The compare tick boxes: every window except the one being viewed. */
function renderCompareBar() {
  const bar = document.getElementById("cmp");
  if (!bar || !DATA) return;
  const others = (DATA.windows || [7, 28, 90])
    .filter((w) => w !== WINDOW_DAYS).map(String).concat("prev");
  bar.innerHTML = `<span class="cmp__lead">Compare with</span>` + others.map((k) => `
    <label class="cmp__box">
      <input type="checkbox" data-cmp="${k}" ${COMPARE.has(k) ? "checked" : ""} />
      <span>${k === "prev" ? `previous ${WINDOW_DAYS} days` : `${k} days`}</span>
    </label>`).join("");
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

/** First number in a value like "63%", "13 days" or 40. Null when there is none. */
function num(v) {
  const m = String(v ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** The same panel from another window, so its stats can be looked up by label. */
function panelFor(payload) {
  if (!payload) return null;
  const i = Number(OPEN.slice(1));
  return OPEN[0] === "l" ? (payload.links || [])[i] : (payload.stages || [])[i];
}

/**
 * One comparison line under a stat: the other window's value, coloured by
 * whether the current window is better. "Better" is usually higher, but a
 * rising no-show count or a longer wait is worse, and the backend marks those.
 */
/**
 * Whether a change is worth colouring.
 *
 * A rate survives any comparison. A headcount only survives one against an
 * equally long span: 28 days having more visitors than 7 is arithmetic, not
 * good news, so that stays grey. Against the previous period of the same
 * length, a count is a fair fight and gets coloured like anything else.
 */
function colourable(stat, key) {
  return /%|day/i.test(String(stat.value)) || key === "prev";
}

/** Green when the current window is better, red when worse. */
function direction(stat, now, then) {
  if (now === null || then === null || now === then) return "";
  const up = now > then;
  return (stat.lowerIsBetter ? !up : up) ? "is-up" : "is-down";
}

/**
 * The headline change, shown at the same size as the number itself because it
 * is the point of ticking a comparison. Prefers the previous period when it is
 * ticked, since that is the like-for-like one.
 */
function delta(stat) {
  if (!COMPARE.size) return "";
  const key = COMPARE.has("prev") ? "prev" : [...COMPARE][0];
  if (!colourable(stat, key)) return "";
  const sp = spec(key);
  const other = (panelFor(CACHE.get(cacheKey(sp))) || {}).stats || [];
  const match = other.find((x) => x.label === stat.label);
  if (!match) return "";
  const now = num(stat.value), then = num(match.value);
  if (now === null || then === null || !then) return "";
  const pc = Math.round(((now - then) / Math.abs(then)) * 100);
  if (!pc) return `<span class="cell__d">no change</span>`;
  const cls = direction(stat, now, then);
  return `<span class="cell__d ${cls}">${pc > 0 ? "+" : "&minus;"}${Math.abs(pc)}%</span>`;
}

function compareLine(stat) {
  if (!COMPARE.size) return "";
  const now = num(stat.value);
  // "prev" last: the window comparisons are a size question, the previous
  // period is a time question, and they read better grouped that way.
  const keys = [...COMPARE].sort((a, b) =>
    (a === "prev" ? 1e9 : Number(a)) - (b === "prev" ? 1e9 : Number(b)));
  return keys.map((key) => {
    const sp = spec(key);
    const other = (panelFor(CACHE.get(cacheKey(sp))) || {}).stats || [];
    const match = other.find((x) => x.label === stat.label);
    if (!match) return `<span class="cmp"><b>${sp.label}</b> —</span>`;
    const then = num(match.value);
    const cls = colourable(stat, key) ? " " + direction(stat, now, then) : "";
    return `<span class="cmp${cls}"><b>${sp.label}</b> ${esc(match.value)}</span>`;
  }).join("");
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
      <div class="cell__top"><span class="cell__v">${esc(x.value)}</span>${delta(x)}</div>
      <div class="cell__l">${esc(x.label)}</div>
      <div class="cell__n">${esc(x.note || "")}</div>
      ${COMPARE.size ? `<div class="cell__cmp">${compareLine(x)}</div>` : ""}
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
  // Ticking a comparison only re-renders; the other window is fetched once and
  // cached, so toggling it back on is instant.
  const cmp = e.target.closest("[data-cmp]");
  if (cmp) {
    const key = cmp.dataset.cmp;
    if (COMPARE.has(key)) { COMPARE.delete(key); renderPanel(); renderCompareBar(); return; }
    COMPARE.add(key);
    renderCompareBar();
    fetchWindow(spec(key)).then(() => { renderPanel(); renderCompareBar(); })
      .catch(() => { COMPARE.delete(key); renderCompareBar(); });
    return;
  }

  const win = e.target.closest("[data-w]");
  if (win) {
    const next = Number(win.dataset.w);
    if (next === WINDOW_DAYS) return;
    WINDOW_DAYS = next;
    // The window you are viewing can never also be a comparison. "prev" is
    // kept: it means "the period before this one", whatever this one is.
    COMPARE.delete(String(next));
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
