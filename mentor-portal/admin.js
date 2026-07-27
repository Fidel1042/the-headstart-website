// admin.js — owner-only overview: mentor table, session calendar, mentee status.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";
import { initCalendar } from "./admin-calendar.js";
import { renderStatus } from "./admin-status.js";
import { renderChart } from "./admin-chart.js";
import { renderTable } from "./admin-table.js";
import { renderPerformance } from "./admin-performance.js";
import { fmtMoney, daysSince, isPurchase, daysAgoISO } from "./admin-utils.js";

initTheme();

let OWNER_EMAIL = "";

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

const d = (offset) => { const x = new Date(); x.setDate(x.getDate() - offset); return x.toISOString().slice(0, 10); };
const MOCK = {
  mentors: [
    { id: "recMT1", name: "Angelica", email: "angelica@mock.com", rate: 55, notes: "" },
    { id: "recMT2", name: "Aidan", email: "aidan@mock.com", rate: 50, notes: "Great with tech mentees" },
  ],
  mentees: [
    { id: "recM1", name: "Priya Sharma", mentorEmail: "angelica@mock.com", billingType: "Per Session", nextSession: d(-5) },
    { id: "recM2", name: "Chen Wei", mentorEmail: "aidan@mock.com", billingType: "Package", nextSession: "" },
    { id: "recM3", name: "Zara Anderson", mentorEmail: "aidan@mock.com", billingType: "Per Session", nextSession: d(3) },
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
  const norm = (s) => String(s || "").toLowerCase().trim();
  const buckets = mentors.map((m) => ({ ...m, mentees: [], sessions: [] }));

  // Index by email AND by name, but never by a blank value. A mentor with no
  // email in Airtable (Khaleel) would otherwise own the "" key and collect
  // every orphan session and mentee whose mentor-email is also blank.
  const byEmail = new Map();
  const byName = new Map();
  buckets.forEach((m) => {
    if (norm(m.email)) byEmail.set(norm(m.email), m);
    if (norm(m.name))  byName.set(norm(m.name), m);
  });
  // Resolve by email first, then fall back to mentor name (some session rows
  // carry a Mentor Name but no email). A record that matches neither is
  // genuinely unassigned and attaches to nobody.
  const resolve = (email, name) => byEmail.get(norm(email)) || byName.get(norm(name)) || null;

  sessions.forEach((s) => { resolve(s.mentorEmail, s.mentorName)?.sessions.push(s); });
  mentees.forEach((m)  => { resolve(m.mentorEmail, m.mentorName)?.mentees.push(m); });

  const monthStart = new Date().toISOString().slice(0, 8) + "01";
  const today = new Date().toISOString().slice(0, 10);
  // Rolling windows: last 30 days, and the 30 days before that for comparison.
  const back30 = daysAgoISO(30);
  const back60 = daysAgoISO(60);

  // Iterate the buckets, not byEmail: a mentor with no email is still a real
  // mentor and must appear (as idle), just no longer as an orphan magnet.
  const rows = buckets.map((m) => {
    const delivered = m.sessions.filter((s) => !isPurchase(s)).sort((a, b) => b.date.localeCompare(a.date));
    const last = delivered[0]?.date || "";
    const nextDates = m.sessions.map((s) => (s.next || "").slice(0, 10)).filter((n) => n >= today).sort();
    m.stats = {
      total: delivered.length,
      thisMonth: delivered.filter((s) => s.date >= monthStart).length,
      last30: delivered.filter((s) => s.date > back30).length,
      prev30: delivered.filter((s) => s.date > back60 && s.date <= back30).length,
      last,
      days: daysSince(last),
      next: nextDates[0] || "",
      owed: delivered.filter((s) => !s.mentorPaid).reduce((a, s) => a + s.payout, 0),
      paid: delivered.filter((s) => s.mentorPaid).reduce((a, s) => a + s.payout, 0),
      collected: m.sessions.reduce((a, s) => a + s.amountCharged, 0),
    };
    m.delivered = delivered;
    return m;
  });

  const allDelivered = sessions.filter((s) => !isPurchase(s));
  return { rows, mentees, allDelivered, totalMentees: mentees.length };
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
  // Rolling 30 days across all mentors, so the tile matches the table column.
  const last30 = rows.reduce((a, m) => a + m.stats.last30, 0);
  const owedTotal = rows.reduce((a, m) => a + m.stats.owed, 0);
  const active = rows.filter((m) => m.stats.days !== null && m.stats.days <= 30).length;

  document.getElementById("stat-active").textContent = active;
  document.getElementById("stat-mentees").textContent = totalMentees;
  document.getElementById("stat-month").textContent = last30;
  document.getElementById("stat-owed").textContent = fmtMoney(owedTotal);

  renderChart(rows);
  renderTable({ rows, ownerEmail: OWNER_EMAIL, onSaveNotes: saveMentorNotes });
  renderPerformance(rows);
}

// Tab switching between the three views.
document.getElementById("admin-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".admin-tab");
  if (!tab) return;
  document.querySelectorAll(".admin-tab").forEach((t) => t.classList.toggle("is-active", t === tab));
  ["overview", "calendar", "mentees", "performance"].forEach((v) => {
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
