// admin-calendar-modal.js — detail popup + manual "add session" form used by
// the calendar. Split out of admin-calendar.js to stay under the 250-line cap.

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

const fmtDate = (d) => d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
const fmtMoney = (n) => "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function openModal(html) {
  document.getElementById("cal-modal-body").innerHTML = html;
  document.getElementById("cal-modal").hidden = false;
}

export function closeModal() {
  document.getElementById("cal-modal").hidden = true;
}

// ── Detail popup ──
function menteeFor(state, s) {
  return state.mentees.find((m) => (s.menteeId && m.id === s.menteeId) || m.name.trim().toLowerCase() === s.mentee.trim().toLowerCase());
}

export function showDetail(state, { type, s }) {
  const mentor = state.names.get(s.mentorEmail) || s.mentorName || s.mentorEmail;
  const billing = menteeFor(state, s)?.billingType || "—";
  const rows = type === "booked"
    ? [["Mentee", esc(s.mentee)], ["Mentor", esc(mentor)], ["Booked for", fmtDate(s.next)], ["Status", "Not logged yet"], ["Payment type", esc(billing)]]
    : [["Mentee", esc(s.mentee)], ["Mentor", esc(mentor)], ["Date", fmtDate(s.date)], ["Session fee", fmtMoney(s.amountDue)], ["Payment status", esc(s.status)], ["Payment type", esc(billing)]];
  openModal(`
    <h3 class="cal-modal__title">${type === "booked" ? "Booked session" : "Logged session"}</h3>
    ${rows.map(([l, v]) => `<div class="cal-modal__row"><span>${l}</span><span>${v}</span></div>`).join("")}`);
}

// ── Manual add ──
export function showAddForm(state) {
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
  document.getElementById("cal-add-form").addEventListener("submit", (e) => submitAdd(e, state));
}

async function submitAdd(e, state) {
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
