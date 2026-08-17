// admin-status.js — the mentee status list, grouped by what needs doing:
//   Session did not happen  an agreed date passed with nothing logged
//   No next session agreed  nothing in the diary
//   On hold / Booked        nothing to do
// The state itself is decided by netlify/shared/mentee-state.js and arrives on
// each mentee; this file only renders it. The writes behind Set date, Chased,
// Hold and Drop live in admin-status-actions.js.

import { avgGapDays, fmtFrequency } from "./admin-utils.js";
import { configureActions, dropMentee, saveNextSession, saveNotes, markChased, setHold } from "./admin-status-actions.js";

const DAY_MS = 86400000;

// A hold parks someone for three weeks unless a different date is picked. Long
// enough that the mentee has actually had time, short enough that nobody goes
// quiet for a month without Fidel seeing them again.
const HOLD_DEFAULT_DAYS = 21;
const addDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

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
          <span class="status-row__mentor">${m.mentor}${
            m.holdUntil && m.holdUntil >= new Date().toISOString().slice(0, 10)
              ? ` <span class="status-row__hold">on hold to ${fmtDate(m.holdUntil)}</span>` : ""
          }</span>
        </div>
        <div class="status-row__lastcol">
          <span class="status-row__last">${m.last ? `${fmtDate(m.last)} <span class="status-row__ago">· ${m.days}d</span>` : "No sessions yet"}</span>
          <span class="status-row__freq">${freqLabel || "&nbsp;"}</span>
        </div>
        <span class="status-row__fu" id="fu-label-${m.id}">${stateLabel(m)}</span>
        <div class="status-row__actions">
          <input type="date" class="fu-date" data-id="${m.id}" value="${(m.nextSession || "").slice(0, 10)}" aria-label="Next session date for ${m.name}" />
          <button type="button" class="fu-save" data-id="${m.id}">Set date</button>
          ${m.state && m.state.needsAction
            ? `<button type="button" class="chase-btn" data-id="${m.id}">Chased</button>` : ""}
          ${m.state && m.state.key === "hold"
            ? `<button type="button" class="hold-btn" data-id="${m.id}" data-hold="">Clear hold</button>`
            : `<button type="button" class="hold-btn" data-id="${m.id}" data-hold="${addDays(HOLD_DEFAULT_DAYS)}">Hold</button>`}
          <button type="button" class="drop-btn" data-id="${m.id}" data-name="${m.name}">Drop</button>
          <span class="fu-state" id="fu-state-${m.id}"></span>
        </div>
      </div>
      <div class="status-history" id="${histId}" hidden>${notesPanel(m)}${historyList(m)}</div>
    </div>`;
}

// Notes and the park-until date, tucked inside the expand so the row itself
// stays one line. Both save together on one button.
function notesPanel(m) {
  return `
    <div class="status-notes">
      <textarea class="status-notes__box" data-id="${m.id}" rows="2"
        placeholder="Notes: what you've tried, what they said…"
        aria-label="Notes for ${m.name}">${escapeText(m.adminNotes || "")}</textarea>
      <div class="status-notes__row">
        <label class="status-notes__hold">
          <span>Hold until</span>
          <!-- Empty means not on hold. The 3-week button fills it in one click. -->
          <input type="date" class="hold-date" data-id="${m.id}" value="${m.holdUntil || ""}" aria-label="Hold ${m.name} until" />
        </label>
        <button type="button" class="fu-save hold-quick" data-id="${m.id}">Hold 3 weeks</button>
        <button type="button" class="fu-save notes-save" data-id="${m.id}">Save</button>
        <span class="fu-state" id="notes-state-${m.id}"></span>
      </div>
    </div>`;
}

// Notes are free text going straight into a textarea, so a stray "</textarea>"
// would break out of the element and eat the rest of the row.
const escapeText = (s) => String(s || "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// What the middle column says, straight from the resolved state. "Missed 3 Aug,
// 14 days ago" is a different instruction from "no date agreed", and the row has
// to say which.
function stateLabel(m) {
  const st = m.state;
  if (!st) return "&mdash;";
  if (st.key === "booked") return fmtDate(st.date);
  if (st.key === "hold") return `<span class="status-row__hold">On hold to ${fmtDate(st.until)}</span>`;
  if (st.key === "lapsed") {
    const rep = st.lapses > 1 ? ` <span class="status-row__reps">${st.lapses}x</span>` : "";
    const chased = st.chasedOn && !st.needsAction ? ` <span class="status-row__ago">chased ${fmtDate(st.chasedOn)}</span>` : "";
    return `<span class="status-row__stale">Missed ${fmtDate(st.date)}</span>${rep}${chased}`;
  }
  return `<span class="status-row__ago">No date agreed</span>`;
}

// One message per mentor, covering every lapsed mentee they have, because
// three separate WhatsApps about three mentees is how a mentor starts ignoring
// them. One mentee reads as a sentence; several read as a list, because a
// sentence with four names and four dates in it cannot be skimmed.
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

function chaseMessage(list) {
  const due = (m) => m.state && m.state.date ? `due at ${fmtShort(m.state.date)}` : "no date set";

  if (list.length === 1) {
    const m = list[0];
    return `Checking on ${firstName(m.name)}'s status!\n\n` +
      `Saw a session ${due(m)} but looks like it wasn't logged.\n\n` +
      `Could you help me follow up with this please?`;
  }

  const lines = list.map((m) => `- ${firstName(m.name)} - ${due(m)}`).join("\n");
  return `Checking on these mentees' status!\n\n${lines}\n\n` +
    `Looks like the sessions weren't logged.\n\n` +
    `Could you help me follow up with these please?`;
}

const fmtShort = (d) => d
  ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })
  : "";

// The per-mentor action bar that sits above the lapsed rows.
function chaseBar(mentorName, list, phone) {
  const msg = chaseMessage(list);
  const ids = list.map((m) => m.id).join(",");
  const link = phone
    ? `<a class="chase-send" href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Send message</a>`
    : `<span class="chase-send is-off" title="No usable phone number for this mentor in Airtable">No number</span>`;
  return `
    <div class="chase-bar">
      <span class="chase-bar__who">${mentorName}<span class="chase-bar__count">${list.length}</span></span>
      <span class="chase-bar__msg">${escapeText(msg).replace(/\n+/g, " ")}</span>
      ${link}
      <button type="button" class="chase-done" data-ids="${ids}">Mark done</button>
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

// Four states, resolved server-side by mentee-state.js and only rendered here.
export function renderStatus({ mentees = [], allDelivered = [], rows = [], ownerEmail: email = "", onChanged = null } = {}) {
  const grid = document.getElementById("status-grid");
  if (!grid) return;

  const mentorName = new Map(rows.map((m) => [m.email, m.name]));
  const phoneFor = new Map(rows.map((m) => [m.name, m.phone || ""]));
  configureActions({
    ownerEmail: email,
    onChanged,
    menteeIndex: new Map(mentees.map((m) => [m.id, m])),
  });

  const buckets = { lapsed: [], nodate: [], booked: [], hold: [] };
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
    // The state was decided server-side by mentee-state.js. Re-deriving it here
    // from day counts is exactly what made this page and the Monday email
    // disagree, so the page now only renders the verdict it was given.
    const key = it.state ? it.state.key : "nodate";
    (buckets[key] || buckets.nodate).push(it);
  });

  // Repeat offenders first, then longest overdue: the top of the list is
  // always the one that has been ignored most.
  buckets.lapsed.sort((a, b) => (b.state.lapses - a.state.lapses) || (b.state.days - a.state.days));
  buckets.nodate.sort((a, b) => (b.days ?? -1) - (a.days ?? -1));
  buckets.booked.sort((a, b) => (a.state.date || "").localeCompare(b.state.date || ""));
  buckets.hold.sort((a, b) => (a.holdUntil || "").localeCompare(b.holdUntil || ""));

  // A chase bar per mentor above whichever group is being chased.
  const chaseBars = (bucket) => {
    const byMentor = new Map();
    bucket.filter((m) => m.state.needsAction).forEach((m) => {
      const key = m.mentor || "Unassigned";
      if (!byMentor.has(key)) byMentor.set(key, []);
      byMentor.get(key).push(m);
    });
    if (!byMentor.size) return "";
    return [...byMentor.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([name, list]) => chaseBar(name, list, phoneFor.get(name) || ""))
      .join("");
  };

  const col = (title, tone, items, open, firstSession = false, prefix = "") => `
    <details class="status-col"${open ? " open" : ""}>
      <summary class="status-col__title status-col__title--${tone}">
        <span>${title}</span>
        <span class="status-col__count">${items.length}</span>
      </summary>
      ${prefix || ""}
      <div class="status-col__items">${
        items.length
          ? headerRow(firstSession) + items.map((m) => item(m, tone)).join("")
          : '<p class="status-empty">None</p>'
      }</div>
    </details>`;

  // On hold sorts by when the hold runs out, soonest first, so the top of that
  // list is who comes back to you next.
  buckets.hold.sort((a, b) => (a.holdUntil || "").localeCompare(b.holdUntil || ""));

  grid.innerHTML =
    col("Session did not happen", "warn", buckets.lapsed, true, false, chaseBars(buckets.lapsed)) +
    col("No next session agreed", "bad", buckets.nodate, true, false, chaseBars(buckets.nodate)) +
    (buckets.hold.length ? col("On hold", "muted", buckets.hold, false) : "") +
    col("Booked", "ok", buckets.booked, false);

  if (!bound) {
    bound = true;
    grid.addEventListener("click", (e) => {
      // Checked before .fu-save: the notes button carries both classes so it
      // picks up the same styling, and would otherwise book a session instead.
      // Three weeks is the standing default for a hold, so the common case is
      // one click. The date picker beside it is the override.
      const quick = e.target.closest(".hold-quick");
      if (quick) {
        const box = grid.querySelector(`.hold-date[data-id="${quick.dataset.id}"]`);
        if (box) box.value = addDays(HOLD_DEFAULT_DAYS);
        saveNotes(quick.dataset.id, grid);
        return;
      }
      const notes = e.target.closest(".notes-save");
      if (notes) { saveNotes(notes.dataset.id, grid); return; }
      const fu = e.target.closest(".fu-save");
      if (fu) { saveNextSession(fu.dataset.id, grid); return; }
      const drop = e.target.closest(".drop-btn");
      if (drop) { dropMentee(drop.dataset.id, drop.dataset.name, drop); return; }
      const chase = e.target.closest(".chase-btn");
      if (chase) { markChased(chase.dataset.id, grid); return; }
      const done = e.target.closest(".chase-done");
      if (done) { markChased(done.dataset.ids.split(","), grid); return; }
      const hold = e.target.closest(".hold-btn");
      if (hold) { setHold(hold.dataset.id, hold.dataset.hold || null, grid); return; }
      const toggle = e.target.closest(".status-row__toggle");
      if (toggle) toggleHistory(toggle);
    });
  }
}
