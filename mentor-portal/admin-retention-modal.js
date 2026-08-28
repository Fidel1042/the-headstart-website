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

/** The exclude / include control. Always present, so the choice is visible. */
function control(d) {
  return d.excluded
    ? `<button type="button" class="ret-btn ret-btn--undo" data-include="${esc(d.id)}"
         title="Count this mentee again">Count again</button>`
    : `<button type="button" class="ret-btn" data-exclude="${esc(d.id)}" data-name="${esc(d.name)}"
         title="Leave this mentee out of the retention figure">Exclude</button>`;
}

function row(d, threshold) {
  if (d.excluded) {
    return `
      <tr class="ret-row ret-row--out">
        <td>${esc(d.name)}</td>
        <td class="num">${d.sessions}</td>
        <td class="ret-date">${fmtDate(d.first)}</td>
        <td><span class="ret-tag ret-tag--out">Excluded</span>
            <span class="ret-note">${esc(d.excludeReason || "no reason given")}</span></td>
        <td class="ret-act">${control(d)}</td>
      </tr>`;
  }
  if (!d.eligible) {
    return `
      <tr class="ret-row ret-row--new">
        <td>${esc(d.name)}</td>
        <td class="num">${d.sessions}</td>
        <td class="ret-date">${fmtDate(d.first)}</td>
        <td><span class="ret-tag ret-tag--new">Too new</span> <span class="ret-note">${d.age}d in, needs 30</span></td>
        <td class="ret-act">${control(d)}</td>
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
      <td class="ret-date">${fmtDate(d.first)}</td>
      <td>${tag} <span class="ret-note">${note}</span></td>
      <td class="ret-act">${control(d)}</td>
    </tr>`;
}

// Set by admin.js so the modal can save and then refresh the page's numbers.
let ADMIN_EMAIL = "";
let ON_CHANGED = null;
export function initRetention({ ownerEmail, onChanged }) {
  ADMIN_EMAIL = ownerEmail || "";
  ON_CHANGED = onChanged || null;
}

async function save(menteeId, excluded, reason) {
  const res = await fetch("/.netlify/functions/retention-exclude", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ adminEmail: ADMIN_EMAIL, menteeId, excluded, reason }),
  });
  const text = await res.text();
  if (text.trim().startsWith("<")) {
    throw new Error("This needs the live site. Preview mode cannot run the function.");
  }
  const data = JSON.parse(text);
  if (!res.ok) throw new Error(data.error || "Could not save");
  return data;
}

export function openRetention(p, threshold, graceDays) {
  const box = document.getElementById("retention-modal");
  const body = document.getElementById("retention-body");
  if (!box || !body) return;

  const counted = p.detail.filter((d) => d.eligible);
  const tooNew = p.detail.filter((d) => !d.eligible && !d.excluded);
  const setAside = p.detail.filter((d) => d.excluded);
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

    ${setAside.length ? `<p class="ret-warn">${setAside.length} mentee${setAside.length === 1 ? " has been" : "s have been"} excluded by hand and left out of this figure. They are listed at the bottom with the reason.</p>` : ""}
    ${thin ? `<p class="ret-warn">Based on only ${counted.length} mentee${counted.length === 1 ? "" : "s"}. Treat this as a hint, not a verdict.</p>` : ""}

    <p class="ret-rule">A mentee counts as retained once they have had <strong>${threshold} or more sessions</strong>.
    Anyone whose first session was less than <strong>${graceDays} days ago</strong> is left out entirely, since there
    has not been time to tell yet.</p>

    <div class="ret-scroll">
      <table class="ret-table">
        <thead>
          <tr><th>Mentee</th><th class="num">Sessions</th><th>First session</th><th>Counts as</th><th></th></tr>
        </thead>
        <tbody>
          ${counted.map((d) => row(d, threshold)).join("")}
          ${tooNew.map((d) => row(d, threshold)).join("")}
          ${setAside.map((d) => row(d, threshold)).join("")}
        </tbody>
      </table>
    </div>

    ${tooNew.length ? `<p class="ret-note ret-foot">${tooNew.length} mentee${tooNew.length === 1 ? " is" : "s are"} still inside the ${graceDays} day window and not counted either way.</p>` : ""}
    ${!p.detail.length ? '<p class="ret-note">No sessions logged for this mentor yet.</p>' : ""}`;

  box.hidden = false;
}

document.addEventListener("click", async (e) => {
  if (e.target.id === "retention-modal" || e.target.id === "retention-close") { close(); return; }

  const out = e.target.closest("[data-exclude]");
  if (out) {
    // A prompt rather than a silent toggle: the reason is required by the
    // function anyway, and asking for it here is what stops this becoming a
    // way to quietly delete inconvenient mentees.
    const reason = window.prompt(`Why is ${out.dataset.name} being left out of retention?\n\ne.g. moved home, ran out of money, one-off arrangement`);
    if (reason === null) return;
    if (!reason.trim()) { window.alert("A reason is required."); return; }
    out.disabled = true; out.textContent = "Saving…";
    try { await save(out.dataset.exclude, true, reason.trim()); close(); if (ON_CHANGED) ON_CHANGED(); }
    catch (err) { out.disabled = false; out.textContent = "Exclude"; window.alert(err.message); }
    return;
  }

  const back = e.target.closest("[data-include]");
  if (back) {
    back.disabled = true; back.textContent = "Saving…";
    try { await save(back.dataset.include, false, ""); close(); if (ON_CHANGED) ON_CHANGED(); }
    catch (err) { back.disabled = false; back.textContent = "Count again"; window.alert(err.message); }
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
