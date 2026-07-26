// admin-performance.js — mentor performance master view.
// Lifetime signals for evaluating mentors: how many mentees they have taught,
// how many sessions, average depth per mentee, retention, usual lesson
// frequency, and how many are still active this month.

import { avgGapDays, fmtFrequency } from "./admin-utils.js";

const DAY_MS = 86400000;
const RETENTION_THRESHOLD = 3;   // sessions needed to count as "retained"
const GRACE_DAYS = 30;           // a mentee inside their first month is excluded
                                  // from retention: too early to call it a drop

let rows = [];
let sort = { key: "retention", dir: "desc" };

const menteeKey = (s) => (s.mentee || "").trim().toLowerCase() || s.menteeId;
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY_MS);

// Lifetime performance for one mentor, from their delivered sessions.
function perf(m) {
  const today = todayISO();
  const back30 = (() => { const x = new Date(); x.setDate(x.getDate() - 30); return x.toISOString().slice(0, 10); })();

  const byMentee = new Map(); // mentee key -> sorted array of session dates
  m.delivered.forEach((s) => {
    const k = menteeKey(s);
    if (!k || !s.date) return;
    if (!byMentee.has(k)) byMentee.set(k, []);
    byMentee.get(k).push(s.date);
  });
  byMentee.forEach((dates) => dates.sort());

  const mentees = byMentee.size;
  const sessions = m.delivered.length;
  const recent = [...byMentee.entries()].filter(([, dates]) => dates[dates.length - 1] > back30).length;

  // Retention: 3+ sessions, but only counted once the relationship has had a
  // full month to prove itself. A mentee still in month one is excluded
  // entirely from both the retained and total count below, not marked as lost.
  let eligible = 0, retained = 0;
  // Usual lesson frequency: the average gap between sessions for a mentee,
  // only possible once they have had a 2nd session. Averaged across such
  // mentees to give one "how often do they actually meet" number per mentor.
  const menteeGaps = [];
  byMentee.forEach((dates) => {
    const first = dates[0];
    if (daysBetween(first, today) >= GRACE_DAYS) {
      eligible += 1;
      if (dates.length >= RETENTION_THRESHOLD) retained += 1;
    }
    const gap = avgGapDays(dates);
    if (gap !== null) menteeGaps.push(gap);
  });

  return {
    name: m.name,
    email: m.email,
    mentees,
    sessions,
    avg: mentees ? sessions / mentees : 0,
    retention: eligible ? retained / eligible : null,
    retained,
    eligible,
    frequency: menteeGaps.length ? menteeGaps.reduce((a, g) => a + g, 0) / menteeGaps.length : null,
    active: recent,
  };
}

const SORT_VALUE = {
  name:      (p) => p.name.toLowerCase(),
  mentees:   (p) => p.mentees,
  sessions:  (p) => p.sessions,
  avg:       (p) => p.avg,
  retention: (p) => (p.retention === null ? -1 : p.retention),
  frequency: (p) => (p.frequency === null ? Infinity : p.frequency), // fewer days = more often = sorts first on asc
  active:    (p) => p.active,
};

function retentionCell(p) {
  if (!p.mentees) return '<span class="perf-none">No mentees</span>';
  // Every mentee is inside their first month: nothing eligible to judge yet.
  if (p.retention === null) return '<span class="perf-none">Too new to tell</span>';
  const w = Math.round(p.retention * 100);
  const tone = w >= 60 ? "ok" : w >= 35 ? "warn" : "bad";
  return `
    <div class="perf-ret">
      <div class="perf-ret__bar"><span class="perf-ret__fill perf-ret__fill--${tone}" style="width:${w}%"></span></div>
      <span class="perf-ret__val">${w}% <span class="perf-ret__sub">${p.retained}/${p.eligible}</span></span>
    </div>`;
}

function frequencyCell(p) {
  const label = fmtFrequency(p.frequency);
  if (!label) return '<span class="perf-none">—</span>';
  return `${label} <span class="perf-ret__sub">between sessions</span>`;
}

function sorted(data) {
  const val = SORT_VALUE[sort.key] || SORT_VALUE.retention;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...data].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.name.localeCompare(b.name);
  });
}

function paint() {
  // Only mentors who have actually taught someone; idle hires would just be a
  // block of zero-rows that say nothing about performance.
  const data = rows.map(perf).filter((p) => p.sessions > 0 || p.mentees > 0);
  const body = document.getElementById("perf-body");
  body.innerHTML = sorted(data).map((p) => `
    <tr>
      <td><div class="mentor-name">${p.name}</div><div class="mentor-email">${p.email || "no email"}</div></td>
      <td class="num">${p.mentees}</td>
      <td class="num">${p.sessions}</td>
      <td class="num">${p.avg ? p.avg.toFixed(1) : "—"}</td>
      <td>${retentionCell(p)}</td>
      <td>${frequencyCell(p)}</td>
      <td class="num">${p.active}</td>
    </tr>`).join("") || '<tr><td colspan="7" class="perf-none">No mentor activity yet.</td></tr>';

  document.querySelectorAll("#perf-table th[data-sort]").forEach((th) => {
    const active = th.dataset.sort === sort.key;
    th.classList.toggle("is-sorted", active);
    th.dataset.dir = active ? sort.dir : "";
  });
}

export function renderPerformance(r) {
  rows = r;
  paint();
  const head = document.querySelector("#perf-table thead");
  if (head && !head.dataset.bound) {
    head.dataset.bound = "1";
    head.onclick = (e) => {
      const th = e.target.closest("th[data-sort]");
      if (!th) return;
      const key = th.dataset.sort;
      if (sort.key === key) sort.dir = sort.dir === "desc" ? "asc" : "desc";
      else sort = { key, dir: key === "name" ? "asc" : "desc" };
      paint();
    };
  }
}
