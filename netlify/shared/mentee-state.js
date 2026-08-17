// mentee-state.js — the one place that decides what state a mentee is in.
//
// Before this, two different "Next Session" fields (one on the session row set
// by the mentor, one on the mentee record set from the portal) were merged
// differently by every screen, so the mentee status page, the mentor portal and
// the Monday email could each disagree about who needed chasing.
//
// Now there is one expected date on the mentee record, and one function that
// turns it into a state. Anything that shows or emails a mentee calls this.

const DAY = 86400000;

/** Days between two YYYY-MM-DD strings. Positive when b is later. */
const daysBetween = (a, b) =>
  Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / DAY);

// A mentee chased in the last few days is already being dealt with, so they
// drop off the list rather than nagging every day until something changes.
const CHASE_QUIET_DAYS = 5;

// No date and this long since the last session is its own problem: nobody has
// even agreed when to meet again.
const NO_DATE_DAYS = 10;

// A session can run a day late without anything being wrong: someone shifts it
// by a day, the mentor logs it the next morning. Two days is where "not yet
// logged" turns into "this did not happen".
const LAPSE_GRACE_DAYS = 2;

/**
 * @param {object} m
 *   expected   YYYY-MM-DD  the agreed next session, from the mentee record
 *   lastSession YYYY-MM-DD the most recent delivered session
 *   holdUntil  YYYY-MM-DD  parked until this date
 *   lastChased YYYY-MM-DD  when it was last acted on
 *   lapses     number      how many expected dates have passed unfulfilled
 * @param {string} today YYYY-MM-DD
 */
function menteeState(m, today) {
  const expected = m.expected || "";
  const lastSession = m.lastSession || "";
  const hold = m.holdUntil || "";
  const chased = m.lastChased || "";
  const lapses = Number(m.lapses) || 0;

  if (hold && hold >= today) {
    return { key: "hold", label: "On hold", until: hold, needsAction: false, lapses };
  }

  // A date still to come is the only genuinely settled state.
  if (expected && expected >= today) {
    return {
      key: "booked", label: "Booked", date: expected,
      days: daysBetween(today, expected), needsAction: false, lapses,
    };
  }

  // The date came and went. A session logged on or after it means it happened
  // and the mentor simply has not set the next one yet.
  if (expected && expected < today) {
    const fulfilled = lastSession && lastSession >= expected;
    if (!fulfilled) {
      const quiet = chased && daysBetween(chased, today) < CHASE_QUIET_DAYS;
      const overdue = daysBetween(expected, today);
      return {
        key: "lapsed", label: lapses > 1 ? `Lapsed ${lapses}x` : "Lapsed",
        date: expected, days: overdue,
        lapses, chasedOn: chased,
        // Chased recently, so it is someone else's turn to move, not yours.
        // Inside the grace period it still shows, just without demanding action.
        needsAction: !quiet && overdue >= LAPSE_GRACE_DAYS,
      };
    }
  }

  // Nothing in the diary. Only worth surfacing once they have been quiet a
  // while, otherwise every session logged today lands here tomorrow.
  //
  // A mentee who has never had a session is measured from when they became a
  // mentee, not from their consultation. Those can be weeks apart: a
  // consultation in July that only converts in August would otherwise look
  // like a month of neglect on the mentor's first week.
  //
  // startedAt is the "Pipeline Changed" field, a last-modified stamp on Client
  // Pipeline, so it lands on the day they turned Acquired. createdAt is the
  // consultation date and is only a fallback for records predating that field.
  const anchor = m.startedAt || m.createdAt || "";
  const since = lastSession
    ? daysBetween(lastSession, today)
    : (anchor ? daysBetween(anchor, today) : null);
  const quiet = chased && daysBetween(chased, today) < CHASE_QUIET_DAYS;
  return {
    key: "nodate",
    label: lastSession ? "No date set" : "No sessions yet",
    days: since, lapses, chasedOn: chased,
    // No clock at all (no session, no created date) is treated as needing a
    // look, because an unknown is worth one glance rather than silence.
    needsAction: !quiet && (since === null || since >= NO_DATE_DAYS),
  };
}

/**
 * Has an expected date lapsed since we last counted one? Returns the date to
 * count, or "" when there is nothing new to count.
 *
 * Counting is keyed on the date itself rather than a running tally, so the job
 * can run every hour and a given missed date is only ever counted once.
 */
function lapseToCount(m, today) {
  const expected = m.expected || "";
  if (!expected || expected >= today) return "";
  if (m.lastSession && m.lastSession >= expected) return "";  // it happened
  if (m.lapseCountedFor === expected) return "";              // already counted
  return expected;
}

module.exports = { menteeState, lapseToCount, daysBetween, CHASE_QUIET_DAYS, NO_DATE_DAYS, LAPSE_GRACE_DAYS };
