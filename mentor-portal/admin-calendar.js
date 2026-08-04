// admin-calendar.js — monthly session calendar, colour-coded per mentor.
// Chips open a detail popup; "+ Add session" logs a session via log-session.
// Detail popup and add-session form live in admin-calendar-modal.js.

import { showDetail, showAddForm, closeModal } from "./admin-calendar-modal.js";

const PALETTE = ["#4caf81", "#5b9bd5", "#e0a030", "#c96fc0", "#e05050", "#4fc3c3", "#a3d977", "#f0c75c", "#8f7be8", "#e08c5a"];

let month = null;
let state = null; // { byDate, upcoming, colors, names, mentees, registry, onAdded }
let bound = false;
let filterEmail = "";      // "" = all mentors; otherwise show only this mentor
let menteeColors = new Map(); // mentee key -> colour, when a mentor is selected

// Key by the displayed name, not the record id: some session rows carry a
// Mentee Record ID and some are blank, so keying by id would give one person
// two colours. The chip shows the name, so same name must mean same colour.
const menteeKey = (s) => (s.mentee || "").trim().toLowerCase() || s.menteeId;

// When one mentor is selected, each of their mentees gets its own colour so
// the month reads as "who this mentor is seeing", not "which mentor".
function buildMenteeColors(email) {
  const m = new Map();
  if (!email) return m;
  state.registry.forEach(({ s }) => {
    if (s.mentorEmail !== email) return;
    const k = menteeKey(s);
    if (k && !m.has(k)) m.set(k, PALETTE[m.size % PALETTE.length]);
  });
  return m;
}

// [menteeName, colour] pairs for the selected mentor's legend, in the same
// order colours were assigned.
function nameForMentees() {
  const label = new Map();
  state.registry.forEach(({ s }) => {
    if (s.mentorEmail !== filterEmail) return;
    const k = menteeKey(s);
    if (k && !label.has(k)) label.set(k, s.mentee || k);
  });
  return [...menteeColors.entries()].map(([k, c]) => [label.get(k) || k, c]);
}

function populateFilter() {
  const sel = document.getElementById("cal-filter");
  const list = document.getElementById("cal-mentor-names");
  if (!sel) return;
  const mentors = [...state.names.entries()].sort((a, b) => (a[1] || "").localeCompare(b[1] || ""));
  sel.innerHTML = '<option value="">All mentors</option>' +
    mentors.map(([email, name]) =>
      `<option value="${esc(email)}"${email === filterEmail ? " selected" : ""}>${esc(name || email)}</option>`).join("");
  if (list) {
    list.innerHTML = mentors.map(([, name]) => `<option value="${esc(name || "")}"></option>`).join("");
  }
  const search = document.getElementById("cal-search");
  if (search) search.value = filterEmail ? (state.names.get(filterEmail) || "") : "";
}

// Applies a mentor filter from either control and keeps both in sync, so the
// dropdown and the search box always agree on who is selected.
function setFilter(email) {
  filterEmail = email;
  menteeColors = buildMenteeColors(filterEmail);
  const sel = document.getElementById("cal-filter");
  const search = document.getElementById("cal-search");
  if (sel) sel.value = filterEmail;
  if (search) search.value = filterEmail ? (state.names.get(filterEmail) || "") : "";
  draw();
}

// Resolve typed text to a mentor: exact name match first (picking a datalist
// suggestion, or a name that happens to be unambiguous), otherwise the single
// mentor whose name contains the text. Ambiguous or empty text clears the
// filter rather than guessing, so it never silently locks onto the wrong person.
function matchMentorByName(text) {
  const q = text.trim().toLowerCase();
  if (!q) return "";
  const all = [...state.names.entries()];
  const exact = all.find(([, name]) => (name || "").trim().toLowerCase() === q);
  if (exact) return exact[0];
  const partial = all.filter(([, name]) => (name || "").toLowerCase().includes(q));
  return partial.length === 1 ? partial[0][0] : null; // null = no unique match yet
}

const pad = (n) => String(n).padStart(2, "0");
const key = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtDate = (d) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtMoney = (n) => "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function initCalendar({ sessions = [], mentors = [], mentees = [], onAdded = null, ownerEmail = "" } = {}) {
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

  state = { byDate, upcoming, colors, names, mentees, registry, onAdded, ownerEmail };
  if (!month) { month = new Date(); month.setDate(1); }
  // A mentor filtered before a refresh may no longer have data; fall back to all.
  if (filterEmail && !colors.has(filterEmail)) filterEmail = "";
  menteeColors = buildMenteeColors(filterEmail);
  populateFilter();

  if (!bound) {
    bound = true;
    document.getElementById("cal-prev").addEventListener("click", () => { month.setMonth(month.getMonth() - 1); draw(); });
    document.getElementById("cal-next").addEventListener("click", () => { month.setMonth(month.getMonth() + 1); draw(); });
    document.getElementById("cal-today").addEventListener("click", () => { month = new Date(); month.setDate(1); draw(); });
    document.getElementById("cal-filter").addEventListener("change", (e) => setFilter(e.target.value));
    document.getElementById("cal-search").addEventListener("input", (e) => {
      const match = matchMentorByName(e.target.value);
      // A non-null result (including "") is a resolved choice, apply it. `null`
      // means the text is ambiguous or matches nobody yet, so leave the
      // calendar as-is and let the user keep typing rather than flicker.
      // The search box's own value is never rewritten here, otherwise typing a
      // partial name would get overwritten mid-keystroke.
      if (match !== null) {
        filterEmail = match;
        menteeColors = buildMenteeColors(filterEmail);
        const sel = document.getElementById("cal-filter");
        if (sel) sel.value = filterEmail;
        draw();
      }
    });
    document.getElementById("cal-add").addEventListener("click", () => showAddForm(state));
    document.getElementById("cal-modal-close").addEventListener("click", closeModal);
    document.getElementById("cal-modal").addEventListener("click", (e) => { if (e.target.id === "cal-modal") closeModal(); });
    document.getElementById("cal-grid").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-k]");
      if (chip) showDetail(state, state.registry[Number(chip.dataset.k)]);
    });
  }
  draw();
}

function chip(entry, dashed) {
  const { k, s } = entry;
  // When a mentor is selected, hide everyone else and colour by mentee instead.
  if (filterEmail && s.mentorEmail !== filterEmail) return "";
  const c = filterEmail
    ? (menteeColors.get(menteeKey(s)) || "#888")
    : (state.colors.get(s.mentorEmail) || "#888");
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

  // The legend only earns its place when one mentor is selected, where the
  // colours mean something specific: which mentee is which. Across all mentors
  // it was a wall of names nobody reads, so it is not drawn at all.
  const legend = document.getElementById("cal-legend");
  legend.innerHTML = filterEmail
    ? nameForMentees()
        .map(([label, c]) => `<span class="cal-legend__item"><span class="cal-swatch" style="--c:${c}"></span>${esc(label)}</span>`)
        .join("") +
      `<span class="cal-legend__item"><span class="cal-swatch cal-swatch--next"></span>Booked (not logged yet)</span>`
    : "";
}

