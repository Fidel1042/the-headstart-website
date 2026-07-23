// admin-chart.js — "Who did the work" chart for the admin overview.
//
// One stacked bar per mentor, sorted by sessions this month. Each segment is a
// mentee, sized by sessions with them. Hover or tap a segment for the detail;
// click the row to open the full per-mentee breakdown underneath.
//
// Deliberately not a Sankey / branch diagram: every mentee belongs to exactly
// one mentor, so there are no flows to cross and the extra machinery would add
// decoration, not information. A stacked bar ranks mentors at a glance, which
// is the actual question this answers.

const DAY_MS = 86400000;
const sameMentee = (s, m) =>
  (s.menteeId && s.menteeId === m.id) ||
  s.mentee.trim().toLowerCase() === m.name.trim().toLowerCase();

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (d) => d
  ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })
  : "—";

const daysAgo = (d) => {
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t - new Date(d.slice(0, 10) + "T00:00:00")) / DAY_MS));
};

let bound = false;
let model = [];

// Build mentor -> mentee session counts for the current month and all time.
function buildModel(rows) {
  const monthStart = new Date().toISOString().slice(0, 8) + "01";

  return rows
    .map((m) => {
      // Anyone they actually taught, whether or not they are still assigned.
      const names = new Map();
      m.delivered.forEach((s) => {
        const key = (s.mentee || "Unknown").trim();
        if (!key) return;
        if (!names.has(key)) names.set(key, { name: key, month: 0, all: 0, last: "" });
        const e = names.get(key);
        e.all += 1;
        if (s.date >= monthStart) e.month += 1;
        if (s.date > e.last) e.last = s.date;
      });
      // Assigned mentees with no sessions yet still matter: a mentor sitting on
      // an untouched mentee is exactly what this page should expose.
      m.mentees.forEach((x) => {
        const key = (x.name || "").trim();
        if (key && !names.has(key)) names.set(key, { name: key, month: 0, all: 0, last: "" });
      });

      const people = [...names.values()].sort((a, b) => b.month - a.month || b.all - a.all);
      return {
        // Some Airtable rows carry a trailing space ("Fidel ").
        name: String(m.name || "").trim(),
        email: m.email,
        month: m.stats.thisMonth,
        all: m.stats.total,
        people,
      };
    })
    .sort((a, b) => b.month - a.month || b.all - a.all);
}

function segments(mentor, max) {
  const active = mentor.people.filter((p) => p.month > 0);
  if (!active.length) return "";
  // Bar length is relative to the busiest mentor, so rows are comparable.
  const width = max > 0 ? (mentor.month / max) * 100 : 0;
  return `
    <div class="wc-bar" style="width:${width.toFixed(2)}%">
      ${active.map((p, i) => `
        <button type="button" class="wc-seg wc-seg--${i % 4}"
          style="flex-grow:${p.month}"
          data-tip="${esc(p.name)} &middot; ${p.month} this month &middot; ${p.all} all time"
          aria-label="${esc(p.name)}, ${p.month} sessions this month, ${p.all} all time">
          <span class="wc-seg__n">${p.month}</span>
        </button>`).join("")}
    </div>`;
}

// The per-mentee breakdown. Indented off the mentor with a connector line, so
// it reads as branching from them without needing a drawn diagram.
function branch(mentor) {
  if (!mentor.people.length) return '<p class="wc-none">No mentees assigned.</p>';
  const maxAll = Math.max(...mentor.people.map((p) => p.all), 1);

  return `
    <ul class="wc-branch">
      ${mentor.people.map((p) => {
        const d = daysAgo(p.last);
        const stale = d === null ? "none" : d > 14 ? "bad" : d > 7 ? "warn" : "ok";
        return `
        <li class="wc-twig">
          <div class="wc-twig__name">${esc(p.name)}</div>
          <div class="wc-twig__track" aria-hidden="true">
            <span class="wc-twig__fill" style="width:${((p.all / maxAll) * 100).toFixed(1)}%"></span>
          </div>
          <div class="wc-twig__nums">
            <span class="wc-twig__month">${p.month}</span>
            <span class="wc-twig__all">of ${p.all}</span>
          </div>
          <div class="wc-twig__last wc-twig__last--${stale}">${
            p.last ? `${fmtDate(p.last)} &middot; ${d}d` : "No sessions yet"
          }</div>
        </li>`;
      }).join("")}
    </ul>`;
}

export function renderChart(rows) {
  const host = document.getElementById("work-chart");
  if (!host) return;

  const all = buildModel(rows);
  // Mentors with nothing this month would be a run of empty rows at the bottom,
  // padding the chart with the least useful information on it. They are still
  // worth knowing about, so they get one summary line instead of a row each.
  model = all.filter((m) => m.month > 0);
  const idle = all.filter((m) => m.month === 0 && (m.all > 0 || m.people.length > 0));

  const max = Math.max(...model.map((m) => m.month), 1);
  const monthTotal = model.reduce((a, m) => a + m.month, 0);

  if (!monthTotal) {
    host.innerHTML = '<p class="wc-none">No sessions logged this month yet.</p>';
    return;
  }

  host.innerHTML = `
    <div class="wc-head">
      <h2 class="wc-title">Sessions this month</h2>
      <p class="wc-sub">${monthTotal} across ${model.length} mentors. Tap a block for the mentee, tap a name for the full breakdown.</p>
    </div>
    <div class="wc-rows">
      ${model.map((m, i) => `
        <div class="wc-row" data-i="${i}">
          <button type="button" class="wc-name" aria-expanded="false" aria-controls="wc-detail-${i}">
            <span class="wc-caret" aria-hidden="true"></span>
            <span class="wc-name__text">${esc(m.name)}</span>
          </button>
          <div class="wc-track">${segments(m, max)}</div>
          <div class="wc-total"><strong>${m.month}</strong><span class="wc-total__all">of ${m.all}</span></div>
          <div class="wc-detail" id="wc-detail-${i}" hidden>${branch(m)}</div>
        </div>`).join("")}
    </div>
    ${idle.length ? `<p class="wc-idle"><strong>${idle.length} mentor${idle.length === 1 ? "" : "s"} with nothing this month:</strong> ${
      idle.map((m) => `${esc(m.name)}${m.people.length ? ` (${m.people.length} mentee${m.people.length === 1 ? "" : "s"})` : ""}`).join(", ")
    }</p>` : ""}
    <div class="wc-tip" id="wc-tip" hidden></div>`;

  if (!bound) {
    bound = true;
    host.addEventListener("click", onClick);
    host.addEventListener("pointerover", onHover);
    host.addEventListener("pointerout", hideTip);
  }
}

function onClick(e) {
  const seg = e.target.closest(".wc-seg");
  if (seg) { showTip(seg); return; }        // tap works where hover does not
  const btn = e.target.closest(".wc-name");
  if (!btn) return;
  const row = btn.closest(".wc-row");
  const detail = row.querySelector(".wc-detail");
  const open = !detail.hidden;
  detail.hidden = open;
  row.classList.toggle("is-open", !open);
  btn.setAttribute("aria-expanded", String(!open));
}

function onHover(e) {
  const seg = e.target.closest(".wc-seg");
  if (seg) showTip(seg);
}

function showTip(seg) {
  const tip = document.getElementById("wc-tip");
  if (!tip) return;
  tip.innerHTML = seg.dataset.tip;
  tip.hidden = false;
  const host = document.getElementById("work-chart").getBoundingClientRect();
  const r = seg.getBoundingClientRect();
  // Clamp inside the panel so a tooltip near the edge never causes sideways scroll.
  const half = tip.offsetWidth / 2;
  const x = Math.min(Math.max(r.left - host.left + r.width / 2, half + 4), host.width - half - 4);
  tip.style.left = `${x}px`;
  tip.style.top = `${r.top - host.top - tip.offsetHeight - 8}px`;
}

function hideTip(e) {
  if (e && e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".wc-seg")) return;
  const tip = document.getElementById("wc-tip");
  if (tip) tip.hidden = true;
}
