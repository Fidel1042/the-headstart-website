// admin-status.js — Active / Nudge / Dropped mentee columns with a
// "last followed up" date each owner can set from the page.

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

function item(m, tone) {
  return `
    <div class="status-item status-item--${tone}">
      <div class="status-item__head">
        <span class="status-item__name">${m.name}</span>
        <button type="button" class="drop-btn" data-id="${m.id}" data-name="${m.name}">Drop</button>
      </div>
      <span class="status-item__meta">${m.mentor}</span>
      <span class="status-item__meta">${m.last ? `${fmtDate(m.last)} · ${m.days}d ago` : "No sessions yet"}</span>
      <div class="fu-row">
        <span class="status-item__meta" id="fu-label-${m.id}">Last followed up: ${m.lastFollowUp ? fmtDate(m.lastFollowUp) : "never"}</span>
        <input type="date" class="fu-date" data-id="${m.id}" value="${(m.lastFollowUp || "").slice(0, 10)}" />
        <button type="button" class="fu-save" data-id="${m.id}">Set</button>
        <span class="fu-state" id="fu-state-${m.id}"></span>
      </div>
    </div>`;
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
    const it = { ...m, last, days, mentor: mentorName.get(m.mentorEmail) || m.mentorEmail || "—" };
    if (days === null) buckets.none.push(it);
    else if (days <= 14) buckets.active.push(it);
    else if (days <= 28) buckets.nudge.push(it);
    else buckets.dropped.push(it);
  });

  const col = (title, tone, items) => `
    <div class="status-col">
      <h3 class="status-col__title status-col__title--${tone}">${title} · ${items.length}</h3>
      <div class="status-col__items">${items.map((m) => item(m, tone)).join("") || '<p class="status-empty">None</p>'}</div>
    </div>`;

  grid.innerHTML =
    col("Active", "ok", buckets.active) +
    col("Nudge", "warn", buckets.nudge) +
    col("Dropped", "bad", buckets.dropped) +
    (buckets.none.length ? col("No sessions yet", "muted", buckets.none) : "");

  if (!bound) {
    bound = true;
    grid.addEventListener("click", (e) => {
      const fu = e.target.closest(".fu-save");
      if (fu) { saveFollowUp(fu.dataset.id, grid); return; }
      const drop = e.target.closest(".drop-btn");
      if (drop) dropMentee(drop.dataset.id, drop.dataset.name, drop);
    });
  }
}
