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

/**
 * "I have nudged the mentor about this one." Parks it for a few days so the
 * list stops showing work already in flight, without pretending a session is
 * booked. mentee-state.js decides how long the quiet period lasts.
 */
export async function markChased(ids, grid) {
  // Takes one id or a list: "Mark done" on a mentor's chase bar covers every
  // mentee that message was about, because one message settles all of them.
  const list = Array.isArray(ids) ? ids : [ids];
  const btn = grid.querySelector(`.chase-btn[data-id="${list[0]}"]`)
    || grid.querySelector(`.chase-done[data-ids="${list.join(",")}"]`);
  const stateEl = document.getElementById(`fu-state-${list[0]}`);
  const original = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    if (!isLocal) {
      for (const id of list) {
        const res = await fetch("/.netlify/functions/admin-update", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "mentee-chased", recordId: id, ownerEmail }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
    }
    if (onChangedCb) onChangedCb();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = original; }
    if (stateEl) stateEl.textContent = err.message || "Could not save";
  }
}

/**
 * Park or unpark from the row itself, so moving a mentee between sections is
 * one click rather than opening the expand panel and editing a date.
 */
export async function setHold(id, holdUntil, grid) {
  const stateEl = document.getElementById(`fu-state-${id}`);
  const btn = grid.querySelector(`.hold-btn[data-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "mentee-hold", recordId: id, holdUntil, ownerEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    if (onChangedCb) onChangedCb();
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = holdUntil ? "Hold" : "Clear hold"; }
    if (stateEl) stateEl.textContent = err.message || "Could not save";
  }
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
    stateEl.textContent = "Saved";
    // A new date changes which group they belong to, so the list is rebuilt
    // rather than nudged in place.
    if (onChangedCb) { onChangedCb(); return; }
  } catch (err) {
    stateEl.textContent = err.message || "Could not save";
  }
  btn.disabled = false;
}

// Saves the working notes and the park-until date together. Putting a mentee on
// hold moves them between groups, so a hold change triggers a full reload; a
// notes-only edit does not, since nothing about the list changes.
export async function saveNotes(id, grid) {
  const box = grid.querySelector(`.status-notes__box[data-id="${id}"]`);
  const date = grid.querySelector(`.hold-date[data-id="${id}"]`);
  const stateEl = document.getElementById(`notes-state-${id}`);
  const btn = grid.querySelector(`.notes-save[data-id="${id}"]`);
  if (!box) return;
  const m = menteeIndex.get(id);
  const holdChanged = (m?.holdUntil || "") !== (date?.value || "");
  btn.disabled = true;
  stateEl.textContent = "Saving…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "mentee-notes", recordId: id, ownerEmail,
          notes: box.value, holdUntil: date?.value || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
    }
    if (m) { m.adminNotes = box.value; m.holdUntil = date?.value || ""; }
    if (holdChanged && onChangedCb) { onChangedCb(); return; }
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
