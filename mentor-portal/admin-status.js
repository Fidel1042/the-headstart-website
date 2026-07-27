// admin-status.js — Nudge / No sessions / Dropped / Active mentee groups, each
// a labelled list where the next session date can be booked per mentee.
// The writes behind Set and Drop live in admin-status-actions.js.

import { avgGapDays, fmtFrequency } from "./admin-utils.js";
import { configureActions, nextLabel, dropMentee, saveNextSession } from "./admin-status-actions.js";

const DAY_MS = 86400000;

let bound = false;

const fmtDate = (d) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
const daysSince = (d) => {
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t - new Date(d.slice(0, 10) + "T00:00:00")) / DAY_MS));
};
const sameMentee = (s, m) => (s.menteeId && s.menteeId === m.id) || s.mentee.trim().toLowerCase() === m.name.trim().toLowerCase();

// One compact row per mentee, so ~10 fit on screen without scrolling. A
// caret on the name expands the full session history below, kept as a plain
// toggle (not <details>) so clicking Set/Drop inside the row never also
// triggers the expand.
function item(m, tone) {
  const histId = `hist-${m.id}`;
  const freqLabel = fmtFrequency(m.frequency);
  return `
    <div class="status-mentee">
      <div class="status-row status-row--${tone}">
        <div class="status-row__who">
          <button type="button" class="status-row__toggle" data-id="${m.id}" aria-expanded="false" aria-controls="${histId}">
            <span class="status-row__caret" aria-hidden="true"></span>
            <span class="status-row__name">${m.name}</span>
          </button>
          <span class="status-row__mentor">${m.mentor}</span>
        </div>
        <div class="status-row__lastcol">
          <span class="status-row__last">${m.last ? `${fmtDate(m.last)} <span class="status-row__ago">· ${m.days}d</span>` : "No sessions yet"}</span>
          <span class="status-row__freq">${freqLabel || "&nbsp;"}</span>
        </div>
        <span class="status-row__fu" id="fu-label-${m.id}">${nextLabel(m)}</span>
        <div class="status-row__actions">
          <input type="date" class="fu-date" data-id="${m.id}" value="${(m.nextBooked || "").slice(0, 10)}" aria-label="Next session date for ${m.name}" />
          <button type="button" class="fu-save" data-id="${m.id}">Set</button>
          <button type="button" class="drop-btn" data-id="${m.id}" data-name="${m.name}">Drop</button>
          <span class="fu-state" id="fu-state-${m.id}"></span>
        </div>
      </div>
      <div class="status-history" id="${histId}" hidden>${historyList(m)}</div>
    </div>`;
}

// Column labels, so the row values are not four unlabelled pieces of text.
// The third column is the mentee's FIRST session in the "no sessions yet"
// group, which is the date Koko confirms and fills in there.
function headerRow(firstSession) {
  return `
    <div class="status-head">
      <span>Mentee</span>
      <span>Last session</span>
      <span>${firstSession ? "First session" : "Next session"}</span>
      <span class="status-head__actions">Book / drop</span>
    </div>`;
}

// Anyone still needing a date sorts above anyone already booked, so the top of
// each group is always the work left to do. A booking that has already passed
// counts as unbooked: the session never happened, so it still needs chasing.
function byUrgency(today) {
  const handled = (m) => (m.nextBooked && m.nextBooked >= today ? 1 : 0);
  return (a, b) => {
    if (handled(a) !== handled(b)) return handled(a) - handled(b);
    if ((a.days ?? -1) !== (b.days ?? -1)) return (b.days ?? -1) - (a.days ?? -1);
    return a.name.localeCompare(b.name);
  };
}

// Every logged session for this mentee, most recent first.
function historyList(m) {
  if (!m.sessionCount) return '<p class="status-history__empty">No sessions logged yet.</p>';
  const rows = m.sessionDates
    .slice().sort((a, b) => b.localeCompare(a))
    .map((d) => `<li>${fmtDate(d)}</li>`).join("");
  return `
    <p class="status-history__count">${m.sessionCount} session${m.sessionCount === 1 ? "" : "s"} total</p>
    <ul class="status-history__list">${rows}</ul>`;
}

function toggleHistory(btn) {
  const panel = document.getElementById(`hist-${btn.dataset.id}`);
  if (!panel) return;
  const open = panel.hidden;
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
}

// Active = session within 2 weeks, Nudge = 2–4 weeks, Dropped = 4+ weeks.
export function renderStatus({ mentees = [], allDelivered = [], rows = [], ownerEmail: email = "", onChanged = null } = {}) {
  const grid = document.getElementById("status-grid");
  if (!grid) return;

  const mentorName = new Map(rows.map((m) => [m.email, m.name]));
  configureActions({
    ownerEmail: email,
    onChanged,
    menteeIndex: new Map(mentees.map((m) => [m.id, m])),
  });

  const buckets = { active: [], nudge: [], dropped: [], none: [] };
  mentees.forEach((m) => {
    const mine = allDelivered.filter((s) => sameMentee(s, m)).sort((a, b) => b.date.localeCompare(a.date));
    const last = mine[0]?.date || "";
    const days = daysSince(last);
    const sessionDates = mine.map((s) => s.date);
    // A booking can come from the mentor (on a session row) or from Koko here.
    // Prefer the soonest still-upcoming date from either; if nothing is
    // upcoming, fall back to the latest past one so a missed booking shows.
    const booked = [...mine.map((s) => (s.next || "").slice(0, 10)), (m.nextSession || "").slice(0, 10)]
      .filter(Boolean).sort();
    const todayISO = new Date().toISOString().slice(0, 10);
    const upcoming = booked.filter((d) => d >= todayISO);
    const it = {
      ...m, last, days,
      nextBooked: upcoming[0] || booked[booked.length - 1] || "",
      mentor: mentorName.get(m.mentorEmail) || m.mentorEmail || "—",
      sessionCount: mine.length,
      sessionDates,
      // Ascending order for the gap calculation; sessionDates above stays
      // most-recent-first for the history list.
      frequency: avgGapDays([...sessionDates].sort()),
    };
    if (days === null) buckets.none.push(it);
    else if (days <= 14) buckets.active.push(it);
    else if (days <= 28) buckets.nudge.push(it);
    else buckets.dropped.push(it);
  });

  // Groups are ordered by how much they need doing something about, and only
  // the two that need action open on load. Active is the biggest group and the
  // one needing nothing, so leaving it expanded buried the rest.
  const today = new Date().toISOString().slice(0, 10);
  Object.values(buckets).forEach((list) => list.sort(byUrgency(today)));

  const col = (title, tone, items, open, firstSession = false) => `
    <details class="status-col"${open ? " open" : ""}>
      <summary class="status-col__title status-col__title--${tone}">
        <span>${title}</span>
        <span class="status-col__count">${items.length}</span>
      </summary>
      <div class="status-col__items">${
        items.length
          ? headerRow(firstSession) + items.map((m) => item(m, tone)).join("")
          : '<p class="status-empty">None</p>'
      }</div>
    </details>`;

  grid.innerHTML =
    col("Nudge", "warn", buckets.nudge, true) +
    (buckets.none.length ? col("No sessions yet", "muted", buckets.none, true, true) : "") +
    col("Dropped", "bad", buckets.dropped, false) +
    col("Active", "ok", buckets.active, false);

  if (!bound) {
    bound = true;
    grid.addEventListener("click", (e) => {
      const fu = e.target.closest(".fu-save");
      if (fu) { saveNextSession(fu.dataset.id, grid); return; }
      const drop = e.target.closest(".drop-btn");
      if (drop) { dropMentee(drop.dataset.id, drop.dataset.name, drop); return; }
      const toggle = e.target.closest(".status-row__toggle");
      if (toggle) toggleHistory(toggle);
    });
  }
}
