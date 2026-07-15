// session-history.js — "Session history" section: current week open,
// previous weeks behind a dropdown, plus a full-history toggle.

let selectedWeek = "";
let showFull = false;
let bound = false;
let latestSessions = [];

const fmtDate = (d) => d
  ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
  : "—";

// Monday of the week containing the given date (en-AU weeks run Mon–Sun).
function weekStart(dateStr) {
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  if (isNaN(d)) return "";
  const day = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - day);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function table(rows) {
  if (!rows.length) return '<p class="history-none">No sessions logged this week yet.</p>';
  const body = rows.map((s) => {
    const safe = ["Charged", "Pending", "Failed", "Package"].includes(s.status) ? s.status : "";
    return `<tr>
      <td>${fmtDate(s.date)}</td>
      <td class="mentee">${s.mentee}</td>
      <td><span class="status-pill status-${safe}">${s.status}</span></td>
    </tr>`;
  }).join("");
  return `<div class="history-wrap"><table class="history-table">
    <thead><tr><th>Date</th><th>Mentee</th><th>Status</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function weekBlock(label, rows) {
  return `<div class="history-week"><h3 class="history-week__title">${label}</h3>${table(rows)}</div>`;
}

export function renderSessionHistory({ sessions = [], error = "" } = {}) {
  const root = document.getElementById("history-root");
  if (!root) return;

  if (error) {
    root.innerHTML = `<p class="history-none">${error}</p>`;
    return;
  }
  latestSessions = sessions;

  // Group by week, newest week first; sessions within a week newest first.
  const byWeek = new Map();
  [...sessions]
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
    .forEach((s) => {
      const w = weekStart(s.date || "");
      if (!w) return;
      if (!byWeek.has(w)) byWeek.set(w, []);
      byWeek.get(w).push(s);
    });

  const thisWeek = weekStart(new Date().toISOString());
  const currentRows = byWeek.get(thisWeek) || [];
  const pastWeeks = [...byWeek.keys()].filter((w) => w !== thisWeek);

  const options = ['<option value="">Previous weeks&hellip;</option>']
    .concat(pastWeeks.map((w) =>
      `<option value="${w}"${w === selectedWeek ? " selected" : ""}>WC ${fmtDate(w)} &middot; ${byWeek.get(w).length} session${byWeek.get(w).length === 1 ? "" : "s"}</option>`))
    .join("");

  const pickedHTML = (!showFull && selectedWeek && byWeek.has(selectedWeek))
    ? weekBlock(`WC ${fmtDate(selectedWeek)}`, byWeek.get(selectedWeek))
    : "";

  const fullHTML = showFull
    ? [...byWeek.keys()].map((w) =>
        weekBlock(w === thisWeek ? `This week &middot; WC ${fmtDate(w)}` : `WC ${fmtDate(w)}`, byWeek.get(w))
      ).join("")
    : "";

  root.innerHTML = `
    ${showFull ? "" : weekBlock(`This week &middot; WC ${fmtDate(thisWeek)}`, currentRows)}
    <div class="history-controls">
      ${pastWeeks.length && !showFull ? `<select class="history-select" id="history-week-select">${options}</select>` : ""}
      ${byWeek.size ? `<button type="button" class="history-toggle" id="history-full-btn">${showFull ? "Back to weekly view" : "Show full history"}</button>` : ""}
    </div>
    ${pickedHTML}
    ${fullHTML}`;

  if (!bound) {
    bound = true;
    root.addEventListener("change", (e) => {
      if (e.target.id === "history-week-select") {
        selectedWeek = e.target.value;
        renderSessionHistory({ sessions: latestSessions });
      }
    });
    root.addEventListener("click", (e) => {
      if (e.target.id === "history-full-btn") {
        showFull = !showFull;
        renderSessionHistory({ sessions: latestSessions });
      }
    });
  }
}
