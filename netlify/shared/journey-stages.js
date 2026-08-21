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

/**
 * GA4 hands back dozens of raw source strings for what are really a handful of
 * places. "ig", "instagram.com", "l.instagram.com" and "instagram_bio" are all
 * Instagram. Group them, or the table is a list of spellings rather than an
 * answer.
 */
const SOURCE_GROUPS = [
  ["Instagram", /instagram|^ig$/i],
  ["LinkedIn", /linkedin|lnkd\.in/i],
  ["Email", /sendib|brevo|mail\.google/i],
  ["Search", /^google|bing|duckduckgo|chatgpt|perplexity/i],
  ["Direct", /^\(direct\)|^\(not set\)|^\(data not available\)/i],
];
function groupSource(raw) {
  const s = String(raw || "(direct)");
  const hit = SOURCE_GROUPS.find(([, re]) => re.test(s));
  return hit ? hit[0] : "Other";
}

/** 1. Traffic. What GA4 saw before anybody spoke to us. */
/**
 * Stage zero: how many people saw the content at all.
 *
 * Sits before Traffic because the journey does not start at the website, it
 * starts on a feed. Impressions come from the platform export (LinkedIn has
 * no API for a personal profile), so this stage goes quiet rather than
 * guessing when the import is stale.
 *
 * The click rate is the honest read on whether content moved anyone. A big
 * reach week with a tiny click rate usually means there was no link in the
 * caption, which is a choice rather than a failure.
 */
function reach(stats, ga, igPosts, from, to) {
  // Both bounds, not just a start: without an upper bound "the previous 28
  // days" would return exactly the same impressions as the current 28.
  const inWindow = (d) => d && d >= from && (!to || d < to);
  const sum = (channel) => {
    const weeks = (stats || {})[channel] || {};
    return Object.entries(weeks)
      .filter(([monday]) => inWindow(monday))
      .reduce((a, [, w]) => a + (w.impressions || 0), 0);
  };
  const li = sum("linkedin");
  const ig = sum("instagram");
  const total = li + ig;

  // Visits for the same channels, so the click rate compares like with like.
  const visitsFor = (names) => (ga && ga.sources ? ga.sources : [])
    .filter((s) => names.some((n) => String(s.source || "").toLowerCase().includes(n)))
    .reduce((a, s) => a + s.users, 0);
  const liVisits = visitsFor(["linkedin", "lnkd"]);
  const igVisits = visitsFor(["instagram", "ig"]);
  const visits = liVisits + igVisits;

  // Only count visits from channels whose reach we actually have. Dividing
  // every social visit by LinkedIn-only impressions would overstate the rate
  // for as long as Instagram reach is missing.
  const measuredVisits = (li ? liVisits : 0) + (ig ? igVisits : 0);

  const rate = (v, i) => (i ? `${(v / i * 100).toFixed(2)}%` : "—");
  const top = topPosts(stats, igPosts, from, to);

  return {
    key: "reach",
    label: "Reach",
    raw: { impressions: total, visits },
    headline: total ? `${total.toLocaleString()} impressions` : "No reach imported",
    sub: total
      ? `${rate(measuredVisits, total)} of them came to the site` +
        (ig ? "" : ", LinkedIn only until Instagram reach is entered")
      : "Run import-channel-stats.py after a LinkedIn export",
    unavailable: !total,
    stats: [
      { label: "LinkedIn reach", value: li, note: li ? `${liVisits} visits, ${rate(liVisits, li)}` : "not imported" },
      { label: "Instagram reach", value: ig, note: ig ? `${igVisits} visits, ${rate(igVisits, ig)}` : "entered by hand, not yet in" },
      { label: "Visits from social", value: visits },
    ],
    tables: total ? [
      {
        title: "Reach to visits",
        head: ["Channel", "Impressions", "Visits", "Click rate"],
        rows: [
          li ? ["LinkedIn", li, liVisits, rate(liVisits, li)] : null,
          ig ? ["Instagram", ig, igVisits, rate(igVisits, ig)] : null,
        ].filter(Boolean),
      },
      // What actually earned the reach, five per platform. Merging them would
      // be almost all Instagram, which out-reaches LinkedIn several times
      // over, and the best LinkedIn post would never appear.
      ...(top.li.length ? [{
        title: "Top LinkedIn posts",
        head: ["Post", "Impressions", "Engagements"],
        rows: top.li,
      }] : []),
      // For Instagram, profile visits beat raw reach as a signal: it is the
      // step immediately before someone taps the bio link, and it does not
      // track reach at all.
      ...(top.ig.length ? [{
        title: "Top Instagram posts",
        head: ["Post", "Reach", "Profile visits"],
        rows: top.ig,
      }] : []),
    ] : [],
    notes: total ? [
      "Impressions are imported from the platform export, not live. Re-run the importer for fresh numbers.",
      "A low click rate with high reach usually means no link in the caption.",
    ] : [],
  };
}

/** Top five per platform, kept apart so neither hides the other. */
function topPosts(stats, igPosts, from, to) {
  const inWindow = (d) => d && d >= from && (!to || d < to);

  const ig = Object.values(igPosts || {})
    .filter((p) => inWindow(p.date))
    .sort((a, b) => (b.reach || 0) - (a.reach || 0))
    .slice(0, 5)
    .map((p) => [
      (p.caption || "(no caption)").slice(0, 46),
      p.reach || 0,
      p.profile_visits == null ? "—" : p.profile_visits,
    ]);

  const li = Object.values((stats || {}).posts_linkedin || {})
    .filter((p) => inWindow(p.date))
    .sort((a, b) => (b.impressions || 0) - (a.impressions || 0))
    .slice(0, 5)
    .map((p) => [
      // The LinkedIn export carries no post text, so the title comes from the
      // matching draft in the repo. A tilde means it was paired by order
      // within the week rather than by an exact day: a good guess, not a fact.
      (p.title || `post ${p.date}`) + (p.title_approx ? " ~" : ""),
      p.impressions || 0,
      p.engagements || 0,
    ]);

  return { ig, li };
}

function traffic(ga) {
  // People, not fires. The Calendly embed raises its event several times per
  // booking, so the raw count reads about five times the truth.
  const people = (name) => {
    const e = ga.events.find((x) => x.name === name);
    return e ? e.users : 0;
  };
  const booked = people("invitee_meeting_scheduled");
  const signups = ga.signups || [];
  const totalSignups = signups.reduce((a, d) => a + d.people, 0);
  const find = (k) => (signups.find((d) => d.key === k) || {}).people || 0;
  const freeCall = signups.find((d) => d.key === "free_call") || {};

  const grouped = {};
  ga.sources.forEach((s) => {
    const g = groupSource(s.source);
    grouped[g] = grouped[g] || { users: 0, sessions: 0 };
    grouped[g].users += s.users;
    grouped[g].sessions += s.sessions;
  });
  // Share is against the grouped total, not the visitor count. One person who
  // arrives from Instagram and later from LinkedIn is counted by GA4 under
  // both, so measuring against visitors makes the column add up to over 100%.
  const totalGrouped = Object.values(grouped).reduce((a, v) => a + v.users, 0);
  const rows = Object.entries(grouped)
    .sort((a, b) => b[1].users - a[1].users)
    .map(([g, v]) => [g, v.users, `${pct(v.users, totalGrouped)}%`]);

  return {
    key: "traffic",
    label: "Traffic",
    raw: { visitors: ga.users, signups: totalSignups, booked },
    headline: ga.users ? `${ga.users} visitors` : "No GA4 data",
    sub: `${ga.sessions} sessions over ${ga.windowDays} days`,
    stats: [
      { label: "Visitors", value: ga.users },
      { label: "Sessions", value: ga.sessions },
      // A rate only when the funnel runs the right way. More bookings than
      // site-form submits is not a 130% conversion, it means people are
      // reaching Calendly by a route that skips the form, so say that instead
      // of printing a percentage that cannot be true.
      { label: "Free call booked", value: booked,
        note: !freeCall.started ? ""
          : booked <= freeCall.started
            ? `${pct(booked, freeCall.started)}% of the ${freeCall.started} who filled the form`
            : `${booked - freeCall.started} booked without the site form`,
        warn: freeCall.started > 0 && booked > freeCall.started * 1.5 },
      { label: "Lead magnet", value: find("audit"), note: "job search audit" },
      { label: "Job alerts", value: find("job_alerts"), note: "signed up for the list" },
    ],
    // Two tables: where they came from, and what they signed up to.
    tables: [
      {
        title: "Where signups went",
        head: ["Destination", "People", "Share"],
        rows: signups
          .sort((a, b) => b.people - a.people)
          .map((d) => [d.label, d.people, `${pct(d.people, totalSignups)}%`])
          .concat([["Total", totalSignups, "100%"]]),
        note: "Allocated by the page the signup finished on, not by form tag: two thirds of " +
          "lead events carry no form tag, and custom tags never apply to past data.",
      },
      {
        title: "Where they came from",
        head: ["Source", "Visitors", "Share"],
        rows,
        note: "Counted as people, not clicks. Someone arriving from two channels is " +
          "counted under both, so the rows total slightly more than the visitor count.",
      },
    ],
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
function splitCalls(clients, today, from) {
  // Never reach back past the transcript era, whatever window is asked for:
  // before it, a missing transcript means nothing.
  const floor = from > TRANSCRIPT_ERA_START ? from : TRANSCRIPT_ERA_START;
  const past = clients.filter((c) =>
    c.meeting && c.meeting < today && c.meeting >= floor);
  const showed = past.filter((c) => c.transcript);
  const noShow = past.filter((c) => !c.transcript);
  // Marked by hand as well as missing a transcript. The two agree, so this is
  // only here to show how much of the no-show pile has been worked through.
  const flagged = noShow.filter((c) => c.pipeline === "No show");
  return { past, showed, noShow, flagged };
}

/**
 * A click is the only signal Apple's pre-fetching cannot fake, so a nil says
 * something worth saying rather than being left as a bare zero.
 */
function clickNote(email) {
  if (!email.length) return "";
  const withLinks = email.filter((e) => e.clicked > 0);
  if (withLinks.length === email.length) return "Every one carries a tracked link.";
  const dead = email.filter((e) => !e.clicked).map((e) => e.name);
  return `No clicks recorded on ${dead.join(", ")}. Brevo only counts a click on a real ` +
    `<a> link, so a bare URL in a plain-text email registers nothing. A click is the one ` +
    `signal a mail app cannot fake, so an email with no tracked link cannot be measured properly.`;
}

/** Show rate per month, so one bad month cannot hide inside the average. */
function monthlyShowRate(past, today) {
  // Months are useless on a 7-day window, so bucket by week when the span is
  // short enough that a month would be one row.
  const span = past.length ? days([...past].sort((a, b) => a.meeting.localeCompare(b.meeting))[0].meeting, today) : 0;
  const weekly = span <= 45;
  const m = {};
  past.forEach((c) => {
    const d = new Date(c.meeting + "T00:00:00Z");
    const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const k = weekly ? ymd(monday) : c.meeting.slice(0, 7);
    m[k] = m[k] || { held: 0, showed: 0 };
    m[k].held += 1;
    if (c.transcript) m[k].showed += 1;
  });
  return Object.keys(m).sort().map((k) => [k, m[k].held, m[k].showed, `${pct(m[k].showed, m[k].held)}%`]);
}

/** 2. The call. Did the emails land, and did they turn up. */
function consultation(clients, email, today, from) {
  const { past, showed, noShow, flagged } = splitCalls(clients, today, from);
  return {
    key: "consultation",
    label: "Consultation",
    raw: { booked: past.length, showed: showed.length },
    headline: `${pct(showed.length, past.length)}% show rate`,
    sub: `${past.length} calls booked, ${noShow.length} did not turn up`,
    stats: [
      { label: "Calls booked", value: past.length },
      { label: "Showed up", value: showed.length, note: "transcript recorded" },
      { label: "No-shows", value: noShow.length, note: `${pct(noShow.length, past.length)}% of bookings`,
        warn: pct(noShow.length, past.length) >= 25, lowerIsBetter: true },
    ],
    tables: [
      {
        title: "Show rate over time",
        head: [past.length && days(past[0].meeting, today) <= 45 ? "Week of" : "Month",
               "Booked", "Showed", "Show rate"],
        rows: monthlyShowRate(past, today),
        note: `A call with no transcript is a no-show: Fathom records every call that happens. ` +
          `Counted from ${TRANSCRIPT_ERA_START}, the first call with a recorded transcript.`,
      },
    ],
  };
}

/** 3. The close. Signing, and how long the first session took to happen. */
function close(clients, byMentee, today, from) {
  // Only people who actually had the call can be closed, which is the same
  // denominator as the Airtable Close Rate formula.
  const { showed } = splitCalls(clients, today, from);
  const acquired = showed.filter((c) => c.pipeline === "Acquired");
  const dropped = showed.filter((c) => c.pipeline === "Dropped");

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
    raw: { showed: showed.length, acquired: acquired.length, started: gaps.length },
    headline: `${pct(acquired.length, showed.length)}% convert`,
    sub: gaps.length ? `${median(gaps)} days to the first session` : "No matched first sessions",
    stats: [
      { label: "Signed up", value: acquired.length },
      { label: "Said no", value: dropped.length, lowerIsBetter: true },
      { label: "Close rate", value: `${pct(acquired.length, showed.length)}%`,
        note: `${acquired.length} of ${showed.length} who showed` },
      { label: "Median days to first session", value: median(gaps) ?? "—", lowerIsBetter: true },
      { label: "Slowest start", value: gaps.length ? `${Math.max(...gaps)} days` : "—", lowerIsBetter: true },
    ],
  };
}

/** 4. Continuity. Whether anybody stays past the first couple of sessions. */
function continuity(byMentee, target, from, to) {
  // Only sessions inside the window, and only mentees who have one there, so a
  // 7-day view describes this week rather than all time. The upper bound
  // matters for "the period before this one".
  const win = {};
  Object.entries(byMentee).forEach(([k, dates]) => {
    const d = dates.filter((x) => x >= from && (!to || x < to));
    if (d.length) win[k] = d;
  });
  byMentee = win;
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
    raw: { starters, repeat: reached(2) },
    headline: `${pct(reached(3), starters)}% reach 3+`,
    sub: `${total} sessions delivered across ${starters} mentees`,
    stats: [
      { label: "Mentees who started", value: starters },
      { label: "Sessions delivered", value: total },
      { label: "Median sessions each", value: median(counts) ?? 0 },
      { label: "Median days between sessions", value: median(gaps) ?? "—",
        note: `target ${target}`, lowerIsBetter: true },
    ],
    table: {
      head: ["Milestone", "Mentees", "Share of starters"],
      rows: [2, 3, 5, 8, 12].map((n) =>
        [`${n}+ sessions`, reached(n), `${pct(reached(n), starters)}%`]),
      note: "The pitch says most people need 12 to 15 sessions to land a role.",
    },
  };
}

/** The reminder sequence, as the first gap in the journey. */
function emailCheckpoints(email) {
  if (!email.length) {
    return { label: "Reminder emails", question: "No Brevo data", headline: "—", stats: [], table: null };
  }
  // Weighted across the three: every reminder sent, and the share opened.
  const opens = email.reduce((a, e) => a + Math.round((e.openRate / 100) * e.delivered), 0);
  const sent = email.reduce((a, e) => a + e.delivered, 0);
  return {
    label: "Reminder emails",
    question: "Do the three emails before the call get read?",
    headline: sent ? `${pct(opens, sent)}%` : "—",
    stats: email.map((e) => ({
      label: e.name, value: `${e.openRate}%`,
      note: `${e.delivered} sent${e.clicked ? `, ${e.clickRate}% clicked` : ", no clicks"}`,
      warn: e.openRate < 50,
    })),
    table: {
      head: ["Email", "Sent", "Opened", "Clicked"],
      rows: email.map((e) => [e.name, e.delivered, `${e.openRate}%`,
        e.clicked ? `${e.clickRate}%` : "none"]),
      note: "Open rate is measured on the recipients no mail-app proxy touched, then " +
        "applied to all of them. Apple's pre-fetch both fakes opens and hides real ones, " +
        "so counting the raw event is wrong in both directions. " + clickNote(email),
    },
  };
}

/**
 * A midpoint sits between two circles. Index 0 means "between the first and
 * second stage". Only the reminder sequence earns one: the other gaps would
 * repeat the number already printed on the circle they point at, since
 * "booking to showing up" IS the show rate and "call to signing" IS the
 * convert rate.
 */
/**
 * Midpoints sit IN the gaps between circles: links[i - 1] is drawn before
 * stage i. So the array is positional and must be padded to line up.
 *
 * Stages are: 0 Reach, 1 Traffic, 2 Consultation, 3 Close, 4 Continuity.
 * The reminder emails go out after someone books and before the call, so the
 * checkpoint belongs in the gap before Consultation, which is index 1.
 * A null leaves that gap as a plain arrow.
 *
 * If a stage is ever added or reordered, this padding has to move with it.
 */
const EMAIL_GAP_INDEX = 1;   // gap between Traffic and Consultation

function midpoints(email) {
  const out = [];
  out[EMAIL_GAP_INDEX] = emailCheckpoints(email);
  // Fill the holes so the array has no undefined slots before the checkpoint.
  for (let i = 0; i < out.length; i++) if (!out[i]) out[i] = null;
  return out;
}

module.exports = {
  sessionsByMentee, reach, traffic, consultation, close, continuity, midpoints, ymd, pct,
  TRANSCRIPT_ERA_START,
};
