// ltv.js — the lifetime value table.
//
// Deliberately five columns and four filters. Everything else about a mentee
// already lives on the mentee status page; this answers one question, which
// is what a mentee is worth and how that varies.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

let ADMIN_EMAIL = "";
let DATA = null;
let SORT = { key: "ltv", desc: true };

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => "$" + Math.round(n).toLocaleString("en-AU");

requireAuth((session) => {
  const email = session?.user?.email || "";
  const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  ADMIN_EMAIL = email;
  mountPortalNav({ email, isOwner: true, active: "ltv" });
  load();
});

async function load() {
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  loading.hidden = false; errorEl.hidden = true;
  try {
    const res = await fetch("/.netlify/functions/ltv", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: ADMIN_EMAIL }),
    });
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

  const fill = (id, values) => {
    const sel = document.getElementById(id);
    values.forEach((v) => {
      const o = document.createElement("option");
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  };
  fill("f-mentor", DATA.mentors);
  fill("f-billing", DATA.billings);
  document.getElementById("filters").hidden = false;
  document.getElementById("content").hidden = false;
  render();
}

/** The rows left after the filters, in the current sort order. */
function visible() {
  const mentor = document.getElementById("f-mentor").value;
  const billing = document.getElementById("f-billing").value;
  const prepaidOnly = document.getElementById("f-prepaid").checked;
  const hideZero = document.getElementById("f-active").checked;

  const rows = DATA.rows.filter((r) =>
    (!mentor || r.mentor === mentor) &&
    (!billing || r.billing === billing) &&
    (!prepaidOnly || r.unrealised > 0) &&
    (!hideZero || r.ltv > 0));

  const { key, desc } = SORT;
  return rows.sort((a, b) => {
    const x = a[key], y = b[key];
    const cmp = typeof x === "string" ? x.localeCompare(y) : (x || 0) - (y || 0);
    return desc ? -cmp : cmp;
  });
}

function render() {
  const rows = visible();
  const total = rows.reduce((a, r) => a + r.ltv, 0);
  const unreal = rows.reduce((a, r) => a + r.unrealised, 0);
  const sessions = rows.reduce((a, r) => a + r.sessions, 0);
  const paying = rows.filter((r) => r.ltv > 0);
  // Median beats the mean here: one $490 package drags an average of 44 people
  // a long way, so both are shown.
  const sorted = [...paying].map((r) => r.ltv).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;

  document.getElementById("tiles").innerHTML = [
    [money(total), `Total from ${rows.length} mentees`],
    [money(paying.length ? total / paying.length : 0), "Average LTV"],
    [money(median), "Median LTV"],
    [sessions, "Sessions delivered"],
    [money(unreal), "Prepaid, not yet delivered"],
  ].map(([v, l]) => `<div class="tile"><div class="tile__v">${esc(v)}</div><div class="tile__l">${esc(l)}</div></div>`).join("");

  const max = Math.max(...rows.map((r) => r.ltv), 1);
  document.getElementById("rows").innerHTML = rows.length
    ? rows.map((r) => `
      <tr>
        <td class="mentor">${esc(r.name)}${r.unrealised > 0
          ? ` <span class="unreal">${money(r.unrealised)} unused</span>` : ""}${
          r.aliases && r.aliases.length
            ? ` <span class="alias" title="Session rows logged under this name were merged in">+ ${esc(r.aliases.join(", "))}</span>`
            : ""}${r.orphan ? ` <span class="orphan">no mentee record</span>` : ""}</td>
        <td><span class="bar" style="width:${Math.round((r.ltv / max) * 60)}px"></span>${money(r.ltv)}</td>
        <td>${r.sessions}</td>
        <td>${r.rate ? money(r.rate) : "—"}</td>
        <td class="mentor">${esc(r.mentor)}</td>
      </tr>`).join("")
    : `<tr><td colspan="5">Nothing matches those filters.</td></tr>`;

  document.querySelectorAll("th[data-sort]").forEach((th) =>
    th.classList.toggle("is-sort", th.dataset.sort === SORT.key));

  const when = new Date(DATA.generatedAt).toLocaleString("en-AU",
    { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const merged = DATA.rows.filter((r) => r.aliases && r.aliases.length).length;
  document.getElementById("foot").textContent =
    `LTV is all cash taken, including prepaid sessions not yet delivered. One row per mentee: ` +
    `session rows are matched to the mentee record by ID, then name, then a one-letter typo, ` +
    `and only when a single mentee could be meant.` +
    (merged ? ` ${merged} ${merged === 1 ? "mentee had" : "mentees had"} rows merged from a ` +
      `misspelled name.` : "") +
    (DATA.orphans && DATA.orphans.length
      ? ` ${DATA.orphans.length} session name has no mentee record: ${DATA.orphans.join(", ")}.` : "") +
    ` Live as of ${when}.`;
}

document.addEventListener("change", (e) => {
  if (e.target.closest("#filters")) render();
});

document.addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th || !DATA) return;
  const key = th.dataset.sort;
  // Same column flips direction; a new column starts descending, since the
  // interesting end of every one of these is the top.
  SORT = key === SORT.key ? { key, desc: !SORT.desc } : { key, desc: true };
  render();
});
