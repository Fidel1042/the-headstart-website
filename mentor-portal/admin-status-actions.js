// admin-status-actions.js — the writes behind the mentee status list: booking a
// next session and dropping a mentee, plus the label and row move that follow.
// Split out of admin-status.js to stay under the 250-line file cap.

import { fmtDate } from "./admin-utils.js";

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

// Set once per render so the handlers below do not need it threaded through
// every call site.
let ownerEmail = "";
let onChangedCb = null;
let menteeIndex = new Map();

export function configureActions({ ownerEmail: email, onChanged, menteeIndex: index }) {
  if (email) ownerEmail = email;
  if (onChanged) onChangedCb = onChanged;
  if (index) menteeIndex = index;
}

// A booked date that has already passed means no session was ever logged
// against it, so it reads as something to chase rather than a live booking.
export function nextLabel(m) {
  if (!m.nextBooked) return "Nothing booked";
  const today = new Date().toISOString().slice(0, 10);
  if (m.nextBooked >= today) return fmtDate(m.nextBooked);
  const tip = `Booked for ${fmtDate(m.nextBooked)} but no session was logged. Rebook, or ask the mentor to log it.`;
  return `<span class="status-row__stale" title="${tip}">Missed ${fmtDate(m.nextBooked)}</span>`;
}

export async function dropMentee(id, name, btn) {
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

// Books the mentee's next session. Recorded on the mentee record, and read
// everywhere a mentor-logged next session is read (calendar, reminders), so a
// booking made here behaves the same as one a mentor logged.
export async function saveNextSession(id, grid) {
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
        body: JSON.stringify({ kind: "mentee-next-session", recordId: id, date: input.value, ownerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    const m = menteeIndex.get(id);
    if (m) m.nextSession = input.value;
    document.getElementById(`fu-label-${id}`).innerHTML = nextLabel({ nextBooked: input.value });
    // Booking someone takes them out of the work pile, so drop them to the
    // bottom of their group straight away rather than only on the next load.
    // A past date is not a live booking, so that stays put and keeps chasing.
    if (input.value >= new Date().toISOString().slice(0, 10)) moveToBottom(id, grid);
    stateEl.textContent = "Saved";
    setTimeout(() => { stateEl.textContent = ""; }, 3000);
  } catch (err) {
    stateEl.textContent = err.message || "Could not save";
  }
  btn.disabled = false;
}

// Re-homes a mentee at the end of their group. Moving the wrapper keeps the row
// and its history panel together, and the header stays first because it is a
// sibling that is never moved.
function moveToBottom(id, grid) {
  const row = grid.querySelector(`.status-row__toggle[data-id="${id}"]`)?.closest(".status-mentee");
  if (!row || !row.parentElement) return;
  row.parentElement.appendChild(row);
  // Brief highlight so the jump is traceable: without it a row can silently
  // relocate past the fold and look like it vanished.
  row.classList.add("is-moved");
  setTimeout(() => row.classList.remove("is-moved"), 1200);
}
