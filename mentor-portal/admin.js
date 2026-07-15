// admin.js — owner-only mentor overview: per-mentor sessions, pay, mentees.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

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

const MOCK = {
  mentors: [
    { name: "Angelica", email: "angelicagrace160272@gmail.com", rate: 55 },
    { name: "Aidan", email: "aidanmwibrata@gmail.com", rate: 50 },
  ],
  mentees: [
    { name: "Priya Sharma", mentorEmail: "angelicagrace160272@gmail.com", billingType: "Per Session" },
    { name: "Chen Wei", mentorEmail: "aidanmwibrata@gmail.com", billingType: "Package" },
  ],
  sessions: [
    { date: "2026-07-08", mentorEmail: "angelicagrace160272@gmail.com", mentorName: "Angelica", mentee: "Priya Sharma", payout: 55, amountDue: 35, amountCharged: 35, status: "Charged", mentorPaid: false, next: "2026-07-15" },
    { date: "2026-06-20", mentorEmail: "aidanmwibrata@gmail.com", mentorName: "Aidan", mentee: "Chen Wei", payout: 50, amountDue: 30, amountCharged: 0, status: "Package", mentorPaid: true, next: "" },
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
  render(aggregate(data));
}

function aggregate({ mentors = [], mentees = [], sessions = [] }) {
  const byEmail = new Map();
  mentors.forEach((m) => byEmail.set(m.email, { ...m, mentees: [], sessions: [] }));
  // Sessions from emails missing in the mentor table (e.g. co-founders) still show.
  sessions.forEach((s) => {
    if (!byEmail.has(s.mentorEmail)) {
      byEmail.set(s.mentorEmail, { name: s.mentorName || s.mentorEmail, email: s.mentorEmail, rate: null, mentees: [], sessions: [] });
    }
    byEmail.get(s.mentorEmail).sessions.push(s);
  });
  mentees.forEach((m) => { if (byEmail.has(m.mentorEmail)) byEmail.get(m.mentorEmail).mentees.push(m); });

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

  return { rows, totalMentees: mentees.length };
}

function statusPill(days) {
  if (days === null) return '<span class="status-pill">No sessions</span>';
  if (days <= 14) return '<span class="status-pill status-pill--ok">Active</span>';
  if (days <= 30) return '<span class="status-pill status-pill--warn">Quiet</span>';
  return '<span class="status-pill status-pill--bad">Inactive</span>';
}

function menteeStats(m, delivered) {
  const mine = delivered.filter((s) => s.mentee.trim().toLowerCase() === m.name.trim().toLowerCase());
  const last = mine[0]?.date || "";
  return { count: mine.length, last };
}

function detailHTML(m) {
  const menteeRows = m.mentees.length
    ? m.mentees.map((x) => {
        const st = menteeStats(x, m.delivered);
        return `<tr><td>${x.name}</td><td>${x.billingType}</td><td>${st.count}</td><td>${fmtDate(st.last)}</td></tr>`;
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
    </div>`;
}

function render({ rows, totalMentees }) {
  const monthCount = rows.reduce((a, m) => a + m.stats.thisMonth, 0);
  const owedTotal = rows.reduce((a, m) => a + m.stats.owed, 0);
  const active = rows.filter((m) => m.stats.days !== null && m.stats.days <= 30).length;

  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-mentees").textContent = totalMentees;
  document.getElementById("stat-month").textContent = monthCount;
  document.getElementById("stat-owed").textContent = fmtMoney(owedTotal);
  document.getElementById("stat-row").hidden = false;

  const body = document.getElementById("mentor-body");
  body.innerHTML = rows.map((m, i) => `
    <tr class="mentor-row" data-i="${i}">
      <td><span class="expand-caret">&#9654;</span></td>
      <td><div class="mentor-name">${m.name}</div><div class="mentor-email">${m.email}</div></td>
      <td class="num">${m.rate === null ? "—" : fmtMoney(m.rate)}</td>
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

  body.addEventListener("click", (e) => {
    const row = e.target.closest(".mentor-row");
    if (!row) return;
    const detail = body.querySelector(`[data-detail="${row.dataset.i}"]`);
    const open = !detail.hidden;
    detail.hidden = open;
    row.classList.toggle("is-open", !open);
  });

  document.getElementById("table-wrap").hidden = false;
}

// Runs last: on localhost requireAuth fires the callback synchronously,
// so everything the callback touches must already be defined above.
requireAuth((session) => {
  const email = session?.user?.email || "";
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  mountPortalNav({ email, isOwner: true, active: "admin" });
  load(email);
});
