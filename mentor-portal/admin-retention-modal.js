// admin-retention-modal.js — the working behind a mentor's retention figure.
//
// A single percentage invites the wrong conversation, because it hides both
// how few mentees it is built on and who specifically dropped off. This lists
// every mentee, whether they counted, and why.

import { fmtDate, fmtFrequency } from "./admin-utils.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function close() {
  const el = document.getElementById("retention-modal");
  if (el) el.hidden = true;
}

function row(d, threshold) {
  if (!d.eligible) {
    return `
      <tr class="ret-row ret-row--new">
        <td>${esc(d.name)}</td>
        <td class="num">${d.sessions}</td>
        <td>${fmtDate(d.first)}</td>
        <td><span class="ret-tag ret-tag--new">Too new</span> <span class="ret-note">${d.age}d in, needs 30</span></td>
      </tr>`;
  }
  const tag = d.retained
    ? '<span class="ret-tag ret-tag--kept">Retained</span>'
    : '<span class="ret-tag ret-tag--lost">Not retained</span>';
  const note = d.retained
    ? (d.frequency !== null ? esc(fmtFrequency(d.frequency)) : "")
    : `stopped at ${d.sessions} of ${threshold}`;
  return `
    <tr class="ret-row">
      <td>${esc(d.name)}</td>
      <td class="num">${d.sessions}</td>
      <td>${fmtDate(d.first)}</td>
      <td>${tag} <span class="ret-note">${note}</span></td>
    </tr>`;
}

export function openRetention(p, threshold, graceDays) {
  const box = document.getElementById("retention-modal");
  const body = document.getElementById("retention-body");
  if (!box || !body) return;

  const counted = p.detail.filter((d) => d.eligible);
  const tooNew = p.detail.filter((d) => !d.eligible);
  const pct = p.retention === null ? null : Math.round(p.retention * 100);

  // A percentage off one or two people is noise, and saying so on the screen is
  // more useful than letting it be read as a real performance signal.
  const thin = counted.length > 0 && counted.length < 3;

  body.innerHTML = `
    <h3 class="chase-title">${esc(p.name)}</h3>
    <p class="ret-headline">${
      pct === null
        ? "Not enough history to judge yet"
        : `${pct}% retention <span class="ret-sub">${p.retained} of ${counted.length} mentees kept going</span>`
    }</p>

    ${thin ? `<p class="ret-warn">Based on only ${counted.length} mentee${counted.length === 1 ? "" : "s"}. Treat this as a hint, not a verdict.</p>` : ""}

    <p class="ret-rule">A mentee counts as retained once they have had <strong>${threshold} or more sessions</strong>.
    Anyone whose first session was less than <strong>${graceDays} days ago</strong> is left out entirely, since there
    has not been time to tell yet.</p>

    <div class="ret-scroll">
      <table class="ret-table">
        <thead>
          <tr><th>Mentee</th><th class="num">Sessions</th><th>First session</th><th>Counts as</th></tr>
        </thead>
        <tbody>
          ${counted.map((d) => row(d, threshold)).join("")}
          ${tooNew.map((d) => row(d, threshold)).join("")}
        </tbody>
      </table>
    </div>

    ${tooNew.length ? `<p class="ret-note ret-foot">${tooNew.length} mentee${tooNew.length === 1 ? " is" : "s are"} still inside the ${graceDays} day window and not counted either way.</p>` : ""}
    ${!p.detail.length ? '<p class="ret-note">No sessions logged for this mentor yet.</p>' : ""}`;

  box.hidden = false;
}

document.addEventListener("click", (e) => {
  if (e.target.id === "retention-modal" || e.target.id === "retention-close") close();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
