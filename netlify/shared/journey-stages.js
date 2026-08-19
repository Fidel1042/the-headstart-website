// journey-stages.js — turns raw records into the four stages of the journey.
//
// One stage per circle on the journey page. Kept apart from the fetching so
// the maths can be read, and argued with, without wading through API calls.

// The first consultation with a recorded transcript. Before this, Fathom was
// not running, so a missing transcript says nothing about whether the call
// happened and every rate built on it would be wrong.
const TRANSCRIPT_ERA_START = "2026-06-17";

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

/**
 * Split past calls in two. The transcript is the source of truth: Fathom
 * records every call that happens, so no transcript means nobody turned up.
 * The "No show" pipeline value is only a manual label on top of that, and it
 * was not applied at all before the no-show email automation went in, so it
 * cannot be the test.
 *
 * This is the same rule as the Airtable "Showed Up Rate" formula, which reads
 * IF(TRIM({Raw Notes}) = "", 0, 1).
 */
function splitCalls(clients, today) {
  const past = clients.filter((c) =>
    c.meeting && c.meeting < today && c.meeting >= TRANSCRIPT_ERA_START);
  const showed = past.filter((c) => c.transcript);
  const noShow = past.filter((c) => !c.transcript);
  // Marked by hand as well as missing a transcript. The two agree, so this is
  // only here to show how much of the no-show pile has been worked through.
  const flagged = noShow.filter((c) => c.pipeline === "No show");
  return { past, showed, noShow, flagged };
}

/** Show rate per month, so one bad month cannot hide inside the average. */
function monthlyShowRate(past) {
  const m = {};
  past.forEach((c) => {
    const k = c.meeting.slice(0, 7);
    m[k] = m[k] || { held: 0, showed: 0 };
    m[k].held += 1;
    if (c.transcript) m[k].showed += 1;
  });
  return Object.keys(m).sort().map((k) => [k, m[k].held, m[k].showed, `${pct(m[k].showed, m[k].held)}%`]);
}

/** 2. The call. Did the emails land, and did they turn up. */
function consultation(clients, email, today) {
  const { past, showed, noShow, flagged } = splitCalls(clients, today);
  return {
    key: "consultation",
    label: "Consultation",
    headline: `${pct(showed.length, past.length)}% show rate`,
    sub: `${past.length} calls booked, ${noShow.length} did not turn up`,
    stats: [
      { label: "Calls booked", value: past.length },
      { label: "Showed up", value: showed.length, note: "transcript recorded" },
      { label: "No-shows", value: noShow.length, note: `${pct(noShow.length, past.length)}% of bookings`,
        warn: pct(noShow.length, past.length) >= 25 },
      { label: "No-shows marked in Airtable", value: flagged.length,
        note: flagged.length < noShow.length ? `${noShow.length - flagged.length} never labelled` : "all labelled" },
    ],
    table: {
      head: ["Month", "Booked", "Showed", "Show rate"],
      rows: monthlyShowRate(past),
      note: `A call with no transcript is a no-show: Fathom records every call that happens. ` +
        `Counted from ${TRANSCRIPT_ERA_START}, the first call with a recorded transcript. ` +
        `Reminder emails: ` + (email.length
          ? email.map((e) => `${e.name} ${e.openRate}% opened (${e.provenRate}% proven)`).join(", ")
          : "no Brevo data") + ".",
    },
  };
}

/** 3. The close. Signing, and how long the first session took to happen. */
function close(clients, byMentee, today) {
  // Only people who actually had the call can be closed, which is the same
  // denominator as the Airtable Close Rate formula.
  const { showed } = splitCalls(clients, today);
  const acquired = showed.filter((c) => c.pipeline === "Acquired");
  const waiting = showed.filter((c) => c.pipeline === "Waiting on Contract");
  const dropped = showed.filter((c) => c.pipeline === "Dropped");
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
    headline: `${pct(acquired.length, showed.length)}% convert`,
    sub: gaps.length ? `${median(gaps)} days to the first session` : "No matched first sessions",
    stats: [
      { label: "Signed up", value: acquired.length },
      { label: "Still deciding", value: waiting.length },
      { label: "Said no", value: dropped.length },
      { label: "Close rate", value: `${pct(acquired.length, showed.length)}%`,
        note: `${acquired.length} of ${showed.length} who showed` },
      { label: "Close rate once decided", value: `${pct(acquired.length, decided)}%`,
        note: `${acquired.length} of ${decided}, ignoring the undecided` },
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

module.exports = {
  sessionsByMentee, traffic, consultation, close, continuity, ymd, pct,
  TRANSCRIPT_ERA_START,
};
