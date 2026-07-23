// admin.js — owner-only overview: mentor table, session calendar, mentee status.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";
import { initCalendar } from "./admin-calendar.js";
import { renderStatus } from "./admin-status.js";
import { renderChart } from "./admin-chart.js";

initTheme();

let OWNER_EMAIL = "";

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const DAY_MS = 86400000;

const fmtMoney = (n) => "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
const daysSince = (d) => {
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t - new Date(d.slice(0, 10) + "T00:00:00")) / DAY_MS));
};
// Package purchase rows record a payment, not a delivered session.
const isPurchase = (s) => s.status === "Package" && s.amountCharged > 0;
const sameMentee = (s, m) => (s.menteeId && s.menteeId === m.id) || s.mentee.trim().toLowerCase() === m.name.trim().toLowerCase();

const d = (offset) => { const x = new Date(); x.setDate(x.getDate() - offset); return x.toISOString().slice(0, 10); };
const MOCK = {
  mentors: [
    { id: "recMT1", name: "Angelica", email: "angelica@mock.com", rate: 55, notes: "" },
    { id: "recMT2", name: "Aidan", email: "aidan@mock.com", rate: 50, notes: "Great with tech mentees" },
  ],
  mentees: [
    { id: "recM1", name: "Priya Sharma", mentorEmail: "angelica@mock.com", billingType: "Per Session", lastFollowUp: d(10) },
    { id: "recM2", name: "Chen Wei", mentorEmail: "aidan@mock.com", billingType: "Package", lastFollowUp: "" },
    { id: "recM3", name: "Zara Anderson", mentorEmail: "aidan@mock.com", billingType: "Per Session", lastFollowUp: "" },
  ],
  sessions: [
    { date: d(2), mentorEmail: "angelica@mock.com", mentorName: "Angelica", mentee: "Priya Sharma", menteeId: "recM1", payout: 55, amountDue: 35, amountCharged: 35, status: "Charged", mentorPaid: false, next: d(-5) },
    { date: d(9), mentorEmail: "angelica@mock.com", mentorName: "Angelica", mentee: "Priya Sharma", menteeId: "recM1", payout: 55, amountDue: 35, amountCharged: 35, status: "Charged", mentorPaid: true, next: "" },
    { date: d(18), mentorEmail: "aidan@mock.com", mentorName: "Aidan", mentee: "Chen Wei", menteeId: "recM2", payout: 50, amountDue: 30, amountCharged: 0, status: "Package", mentorPaid: true, next: "" },
    { date: d(33), mentorEmail: "aidan@mock.com", mentorName: "Aidan", mentee: "Zara Anderson", menteeId: "recM3", payout: 50, amountDue: 35, amountCharged: 35, status: "Charged", mentorPaid: true, next: "" },
  ],
};

async function load(ownerEmail) {
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  let data;
  try {
    if (isLocal) {
      data = MOCK;
    } else {
      const res = await fetch("/.netlify/functions/admin-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load");
    }
  } catch (err) {
    loading.hidden = true;
    errorEl.textContent = err.message || "Could not load — refresh to try again.";
    errorEl.hidden = false;
    return;
  }
  loading.hidden = true;
  const agg = aggregate(data);
  renderOverview(agg);
  renderStatus({ ...agg, ownerEmail: OWNER_EMAIL, onChanged: () => load(ownerEmail) });
  initCalendar({
    sessions: data.sessions,
    mentors: data.mentors,
    mentees: data.mentees,
    onAdded: () => load(ownerEmail), // refresh everything after a manual add
  });
  // Reveal whichever tab is marked active in the markup, so the default view is
  // changed by moving is-active in admin.html and nothing here needs touching.
  const active = document.querySelector(".admin-tab.is-active")?.dataset.view;
  if (active) document.getElementById("view-" + active).hidden = false;
}

function aggregate({ mentors = [], mentees = [], sessions = [] }) {
  const byEmail = new Map();
  mentors.forEach((m) => byEmail.set(m.email, { ...m, mentees: [], sessions: [] }));
  sessions.forEach((s) => { byEmail.get(s.mentorEmail)?.sessions.push(s); });
  mentees.forEach((m) => { byEmail.get(m.mentorEmail)?.mentees.push(m); });

  const monthStart = new Date().toISOString().slice(0, 8) + "01";
  const today = new Date().toISOString().slice(0, 10);

  const rows = [...byEmail.values()].map((m) => {
    const delivered = m.sessions.filter((s) => !isPurchase(s)).sort((a, b) => b.date.localeCompare(a.date));
    const last = delivered[0]?.date || "";
    const nextDates = m.sessions.map((s) => (s.next || "").slice(0, 10)).filter((n) => n >= today).sort();
    m.stats = {
      total: delivered.length,
      thisMonth: delivered.filter((s) => s.date >= monthStart).length,
      last,
      days: daysSince(last),
      next: nextDates[0] || "",
      owed: delivered.filter((s) => !s.mentorPaid).reduce((a, s) => a + s.payout, 0),
      paid: delivered.filter((s) => s.mentorPaid).reduce((a, s) => a + s.payout, 0),
      collected: m.sessions.reduce((a, s) => a + s.amountCharged, 0),
    };
    m.delivered = delivered;
    return m;
  }).sort((a, b) => (b.stats.last || "").localeCompare(a.stats.last || ""));

  const allDelivered = sessions.filter((s) => !isPurchase(s));
  return { rows, mentees, allDelivered, totalMentees: mentees.length };
}

function statusPill(days) {
  if (days === null) return '<span class="status-pill">No sessions</span>';
  if (days <= 14) return '<span class="status-pill status-pill--ok">Active</span>';
  if (days <= 30) return '<span class="status-pill status-pill--warn">Quiet</span>';
  return '<span class="status-pill status-pill--bad">Inactive</span>';
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

async function saveMentorNotes(id, body) {
  const textarea = body.querySelector(`.mentor-notes[data-id="${id}"]`);
  const stateEl = body.querySelector(`.mentor-notes__state[data-state="${id}"]`);
  const btn = body.querySelector(`.mentor-notes__save[data-id="${id}"]`);
  if (!textarea || !id) return;
  btn.disabled = true;
  stateEl.textContent = "Saving…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "mentor-notes", recordId: id, notes: textarea.value, ownerEmail: OWNER_EMAIL }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    stateEl.textContent = "Saved";
    setTimeout(() => { stateEl.textContent = ""; }, 3000);
  } catch (err) {
    stateEl.textContent = err.message || "Could not save";
  }
  btn.disabled = false;
}

function renderOverview({ rows, totalMentees }) {
  const monthCount = rows.reduce((a, m) => a + m.stats.thisMonth, 0);
  const owedTotal = rows.reduce((a, m) => a + m.stats.owed, 0);
  const active = rows.filter((m) => m.stats.days !== null && m.stats.days <= 30).length;

  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-mentees").textContent = totalMentees;
  document.getElementById("stat-month").textContent = monthCount;
  document.getElementById("stat-owed").textContent = fmtMoney(owedTotal);

  renderChart(rows);

  const body = document.getElementById("mentor-body");
  body.innerHTML = rows.map((m, i) => `
    <tr class="mentor-row" data-i="${i}">
      <td><span class="expand-caret">&#9654;</span></td>
      <td><div class="mentor-name">${m.name}</div><div class="mentor-email">${m.email}</div></td>
      <td class="num">${fmtMoney(m.rate)}</td>
      <td class="num">${m.mentees.length}</td>
      <td class="num">${m.stats.total}</td>
      <td class="num">${m.stats.thisMonth}</td>
      <td>${fmtDate(m.stats.last)}${m.stats.days !== null ? ` <span class="mentor-email">(${m.stats.days}d)</span>` : ""}</td>
      <td>${fmtDate(m.stats.next)}</td>
      <td class="num owed${m.stats.owed ? "" : " zero"}">${fmtMoney(m.stats.owed)}</td>
      <td>${statusPill(m.stats.days)}</td>
    </tr>
    <tr class="detail-row" data-detail="${i}" hidden><td colspan="10">${detailHTML(m)}</td></tr>
  `).join("");

  // Assignment (not addEventListener) so reloads never stack handlers.
  body.onclick = (e) => {
    const noteBtn = e.target.closest(".mentor-notes__save");
    if (noteBtn) { saveMentorNotes(noteBtn.dataset.id, body); return; }
    const row = e.target.closest(".mentor-row");
    if (!row) return;
    const detail = body.querySelector(`[data-detail="${row.dataset.i}"]`);
    detail.hidden = !detail.hidden;
    row.classList.toggle("is-open", !detail.hidden);
  };
}

// Tab switching between the three views.
document.getElementById("admin-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".admin-tab");
  if (!tab) return;
  document.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
  ["overview", "calendar", "mentees"].forEach((v) => {
    document.getElementById("view-" + v).hidden = v !== tab.dataset.view;
  });
});

// Runs last: on localhost requireAuth fires the callback synchronously,
// so everything the callback touches must already be defined above.
requireAuth((session) => {
  const email = session?.user?.email || "";
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  OWNER_EMAIL = email;
  mountPortalNav({ email, isOwner: true, active: "admin" });
  load(email);
});
