// admin-calendar.js — monthly session calendar, colour-coded per mentor.
// Chips open a detail popup; "+ Add session" logs a session via log-session.

const PALETTE = ["#4caf81", "#5b9bd5", "#e0a030", "#c96fc0", "#e05050", "#4fc3c3", "#a3d977", "#f0c75c", "#8f7be8", "#e08c5a"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

let month = null;
let state = null; // { byDate, upcoming, colors, names, mentees, registry, onAdded }
let bound = false;

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (d) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtMoney = (n) => "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function initCalendar({ sessions = [], mentors = [], mentees = [], onAdded = null } = {}) {
  const colors = new Map();
  const names = new Map();
  mentors.forEach((m, i) => { colors.set(m.email, PALETTE[i % PALETTE.length]); names.set(m.email, m.name); });
  sessions.forEach((s) => {
    if (!colors.has(s.mentorEmail)) {
      colors.set(s.mentorEmail, PALETTE[colors.size % PALETTE.length]);
      names.set(s.mentorEmail, s.mentorName || s.mentorEmail);
    }
  });

  const registry = [];
  const byDate = new Map();
  sessions.forEach((s) => {
    const d = (s.date || "").slice(0, 10);
    if (!d) return;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push({ k: registry.length, s });
    registry.push({ type: "logged", s });
  });

  const upcoming = new Map();
  const seen = new Set();
  sessions.forEach((s) => {
    const n = (s.next || "").slice(0, 10);
    if (!n) return;
    const dedupe = n + "|" + (s.menteeId || s.mentee);
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    const logged = (byDate.get(n) || []).some((x) => (x.s.menteeId || x.s.mentee) === (s.menteeId || s.mentee));
    if (logged) return;
    if (!upcoming.has(n)) upcoming.set(n, []);
    upcoming.get(n).push({ k: registry.length, s });
    registry.push({ type: "booked", s });
  });

  state = { byDate, upcoming, colors, names, mentees, registry, onAdded };
  if (!month) { month = new Date(); month.setDate(1); }

  if (!bound) {
    bound = true;
    document.getElementById("cal-prev").addEventListener("click", () => { month.setMonth(month.getMonth() - 1); draw(); });
    document.getElementById("cal-next").addEventListener("click", () => { month.setMonth(month.getMonth() + 1); draw(); });
    document.getElementById("cal-today").addEventListener("click", () => { month = new Date(); month.setDate(1); draw(); });
    document.getElementById("cal-add").addEventListener("click", showAddForm);
    document.getElementById("cal-modal-close").addEventListener("click", closeModal);
    document.getElementById("cal-modal").addEventListener("click", (e) => { if (e.target.id === "cal-modal") closeModal(); });
    document.getElementById("cal-grid").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-k]");
      if (chip) showDetail(state.registry[Number(chip.dataset.k)]);
    });
  }
  draw();
}

function chip(entry, dashed) {
  const { k, s } = entry;
  const c = state.colors.get(s.mentorEmail) || "#888";
  return `<button type="button" class="cal-chip${dashed ? " cal-chip--next" : ""}" style="--c:${c}" data-k="${k}">${esc(s.mentee)}</button>`;
}

function draw() {
  if (!state) return;
  document.getElementById("cal-title").textContent =
    month.toLocaleDateString("en-AU", { month: "long", year: "numeric" });

  const start = new Date(month);
  start.setDate(1 - ((month.getDay() + 6) % 7));
  const todayKey = key(new Date());

  let cells = "";
  const cursor = new Date(start);
  do {
    for (let i = 0; i < 7; i++) {
      const k = key(cursor);
      const inMonth = cursor.getMonth() === month.getMonth();
      const logged = (state.byDate.get(k) || []).map((x) => chip(x, false)).join("");
      const next = (state.upcoming.get(k) || []).map((x) => chip(x, true)).join("");
      cells += `<div class="cal-cell${inMonth ? "" : " cal-cell--out"}${k === todayKey ? " cal-cell--today" : ""}">
        <span class="cal-daynum">${cursor.getDate()}</span>${logged}${next}
      </div>`;
      cursor.setDate(cursor.getDate() + 1);
    }
  } while (cursor.getMonth() === month.getMonth());

  const dow = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  document.getElementById("cal-grid").innerHTML = dow + cells;

  document.getElementById("cal-legend").innerHTML = [...state.colors.entries()]
    .map(([email, c]) => `<span class="cal-legend__item"><span class="cal-swatch" style="--c:${c}"></span>${esc(state.names.get(email) || email)}</span>`)
    .join("") +
    `<span class="cal-legend__item"><span class="cal-swatch cal-swatch--next"></span>Booked (not logged yet)</span>`;
}

// ── Detail popup ──
function menteeFor(s) {
  return state.mentees.find((m) => (s.menteeId && m.id === s.menteeId) || m.name.trim().toLowerCase() === s.mentee.trim().toLowerCase());
}

function showDetail({ type, s }) {
  const mentor = state.names.get(s.mentorEmail) || s.mentorName || s.mentorEmail;
  const billing = menteeFor(s)?.billingType || "—";
  const rows = type === "booked"
    ? [["Mentee", esc(s.mentee)], ["Mentor", esc(mentor)], ["Booked for", fmtDate(s.next)], ["Status", "Not logged yet"], ["Payment type", esc(billing)]]
    : [["Mentee", esc(s.mentee)], ["Mentor", esc(mentor)], ["Date", fmtDate(s.date)], ["Session fee", fmtMoney(s.amountDue)], ["Payment status", esc(s.status)], ["Payment type", esc(billing)]];
  openModal(`
    <h3 class="cal-modal__title">${type === "booked" ? "Booked session" : "Logged session"}</h3>
    ${rows.map(([l, v]) => `<div class="cal-modal__row"><span>${l}</span><span>${v}</span></div>`).join("")}`);
}

// ── Manual add ──
function showAddForm() {
  const opts = state.mentees
    .map((m) => `<option value="${m.id}">${esc(m.name)} — ${esc(state.names.get(m.mentorEmail) || m.mentorEmail)}</option>`)
    .join("");
  const today = new Date().toISOString().slice(0, 10);
  openModal(`
    <h3 class="cal-modal__title">Add session</h3>
    <form id="cal-add-form" class="cal-form">
      <label>Mentee<select name="mentee" required><option value="">Select&hellip;</option>${opts}</select></label>
      <label>Session date<input type="date" name="date" value="${today}" required /></label>
      <label>Next session date (optional)<input type="date" name="next" /></label>
      <label>Notes (optional)<textarea name="notes" rows="2"></textarea></label>
      <div class="cal-form__row">
        <button type="submit" class="cal-btn cal-btn--today" id="cal-add-submit">Log session</button>
        <span class="cal-form__state" id="cal-add-state"></span>
      </div>
    </form>`);
  document.getElementById("cal-add-form").addEventListener("submit", submitAdd);
}

async function submitAdd(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const mentee = state.mentees.find((m) => m.id === fd.get("mentee"));
  const stateEl = document.getElementById("cal-add-state");
  const btn = document.getElementById("cal-add-submit");
  if (!mentee) { stateEl.textContent = "Pick a mentee."; return; }
  btn.disabled = true;
  stateEl.textContent = "Logging…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/log-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menteeRecordId: mentee.id,
          mentorEmail: mentee.mentorEmail,
          sessionDate: fd.get("date"),
          nextSessionDate: fd.get("next") || "",
          notes: (fd.get("notes") || "").trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    closeModal();
    if (state.onAdded) state.onAdded();
  } catch (err) {
    stateEl.textContent = err.message || "Could not log — try again.";
    btn.disabled = false;
  }
}

function openModal(html) {
  document.getElementById("cal-modal-body").innerHTML = html;
  document.getElementById("cal-modal").hidden = false;
}
function closeModal() {
  document.getElementById("cal-modal").hidden = true;
}
