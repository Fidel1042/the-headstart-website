// mentee-dashboard.js — renders the "Mentee info" cards on the portal home:
// session stats, cadence colour-coding, school/year, recommended structure,
// and a free-flow notes box that saves back to Airtable.

const DAY_MS = 86400000;
const PACKAGE_TOTAL = 5;
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

let boundEvents = false;
let currentMentorEmail = "";

function daysSince(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - d) / DAY_MS));
}

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function fmtShort(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Matches what the Monday nudge email does, so a mentor and the admin list
// never disagree about who needs chasing:
//   on hold          parked deliberately, nobody should be chasing
//   something booked not overdue, whatever the gap since the last session
//   15+ days         the same threshold as REACH_OUT_DAYS in session-reminders
function cadence(days, next, holdUntil) {
  const today = new Date().toISOString().slice(0, 10);
  if (holdUntil && holdUntil >= today) return { tone: "", label: "On hold" };
  if (days === null) return { tone: "", label: "No sessions yet" };
  if (next && next >= today) return { tone: "ok", label: "Booked" };
  if (days <= 7)  return { tone: "ok",   label: "On track" };
  if (days <= 14) return { tone: "warn", label: "Follow up" };
  return { tone: "bad", label: "Overdue" };
}

function statsFor(mentee, sessions) {
  const key = mentee.name.trim().toLowerCase();
  const mine = sessions.filter((s) =>
    (s.menteeId && s.menteeId === mentee.id) ||
    (!s.menteeId && (s.mentee || "").trim().toLowerCase() === key)
  );
  const last = mine.reduce((acc, s) => (s.date > acc ? s.date : acc), "");
  const today = new Date().toISOString().slice(0, 10);
  // A date Koko set on the mentee record counts the same as one a mentor
  // logged, so both are folded together before picking the soonest upcoming.
  let next = mine.reduce((acc, s) => {
    const n = (s.next || "").slice(0, 10);
    return n >= today && (n < acc || !acc) ? n : acc;
  }, "");
  const admin = mentee.nextSession || "";
  if (admin >= today && (!next || admin < next)) next = admin;
  return { count: mine.length, last, next, days: daysSince(last), holdUntil: mentee.holdUntil || "" };
}

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function card(mentee, s) {
  const pill = cadence(s.days, s.next, s.holdUntil);
  const isPackage = mentee.billingType === "Package";
  const sessions = isPackage ? `${s.count}/${PACKAGE_TOTAL} sessions` : `${s.count} session${s.count === 1 ? "" : "s"}`;
  const daysTxt = s.days === null ? "no sessions" : `${s.days}d since`;
  // On hold says when it lifts, since "no next date" would read as neglect.
  const nextTxt = s.holdUntil && s.holdUntil >= new Date().toISOString().slice(0, 10)
    ? `on hold to ${fmtShort(s.holdUntil)}`
    : (s.next ? `next ${fmtShort(s.next)}` : "no next date");
  return `
    <article class="mentee-card">
      <div class="mentee-card__head">
        <h3 class="mentee-card__name">${esc(mentee.name)}</h3>
        <span class="status-pill ${pill.tone ? "status-pill--" + pill.tone : ""}">${pill.label}</span>
      </div>
      <p class="mentee-card__line">${sessions} <span class="sep">&middot;</span> <span class="${pill.tone ? "tone-" + pill.tone : ""}">${daysTxt}</span> <span class="sep">&middot;</span> ${nextTxt}</p>
      <details class="mentee-card__more">
        <summary>Details</summary>
        <div class="mentee-detail">
          <div class="info-row"><span class="info-row__label">Billing</span><span class="info-row__val">${isPackage ? `Package ${s.count}/${PACKAGE_TOTAL}` : "Per session"}</span></div>
          <div class="info-row"><span class="info-row__label">Last session</span><span class="info-row__val">${s.last ? fmtDate(s.last) : "—"}</span></div>
          <div class="info-row"><span class="info-row__label">Next session</span><span class="info-row__val">${s.next ? fmtDate(s.next) : "Not booked"}</span></div>
          <div class="info-row"><span class="info-row__label">Target industry</span><span class="info-row__val">${esc(mentee.industry) || "—"}</span></div>
          <div class="info-row"><span class="info-row__label">Major</span><span class="info-row__val">${esc(mentee.major) || "—"}</span></div>
          <div class="info-row"><span class="info-row__label">Year</span><span class="info-row__val">${esc(mentee.year) || "—"}</span></div>
          <div class="mentee-detail__block">
            <span class="info-row__label">Recommended structure</span>
            <p class="mentee-card__plan">${esc(mentee.plan) || "—"}</p>
          </div>
          <div class="mentee-detail__block">
            <span class="info-row__label">Notes</span>
            <textarea class="mentee-notes" data-id="${mentee.id}" rows="3">${esc(mentee.notes)}</textarea>
            <div class="mentee-notes__row">
              <button type="button" class="mentee-notes__save" data-id="${mentee.id}">Save</button>
              <span class="mentee-notes__state" data-state="${mentee.id}"></span>
            </div>
          </div>
        </div>
      </details>
    </article>`;
}

async function saveNotes(id, grid) {
  const textarea = grid.querySelector(`.mentee-notes[data-id="${id}"]`);
  const stateEl = grid.querySelector(`[data-state="${id}"]`);
  const btn = grid.querySelector(`.mentee-notes__save[data-id="${id}"]`);
  if (!textarea) return;
  btn.disabled = true;
  stateEl.textContent = "Saving…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/save-mentee-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ menteeRecordId: id, mentorEmail: currentMentorEmail, notes: textarea.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    stateEl.textContent = "Saved";
    setTimeout(() => { stateEl.textContent = ""; }, 3000);
  } catch (err) {
    stateEl.textContent = err.message || "Could not save — try again";
  }
  btn.disabled = false;
}

/** Render the dashboard. Safe to call repeatedly (e.g. after logging a session). */
export function renderMenteeDashboard({ mentees = [], sessions = [], mentorEmail = "" } = {}) {
  const grid = document.getElementById("mentee-grid");
  if (!grid) return;
  if (mentorEmail) currentMentorEmail = mentorEmail;

  if (!mentees.length) { grid.innerHTML = '<p class="history-none">No mentees yet.</p>'; return; }

  // Re-renders happen after logging a session — keep any unsaved notes text
  // and open/closed state so the mentor doesn't lose what they were typing.
  const draftNotes = {};
  grid.querySelectorAll(".mentee-notes").forEach((t) => { draftNotes[t.dataset.id] = t.value; });
  const openDetails = new Set();
  grid.querySelectorAll(".mentee-card").forEach((c) => {
    const id = c.querySelector(".mentee-notes")?.dataset.id;
    c.querySelectorAll("details").forEach((d, i) => { if (d.open && id) openDetails.add(id + ":" + i); });
  });

  const rows = mentees
    .map((m) => ({ m, s: statsFor(m, sessions) }))
    // Most-neglected first so "who do I need to chase" is answered at a glance.
    .sort((a, b) => (b.s.days ?? Infinity) - (a.s.days ?? Infinity));

  grid.innerHTML = rows.map(({ m, s }) => card(m, s)).join("");

  grid.querySelectorAll(".mentee-notes").forEach((t) => {
    if (draftNotes[t.dataset.id] !== undefined) t.value = draftNotes[t.dataset.id];
  });
  grid.querySelectorAll(".mentee-card").forEach((c) => {
    const id = c.querySelector(".mentee-notes")?.dataset.id;
    c.querySelectorAll("details").forEach((d, i) => { if (id && openDetails.has(id + ":" + i)) d.open = true; });
  });

  if (!boundEvents) {
    boundEvents = true;
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".mentee-notes__save");
      if (btn) saveNotes(btn.dataset.id, grid);
    });
  }
}
