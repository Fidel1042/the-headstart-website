// earnings.js — month-on-month earnings, one comparison chart.
//
// Reads the same P&L rows the P&L page uses, via get-pl. No new backend and no
// second source of truth: if the two pages ever disagree, that is a bug in one
// row of Airtable rather than in two different calculations.
//
// Two series, so the chart is categorical: gross revenue against net profit.
// The colours are palette slots 1 and 3, validated against the portal's own
// surfaces (#ffffff light, #000000 black dark) rather than eyeballed. Light mode
// puts aqua at 2.82:1, under the 3:1 bar, which is why every bar carries a
// visible value label and the table below repeats every number.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

const SERIES = [
  { key: "grossRevenue", label: "Gross revenue", light: "#2a78d6", dark: "#3987e5" },
  { key: "netProfit",    label: "Net profit",    light: "#1baf7a", dark: "#199e70" },
];

const isDark = () => document.documentElement.getAttribute("data-theme") !== "light";
const hue = (s) => (isDark() ? s.dark : s.light);

const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => "$" + Math.round(n || 0).toLocaleString("en-AU");
const pct = (n) => (n || n === 0 ? `${Math.round(n * 10) / 10}%` : "—");

/** "2026-07" -> "Jul 2026". Sydney is irrelevant here; the label is the key. */
function monthName(m) {
  const [y, mo] = String(m).split("-");
  const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const i = Number(mo) - 1;
  return names[i] ? `${names[i]} ${y}` : String(m);
}

/** A nice round axis top, so gridlines land on readable numbers. */
function axisTop(max) {
  if (max <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(max)));
  for (const s of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]) {
    if (mag * s >= max) return mag * s;
  }
  return mag * 10;
}

function tiles(rows) {
  const cur = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;

  const delta = (a, b) => {
    if (!prev || !b) return "";
    const d = ((a - b) / Math.abs(b)) * 100;
    const cls = d >= 0 ? "up" : "down";
    return `<div class="tile__d tile__d--${cls}">${d >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(d))}% vs ${monthName(prev.month)}</div>`;
  };

  const items = [
    ["Gross revenue", money(cur.grossRevenue), delta(cur.grossRevenue, prev && prev.grossRevenue)],
    ["Net profit", money(cur.netProfit), delta(cur.netProfit, prev && prev.netProfit)],
    ["Sessions", String(cur.sessionCount || 0), delta(cur.sessionCount, prev && prev.sessionCount)],
    ["Net margin", pct(cur.netMargin), ""],
  ];
  document.getElementById("tiles").innerHTML = items.map(([l, v, d]) =>
    `<div class="tile"><div class="tile__v">${esc(v)}</div><div class="tile__l">${esc(l)}</div>${d}</div>`
  ).join("");
}

function chart(rows) {
  const W = 720, H = 300, padL = 52, padR = 12, padT = 14, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  const max = Math.max(...rows.flatMap((r) => SERIES.map((s) => r[s.key] || 0)), 0);
  const top = axisTop(max);
  const y = (v) => padT + plotH - (Math.max(v, 0) / top) * plotH;

  const groupW = plotW / rows.length;
  // 2px surface gap between adjacent bars, per the mark spec.
  const barW = Math.min(46, (groupW * 0.62) / SERIES.length);

  const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = padT + plotH - f * plotH;
    return `<line class="grid" x1="${padL}" y1="${gy}" x2="${W - padR}" y2="${gy}" />
            <text class="axis" x="${padL - 8}" y="${gy + 3}" text-anchor="end">${money(top * f)}</text>`;
  }).join("");

  const bars = rows.map((r, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const startX = cx - (barW * SERIES.length + 2) / 2;
    const group = SERIES.map((s, j) => {
      const v = r[s.key] || 0;
      const bx = startX + j * (barW + 2);
      const by = y(v), bh = Math.max(padT + plotH - by, v > 0 ? 2 : 0);
      return `<rect class="bar" x="${bx}" y="${by}" width="${barW}" height="${bh}"
                rx="4" fill="${hue(s)}"
                data-m="${esc(monthName(r.month))}" data-s="${esc(s.label)}" data-v="${esc(money(v))}" />
              <text class="vlabel" x="${bx + barW / 2}" y="${by - 5}" text-anchor="middle">${money(v)}</text>`;
    }).join("");
    return group +
      `<text class="axis" x="${cx}" y="${H - 12}" text-anchor="middle">${esc(monthName(r.month))}</text>`;
  }).join("");

  const svg = document.getElementById("chart");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = grid + bars;

  document.getElementById("legend").innerHTML = SERIES.map((s) =>
    `<span><i style="background:${hue(s)}"></i>${esc(s.label)}</span>`).join("");

  document.getElementById("chart-sub").textContent =
    `${rows.length} month${rows.length === 1 ? "" : "s"}, ${monthName(rows[0].month)} to ${monthName(rows[rows.length - 1].month)}`;
  document.getElementById("chart-desc").textContent = rows.map((r) =>
    `${monthName(r.month)}: gross ${money(r.grossRevenue)}, net ${money(r.netProfit)}`).join(". ");
}

function table(rows) {
  document.getElementById("rows").innerHTML = rows.slice().reverse().map((r) => `
    <tr>
      <td>${esc(monthName(r.month))}</td>
      <td>${r.sessionCount || 0}</td>
      <td>${money(r.grossRevenue)}</td>
      <td>${money(r.mentorPayouts)}</td>
      <td>${money(r.totalOpex)}</td>
      <td>${money(r.netProfit)}</td>
      <td>${pct(r.netMargin)}</td>
    </tr>`).join("");
}

// Per-mark hover, since an SVG chart is interactive by default.
const tip = document.getElementById("tip");
document.getElementById("chart").addEventListener("pointerover", (e) => {
  const b = e.target.closest(".bar");
  if (!b) return;
  tip.innerHTML = `${esc(b.dataset.m)} · ${esc(b.dataset.s)}<br><b>${esc(b.dataset.v)}</b>`;
  tip.classList.add("on");
});
document.getElementById("chart").addEventListener("pointermove", (e) => {
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY - 10}px`;
});
document.getElementById("chart").addEventListener("pointerout", () => tip.classList.remove("on"));

requireAuth(async (session) => {
  mountPortalNav({ email: session.user.email, isOwner: true, active: "earnings" });
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  try {
    const res = await fetch("/.netlify/functions/get-pl", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminEmail: session.user.email }),
    });
    const text = await res.text();
    if (text.trim().startsWith("<")) throw new Error("This page needs the live site.");
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || "Could not load");

    // get-pl sorts newest first and the table carries blank placeholder rows.
    // Oldest first for a left-to-right timeline; a row with no Month is not a
    // month.
    const rows = (data.records || data.rows || [])
      .filter((r) => r.month)
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));

    if (!rows.length) {
      loading.hidden = true;
      errorEl.textContent = "No months in the P&L table yet.";
      errorEl.hidden = false;
      return;
    }
    tiles(rows); chart(rows); table(rows);
    loading.hidden = true;
    document.getElementById("content").hidden = false;
  } catch (err) {
    loading.hidden = true;
    errorEl.textContent = err.message || "Could not load";
    errorEl.hidden = false;
  }
});
