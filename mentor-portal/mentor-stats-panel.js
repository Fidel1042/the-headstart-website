// mentor-stats-panel.js — the mentor's own numbers, shown under the log form.
//
// It sits on the Log tab deliberately. A separate stats page is a page nobody
// opens; the point of this is that a mentor sees where they stand every time
// they log a session, at the moment they are already thinking about it.

const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

let DATA = null;
let METRIC = "earnings";

const money = (n) => "$" + Math.round(n).toLocaleString("en-AU");
const monthLabel = (k) => new Date(k + "-01T00:00:00").toLocaleDateString("en-AU", { month: "short" });
const esc = (v) => String(v == null ? "" : v)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MOCK = {
  months: [
    { month: "2026-03", sessions: 2, earnings: 40, mentees: 2, perStudent: 1 },
    { month: "2026-04", sessions: 5, earnings: 100, mentees: 3, perStudent: 1.7 },
    { month: "2026-05", sessions: 4, earnings: 80, mentees: 3, perStudent: 1.3 },
    { month: "2026-06", sessions: 9, earnings: 180, mentees: 4, perStudent: 2.3 },
    { month: "2026-07", sessions: 14, earnings: 280, mentees: 5, perStudent: 2.8 },
    { month: "2026-08", sessions: 6, earnings: 120, mentees: 4, perStudent: 1.5 },
  ],
  totals: { sessions: 40, earnings: 800 },
  gap: 9.4, allMentorGap: 10.7, targetGap: 7,
  mentees: [
    { name: "Vikrant Date", sessions: 3, gap: 15, last: "2026-07-29", since: 16 },
    { name: "Nikhil Gupta", sessions: 4, gap: 9, last: "2026-08-05", since: 9 },
    { name: "Ahmed Ali", sessions: 3, gap: 4, last: "2026-08-12", since: 2 },
  ],
  upside: { extraSessions: 11, extraEarnings: 220 },
};

export async function renderMentorStats(mentorEmail) {
  const root = document.getElementById("stats-root");
  if (!root || !mentorEmail) return;

  try {
    if (isLocal) {
      DATA = MOCK;
    } else {
      const res = await fetch("/.netlify/functions/mentor-stats", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mentorEmail }),
      });
      DATA = await res.json();
      if (!res.ok) throw new Error(DATA.error || "Could not load");
    }
  } catch {
    // Stats are a nice-to-have under a form that must always work, so a failure
    // here stays silent rather than putting an error above the log button.
    root.hidden = true;
    return;
  }

  if (!DATA.totals || !DATA.totals.sessions) { root.hidden = true; return; }
  draw();
  root.hidden = false;
}

function draw() {
  const now = DATA.months[DATA.months.length - 1];
  const prev = DATA.months[DATA.months.length - 2] || { sessions: 0, earnings: 0 };
  const delta = (a, b) => {
    if (!b) return a ? "first month with any" : "";
    const pct = Math.round(((a - b) / b) * 100);
    return `${pct >= 0 ? "up" : "down"} ${Math.abs(pct)}% on last month`;
  };

  document.getElementById("stats-tiles").innerHTML = [
    ["This month", money(now.earnings), delta(now.earnings, prev.earnings)],
    ["Sessions", String(now.sessions), delta(now.sessions, prev.sessions)],
    ["Mentees seen", String(now.mentees), `${now.perStudent} each on average`],
    ["Last 6 months", money(DATA.totals.earnings), `${DATA.totals.sessions} sessions`],
  ].map(([l, v, s]) => `
    <div class="tile">
      <span class="tile__label">${l}</span>
      <span class="tile__val">${v}</span>
      <span class="tile__sub">${s}</span>
    </div>`).join("");

  drawBars();
  drawCadence();
  drawMentees();
}

function drawBars() {
  const max = Math.max(...DATA.months.map((m) => m[METRIC]), 1);
  const fmt = (v) => METRIC === "earnings" ? money(v) : String(v);
  document.getElementById("stats-bars").innerHTML = DATA.months.map((m, i) => {
    const h = Math.round((m[METRIC] / max) * 100);
    const isNow = i === DATA.months.length - 1;
    return `
      <div class="bar-col${isNow ? " bar-col--now" : ""}" title="${monthLabel(m.month)}: ${fmt(m[METRIC])}">
        <span class="bar-val">${m[METRIC] ? fmt(m[METRIC]) : ""}</span>
        <div class="bar" style="height:${Math.max(h, m[METRIC] ? 4 : 0)}%"></div>
        <span class="bar-label">${monthLabel(m.month)}</span>
      </div>`;
  }).join("");
}

function drawCadence() {
  const { gap, targetGap: target, upside: up } = DATA;
  const box = document.getElementById("stats-cadence");
  if (gap === null || gap === undefined) {
    box.innerHTML = `<span class="tile__label">Your cadence</span>
      <p class="cadence__note">Log a couple more sessions with the same mentee and this will show how often you are seeing them.</p>`;
    return;
  }
  // Shorter is better, so the bar fills as the gap closes on the target.
  const pct = Math.max(6, Math.min(100, Math.round((target / gap) * 100)));
  box.innerHTML = `
    <span class="tile__label">Your cadence</span>
    <div class="cadence__row">
      <span class="cadence__big">${gap}</span>
      <span class="cadence__unit">days between each mentee's sessions</span>
    </div>
    <div class="track"><div class="track__fill" style="width:${pct}%"></div></div>
    <div class="track-ends"><span>You: ${gap} days</span><span>Target: ${target} days</span></div>
    <p class="cadence__note">
      ${gap <= target
        ? `You are at the target. Weekly is what keeps mentees moving, and it is what pays.`
        : `Seeing each mentee <strong>weekly</strong> instead of every ${gap} days is the biggest lever on what you earn.` +
          (up ? ` At that pace this month you would be on <strong>${up.extraSessions} more sessions</strong>, about <strong>${money(up.extraEarnings)}</strong>.` : "")}
    </p>`;
}

// The cadence number alone changes nothing. This turns it into a list of names,
// worst first, so the next session to book is obvious.
function drawMentees() {
  const list = (DATA.mentees || []).filter((m) => m.sessions > 0);
  const card = document.getElementById("stats-mentees-card");
  if (!list.length) { card.hidden = true; return; }
  const target = DATA.targetGap;

  document.getElementById("stats-mentees").innerHTML = list.map((m) => {
    const good = m.gap !== null && m.gap <= target;
    const pct = m.gap === null ? 0 : Math.max(6, Math.min(100, Math.round((target / m.gap) * 100)));
    const late = m.since > target * 1.5;
    return `
      <div class="mrow${good ? " mrow--good" : ""}">
        <span class="mrow__name">${esc(m.name)}</span>
        <span class="mrow__gap">${m.gap === null ? "&mdash;" : m.gap + "d"}</span>
        <span class="mrow__bar"><span class="mrow__fill" style="width:${pct}%"></span></span>
        <span class="mrow__since${late ? " is-late" : ""}">${m.since}d ago</span>
      </div>`;
  }).join("");
  card.hidden = false;
}

document.addEventListener("click", (e) => {
  const tab = e.target.closest(".chart-tab");
  if (!tab || !DATA) return;
  METRIC = tab.dataset.metric;
  document.querySelectorAll(".chart-tab").forEach((t) => t.classList.toggle("is-on", t === tab));
  drawBars();
});
