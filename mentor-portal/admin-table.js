// admin-table.js — the sortable mentor overview table.
// Rows come pre-aggregated from admin.js; this owns display, sorting, the
// rolling-30-day comparison column, and the expandable per-mentor detail.

import { fmtMoney, fmtDate, sameMentee } from "./admin-utils.js";

let rows = [];
let ownerEmail = "";
let onNotes = null;
// Default sort: most recent activity first, matching the old behaviour.
let sort = { key: "last", dir: "desc" };

// Each sortable column: how to pull its comparable value from a row.
const SORT_VALUE = {
  name:   (m) => m.name.toLowerCase(),
  rate:   (m) => m.rate || 0,
  mentees:(m) => m.mentees.length,
  last30: (m) => m.stats.last30,
  prev30: (m) => m.stats.prev30,
  last:   (m) => m.stats.last || "",
  next:   (m) => m.stats.next || "",
  owed:   (m) => m.stats.owed,
  status: (m) => (m.stats.days === null ? Infinity : m.stats.days),
};

function statusPill(days) {
  if (days === null) return '<span class="status-pill">No sessions</span>';
  if (days <= 14) return '<span class="status-pill status-pill--ok">Active</span>';
  if (days <= 30) return '<span class="status-pill status-pill--warn">Quiet</span>';
  return '<span class="status-pill status-pill--bad">Inactive</span>';
}

// Rolling-30-day count with a coloured delta against the previous 30 days.
function trend(m) {
  const now = m.stats.last30;
  const prev = m.stats.prev30;
  const diff = now - prev;
  const tone = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "–";
  return `<span class="t30">${now}</span>` +
    `<span class="t30-delta t30-delta--${tone}" title="Previous 30 days: ${prev}">${arrow} ${diff > 0 ? "+" : ""}${diff}</span>`;
}

function detailHTML(m) {
  const menteeRows = m.mentees.length
    ? m.mentees.map((x) => {
        const mine = m.delivered.filter((s) => sameMentee(s, x));
        return `<tr><td>${x.name}</td><td>${x.billingType}</td><td>${mine.length}</td><td>${fmtDate(mine[0]?.date || "")}</td></tr>`;
      }).join("")
    : '<tr><td colspan="4">No mentees assigned</td></tr>';
  const sessionRows = m.delivered.slice(0, 10).map((s) => `
    <tr>
      <td>${fmtDate(s.date)}</td><td>${s.mentee}</td>
      <td>${fmtMoney(s.payout)}</td><td>${s.status}</td>
      <td>${s.mentorPaid ? '<span class="paid-check">Paid</span>' : '<span class="paid-pending">Owed</span>'}</td>
    </tr>`).join("") || '<tr><td colspan="5">No sessions logged</td></tr>';
  return `
    <div class="detail-grid">
      <div class="detail-block">
        <h4>Mentees</h4>
        <table class="detail-table">
          <thead><tr><th>Name</th><th>Billing</th><th>Sessions</th><th>Last</th></tr></thead>
          <tbody>${menteeRows}</tbody>
        </table>
      </div>
      <div class="detail-block">
        <h4>Last 10 sessions · lifetime paid ${fmtMoney(m.stats.paid)} · collected ${fmtMoney(m.stats.collected)}</h4>
        <table class="detail-table">
          <thead><tr><th>Date</th><th>Mentee</th><th>Payout</th><th>Status</th><th>Pay</th></tr></thead>
          <tbody>${sessionRows}</tbody>
        </table>
      </div>
      <div class="detail-block detail-block--wide">
        <h4>Admin notes</h4>
        <textarea class="mentor-notes" data-id="${m.id || ""}" rows="3">${(m.notes || "").replace(/</g, "&lt;")}</textarea>
        <div class="mentor-notes__row">
          <button type="button" class="mentor-notes__save" data-id="${m.id || ""}">Save notes</button>
          <span class="mentor-notes__state" data-state="${m.id || ""}"></span>
        </div>
      </div>
    </div>`;
}

function sorted() {
  const val = SORT_VALUE[sort.key] || SORT_VALUE.last;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = val(a), bv = val(b);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return a.name.localeCompare(b.name);
  });
}

function paint() {
  const body = document.getElementById("mentor-body");
  body.innerHTML = sorted().map((m, i) => `
    <tr class="mentor-row" data-i="${i}">
      <td><span class="expand-caret">&#9654;</span></td>
      <td><div class="mentor-name">${m.name}</div><div class="mentor-email">${m.email || "no email"}</div></td>
      <td class="num">${fmtMoney(m.rate)}</td>
      <td class="num">${m.mentees.length}</td>
      <td class="num t30-cell">${trend(m)}</td>
      <td class="num t30-prev">${m.stats.prev30}</td>
      <td>${fmtDate(m.stats.last)}${m.stats.days !== null ? ` <span class="mentor-email">(${m.stats.days}d)</span>` : ""}</td>
      <td>${fmtDate(m.stats.next)}</td>
      <td class="num owed${m.stats.owed ? "" : " zero"}">${fmtMoney(m.stats.owed)}</td>
      <td>${statusPill(m.stats.days)}</td>
    </tr>
    <tr class="detail-row" data-detail="${i}" hidden><td colspan="10">${detailHTML(m)}</td></tr>`).join("");

  document.querySelectorAll("#mentor-table th[data-sort]").forEach((th) => {
    const active = th.dataset.sort === sort.key;
    th.classList.toggle("is-sorted", active);
    th.dataset.dir = active ? sort.dir : "";
  });
}

export function renderTable({ rows: r, ownerEmail: email, onSaveNotes }) {
  rows = r;
  ownerEmail = email;
  onNotes = onSaveNotes;
  paint();

  const head = document.querySelector("#mentor-table thead");
  head.onclick = (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    // First click on a column: high to low. Click again: flip.
    if (sort.key === key) sort.dir = sort.dir === "desc" ? "asc" : "desc";
    else sort = { key, dir: key === "name" ? "asc" : "desc" };
    paint();
  };

  const body = document.getElementById("mentor-body");
  body.onclick = (e) => {
    const noteBtn = e.target.closest(".mentor-notes__save");
    if (noteBtn) { onNotes && onNotes(noteBtn.dataset.id, body); return; }
    const row = e.target.closest(".mentor-row");
    if (!row) return;
    const detail = body.querySelector(`[data-detail="${row.dataset.i}"]`);
    detail.hidden = !detail.hidden;
    row.classList.toggle("is-open", !detail.hidden);
  };
}
