// admin-status.js — Active / Nudge / Dropped mentee columns with a
// "last followed up" date each owner can set from the page.

import { avgGapDays, fmtFrequency } from "./admin-utils.js";

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const DAY_MS = 86400000;

let bound = false;
let ownerEmail = "";
let onChangedCb = null;
let menteeIndex = new Map(); // id → mentee (for updating lastFollowUp in place)

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
          <span class="status-row__freq">${freqLabel ? `${freqLabel} apart` : "&nbsp;"}</span>
        </div>
        <span class="status-row__fu" id="fu-label-${m.id}">${m.lastFollowUp ? "Followed up " + fmtDate(m.lastFollowUp) : "Not followed up"}</span>
        <div class="status-row__actions">
          <input type="date" class="fu-date" data-id="${m.id}" value="${(m.lastFollowUp || "").slice(0, 10)}" aria-label="Last followed up date for ${m.name}" />
          <button type="button" class="fu-save" data-id="${m.id}">Set</button>
          <button type="button" class="drop-btn" data-id="${m.id}" data-name="${m.name}">Drop</button>
          <span class="fu-state" id="fu-state-${m.id}"></span>
        </div>
      </div>
      <div class="status-history" id="${histId}" hidden>${historyList(m)}</div>
    </div>`;
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

async function dropMentee(id, name, btn) {
  // Setting Client Pipeline = "Dropped" removes them from every acquired count.
  if (!window.confirm(`Mark ${name} as Dropped? They'll leave the mentee lists and counts.`)) return;
  btn.disabled = true;
  btn.textContent = "Dropping…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "mentee-dropped", recordId: id, ownerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    if (onChangedCb) onChangedCb();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Drop";
    window.alert(err.message || "Could not update — try again.");
  }
}

async function saveFollowUp(id, grid) {
  const input = grid.querySelector(`.fu-date[data-id="${id}"]`);
  const stateEl = document.getElementById(`fu-state-${id}`);
  const btn = grid.querySelector(`.fu-save[data-id="${id}"]`);
  if (!input || !input.value) { stateEl.textContent = "Pick a date first."; return; }
  btn.disabled = true;
  stateEl.textContent = "Saving…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "mentee-followup", recordId: id, date: input.value, ownerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    const m = menteeIndex.get(id);
    if (m) m.lastFollowUp = input.value;
    document.getElementById(`fu-label-${id}`).textContent = `Last followed up: ${fmtDate(input.value)}`;
    stateEl.textContent = "Saved";
    setTimeout(() => { stateEl.textContent = ""; }, 3000);
  } catch (err) {
    stateEl.textContent = err.message || "Could not save";
  }
  btn.disabled = false;
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
  if (email) ownerEmail = email;
  if (onChanged) onChangedCb = onChanged;
  const grid = document.getElementById("status-grid");
  if (!grid) return;

  const mentorName = new Map(rows.map((m) => [m.email, m.name]));
  menteeIndex = new Map(mentees.map((m) => [m.id, m]));

  const buckets = { active: [], nudge: [], dropped: [], none: [] };
  mentees.forEach((m) => {
    const mine = allDelivered.filter((s) => sameMentee(s, m)).sort((a, b) => b.date.localeCompare(a.date));
    const last = mine[0]?.date || "";
    const days = daysSince(last);
    const sessionDates = mine.map((s) => s.date);
    const it = {
      ...m, last, days,
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
  const col = (title, tone, items, open) => `
    <details class="status-col"${open ? " open" : ""}>
      <summary class="status-col__title status-col__title--${tone}">
        <span>${title}</span>
        <span class="status-col__count">${items.length}</span>
      </summary>
      <div class="status-col__items">${items.map((m) => item(m, tone)).join("") || '<p class="status-empty">None</p>'}</div>
    </details>`;

  grid.innerHTML =
    col("Nudge", "warn", buckets.nudge, true) +
    (buckets.none.length ? col("No sessions yet", "muted", buckets.none, true) : "") +
    col("Dropped", "bad", buckets.dropped, false) +
    col("Active", "ok", buckets.active, false);

  if (!bound) {
    bound = true;
    grid.addEventListener("click", (e) => {
      const fu = e.target.closest(".fu-save");
      if (fu) { saveFollowUp(fu.dataset.id, grid); return; }
      const drop = e.target.closest(".drop-btn");
      if (drop) { dropMentee(drop.dataset.id, drop.dataset.name, drop); return; }
      const toggle = e.target.closest(".status-row__toggle");
      if (toggle) toggleHistory(toggle);
    });
  }
}
