// journey-stages.js — turns raw records into the four stages of the journey.
//
// One stage per circle on the journey page. Kept apart from the fetching so
// the maths can be read, and argued with, without wading through API calls.

const DAY = 86400000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

// A "Package" row carrying money is the purchase itself, not a lesson.
const isLesson = (f) =>
  f["Date"] && !(f["Payment Status"] === "Package" && (parseFloat(f["Amount Charged"]) || 0) > 0);

/** Sessions grouped per mentee, dates sorted oldest first. */
function sessionsByMentee(sessionRecs) {
  const by = {};
  sessionRecs.filter((r) => isLesson(r.fields)).forEach((r) => {
    const f = r.fields;
    const key = f["Mentee Record ID"] || String(f["Mentee Name"] || "").trim().toLowerCase();
    if (!key) return;
    (by[key] = by[key] || []).push(String(f["Date"]).slice(0, 10));
  });
  Object.values(by).forEach((a) => a.sort());
  return by;
}

/** 1. Traffic. What GA4 saw before anybody spoke to us. */
function traffic(ga) {
  const leads = ga.events.find((e) => e.name === "generate_lead");
  const booked = ga.events.find((e) => e.name === "invitee_meeting_scheduled");
  return {
    key: "traffic",
    label: "Traffic",
    headline: ga.users ? `${ga.users} visitors` : "No GA4 data",
    sub: `${ga.sessions} sessions over ${ga.windowDays} days`,
    stats: [
      { label: "Visitors", value: ga.users },
      { label: "Sessions", value: ga.sessions },
      { label: "Signed up on site", value: leads ? leads.count : 0,
        note: ga.users ? `${pct(leads ? leads.count : 0, ga.users)}% of visitors` : "" },
      { label: "Booked a consultation", value: booked ? booked.count : 0 },
    ],
    // Where they came from, biggest first. This is the only place the site's
    // own attribution and the call outcomes sit side by side.
    table: {
      head: ["Source", "Visitors", "Sessions"],
      rows: ga.sources.slice(0, 8).map((s) => [s.source, s.users, s.sessions]),
    },
  };
}

/** 2. The call. Did the emails land, and did they turn up. */
function consultation(clients, email, today) {
  const past = clients.filter((c) => c.meeting && c.meeting < today);
  const noShow = past.filter((c) => c.pipeline === "No show");
  const showed = past.length - noShow.length;
  // A past call still sitting on "Initial Consultation Booked" was never moved
  // on. It is not a stage, it is a record nobody updated.
  const stale = past.filter((c) => c.pipeline === "Initial Consultation Booked");
  return {
    key: "consultation",
    label: "Consultation",
    headline: `${pct(showed, past.length)}% show rate`,
    sub: `${past.length} calls held, ${noShow.length} no-shows`,
    stats: [
      { label: "Consultations held", value: past.length },
      { label: "Showed up", value: showed, note: `${pct(showed, past.length)}%` },
      { label: "No-shows", value: noShow.length, note: `${pct(noShow.length, past.length)}%` },
      { label: "Never updated after the call", value: stale.length,
        note: stale.length ? "pipeline not moved on" : "", warn: stale.length > 0 },
    ],
    table: {
      head: ["Reminder email", "Sent", "Opened", "Proven"],
      rows: email.map((e) => [e.name, e.delivered, `${e.openRate}%`, `${e.provenRate}%`]),
      note: "Proven excludes opens that were only a mail-app pre-fetch.",
    },
  };
}

/** 3. The close. Signing, and how long the first session took to happen. */
function close(clients, byMentee, today) {
  const past = clients.filter((c) => c.meeting && c.meeting < today && c.pipeline !== "No show");
  const acquired = clients.filter((c) => c.pipeline === "Acquired");
  const waiting = clients.filter((c) => c.pipeline === "Waiting on Contract");
  const dropped = clients.filter((c) => c.pipeline === "Dropped");
  // Decided cases only: someone still waiting has not said no yet, and
  // counting them as a loss makes the close rate look worse than it is.
  const decided = acquired.length + dropped.length;

  const gaps = [];
  acquired.forEach((c) => {
    if (!c.meeting) return;
    const s = byMentee[c.id] || byMentee[c.name.trim().toLowerCase()];
    if (!s || !s.length) return;
    const g = days(c.meeting, s[0]);
    if (g >= -1 && g < 180) gaps.push(g);
  });

  return {
    key: "close",
    label: "Close",
    headline: `${pct(acquired.length, past.length)}% convert`,
    sub: gaps.length ? `${median(gaps)} days to the first session` : "No matched first sessions",
    stats: [
      { label: "Signed up", value: acquired.length },
      { label: "Still deciding", value: waiting.length },
      { label: "Said no", value: dropped.length },
      { label: "Close rate once decided", value: `${pct(acquired.length, decided)}%`,
        note: `${acquired.length} of ${decided}` },
      { label: "Median days to first session", value: median(gaps) ?? "—" },
      { label: "Slowest start", value: gaps.length ? `${Math.max(...gaps)} days` : "—" },
    ],
  };
}

/** 4. Continuity. Whether anybody stays past the first couple of sessions. */
function continuity(byMentee, target) {
  const counts = Object.values(byMentee).map((a) => a.length);
  const starters = counts.length;
  const reached = (n) => counts.filter((c) => c >= n).length;

  // Gap between consecutive sessions for the same mentee. Over 90 days is
  // somebody coming back, not a cadence.
  const gaps = [];
  Object.values(byMentee).forEach((dates) => {
    const u = [...new Set(dates)];
    for (let i = 1; i < u.length; i++) {
      const g = days(u[i - 1], u[i]);
      if (g > 0 && g <= 90) gaps.push(g);
    }
  });

  const total = counts.reduce((a, b) => a + b, 0);
  return {
    key: "continuity",
    label: "Continuity",
    headline: `${pct(reached(3), starters)}% reach 3+`,
    sub: `${total} sessions delivered across ${starters} mentees`,
    stats: [
      { label: "Mentees who started", value: starters },
      { label: "Sessions delivered", value: total },
      { label: "Median sessions each", value: median(counts) ?? 0 },
      { label: "Median days between sessions", value: median(gaps) ?? "—",
        note: `target ${target}` },
    ],
    table: {
      head: ["Milestone", "Mentees", "Share of starters"],
      rows: [2, 3, 5, 8, 12].map((n) =>
        [`${n}+ sessions`, reached(n), `${pct(reached(n), starters)}%`]),
      note: "The pitch says most people need 12 to 15 sessions to land a role.",
    },
  };
}

module.exports = { sessionsByMentee, traffic, consultation, close, continuity, ymd, pct };
