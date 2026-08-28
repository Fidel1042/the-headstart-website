// admin-performance.js — mentor performance master view.
// Lifetime signals for evaluating mentors: how many mentees they have taught,
// how many sessions, average depth per mentee, retention, usual lesson
// frequency, and how many are still active this month.

import { avgGapDays, fmtFrequency } from "./admin-utils.js";
import { openRetention } from "./admin-retention-modal.js";

const DAY_MS = 86400000;
const RETENTION_THRESHOLD = 3;   // sessions needed to count as "retained"
const GRACE_DAYS = 30;           // a mentee inside their first month is excluded
                                  // from retention: too early to call it a drop

let rows = [];
let sort = { key: "retention", dir: "desc" };

// Identity is the Airtable record id. The typed name is only a fallback for
// rows old enough to predate the id, because a mentor typing "Saksha" one
// week and "Sakshi Khatter" the next used to split one person into two and
// quietly halve that mentor's retention. admin-overview.js already keys
// this way; these two files had it the wrong way round.
// mentee key -> { reason }. Filled by setExclusions() before perf() runs.
const EXCLUDED = new Map();

export function setExclusions(list) {
  EXCLUDED.clear();
  (list || []).forEach((m) => {
    EXCLUDED.set(m.id, { reason: m.reason || "" });
    // Sessions old enough to predate the record id key on the lower-cased name,
    // so both forms are registered.
    if (m.name) EXCLUDED.set(String(m.name).trim().toLowerCase(), { reason: m.reason || "" });
  });
}

const menteeKey = (s) => s.menteeId || (s.mentee || "").trim().toLowerCase();
const todayISO = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY_MS);

// Lifetime performance for one mentor, from their delivered sessions.
function perf(m) {
  const today = todayISO();
  const back30 = (() => { const x = new Date(); x.setDate(x.getDate() - 30); return x.toISOString().slice(0, 10); })();

  const byMentee = new Map(); // mentee key -> sorted array of session dates
  const nameFor = new Map();  // key -> the name as it was actually written
  m.delivered.forEach((s) => {
    const k = menteeKey(s);
    if (!k || !s.date) return;
    if (!byMentee.has(k)) byMentee.set(k, []);
    byMentee.get(k).push(s.date);
    if (!nameFor.has(k)) nameFor.set(k, (s.mentee || "").trim() || k);
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
  // Per-mentee working, so the number can be opened up and questioned rather
  // than taken on trust. This is what the retention popup lists.
  const detail = [];
  let excluded = 0;
  byMentee.forEach((dates, key) => {
    const first = dates[0];
    const age = daysBetween(first, today);
    const ex = EXCLUDED.get(key);
    // Excluded mentees leave the sum entirely, the same way a mentee inside
    // their first month does. They are still returned and still listed, so the
    // count on the tile can say how many were set aside.
    const isEligible = age >= GRACE_DAYS && !ex;
    const isRetained = dates.length >= RETENTION_THRESHOLD;
    if (ex) excluded += 1;
    if (isEligible) {
      eligible += 1;
      if (isRetained) retained += 1;
    }
    const gap = avgGapDays(dates);
    if (gap !== null) menteeGaps.push(gap);
    detail.push({
      id: key,
      name: nameFor.get(key) || key,
      sessions: dates.length,
      first,
      last: dates[dates.length - 1],
      age,
      eligible: isEligible,
      retained: isEligible && isRetained,
      frequency: gap,
      excluded: Boolean(ex),
      excludeReason: ex ? ex.reason : "",
    });
  });
  // Worst first: the ones dragging the number down are the ones worth reading.
  detail.sort((a, b) => {
    if (a.excluded !== b.excluded) return a.excluded ? 1 : -1;
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return a.sessions - b.sessions;
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
    excluded,
    frequency: menteeGaps.length ? menteeGaps.reduce((a, g) => a + g, 0) / menteeGaps.length : null,
    active: recent,
    detail,
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

function retentionCell(p, i) {
  if (!p.mentees) return '<span class="perf-none">No mentees</span>';
  // Every mentee is inside their first month: nothing eligible to judge yet,
  // but the working is still worth opening to see who is pending.
  if (p.retention === null) {
    return `<button type="button" class="perf-ret-btn perf-none" data-ret="${i}">Too new to tell</button>`;
  }
  const w = Math.round(p.retention * 100);
  const tone = w >= 60 ? "ok" : w >= 35 ? "warn" : "bad";
  // Thin samples are flagged in the cell itself, so a 100% off one mentee is
  // not read as a strong result at a glance.
  const thin = p.eligible < 3 ? ' <span class="perf-thin" title="Too few mentees to be reliable">thin</span>' : "";
  return `
    <button type="button" class="perf-ret-btn" data-ret="${i}" title="See how this is worked out">
      <div class="perf-ret">
        <div class="perf-ret__bar"><span class="perf-ret__fill perf-ret__fill--${tone}" style="width:${w}%"></span></div>
        <span class="perf-ret__val">${w}% <span class="perf-ret__sub">${p.retained}/${p.eligible}</span>${thin}</span>
      </div>
    </button>`;
}

function frequencyCell(p) {
  const label = fmtFrequency(p.frequency);
  return label || '<span class="perf-none">—</span>';
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
  const view = sorted(data);
  body.innerHTML = view.map((p, i) => `
    <tr>
      <td><div class="mentor-name">${p.name}</div><div class="mentor-email">${p.email || "no email"}</div></td>
      <td class="num">${p.mentees}</td>
      <td class="num">${p.sessions}</td>
      <td class="num">${p.avg ? p.avg.toFixed(1) : "—"}</td>
      <td>${retentionCell(p, i)}</td>
      <td>${frequencyCell(p)}</td>
      <td class="num">${p.active}</td>
    </tr>`).join("") || '<tr><td colspan="7" class="perf-none">No mentor activity yet.</td></tr>';

  body.onclick = (e) => {
    const hit = e.target.closest("[data-ret]");
    if (hit) openRetention(view[Number(hit.dataset.ret)], RETENTION_THRESHOLD, GRACE_DAYS);
  };

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
