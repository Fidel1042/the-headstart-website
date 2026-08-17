// followups.js — the post-consultation follow-up sequence, in one place.
//
// Used by consult-followups.js (the page) and checkin-sender.js (the scheduled
// t+90 email). Two copies of this would eventually disagree about who is due,
// and the one that sends email is the copy you least want to be wrong.

// Every touch: days after the consultation, how it is sent, and any minimum
// conversion score it needs to be earned.
const TOUCHES = [
  { day: 0,  channel: "whatsapp" },
  { day: 1,  channel: "whatsapp" },
  { day: 3,  channel: "whatsapp" },
  { day: 20, channel: "whatsapp", minPct: 40 },
  { day: 90, channel: "email" },
];
const FINAL_TOUCH_MIN_PCT = 40;

const CHECKIN_SUBJECT = "How did the job search go?";

/**
 * Target Industry is free text and often a whole sentence: "Business analytics,
 * demand planning, supply chain, with interest in renewables". Dropped straight
 * into a question that reads like a form letter, so only the first field is
 * used, and anything unusable falls back to no industry at all.
 *
 * Returns "" when the sentence is better off generic.
 */
function shortIndustry(raw) {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (/^other$/i.test(v)) return "";
  // Make.com occasionally dumps its whole JSON response into the field.
  if (v.startsWith("{") || v.startsWith("```") || v.includes('"did_consultation"')) return "";
  // First listed field only: "Data and AI, Consultant" -> "Data and AI".
  const first = v.split(/[,/;]|\s+\(|\s+-\s+/)[0].trim().replace(/[.\s]+$/, "");
  if (!first || first.length > 40) return "";
  // A leftover fragment is worse than saying nothing.
  if (first.split(/\s+/).length > 5) return "";
  return first;
}

const checkinBody = (first, industry) => {
  const field = shortIndustry(industry);
  const landed = field
    ? `Did you manage to land something in ${field}?`
    : `Did you manage to land something?`;
  return `Hi ${first},\n\n` +
    `It has been a few months since we spoke about your job search. How did it go? ` +
    `${landed}\n\n` +
    `If you are still looking, happy to jump on a quick call and see how we can help.\n\n` +
    `Fidel\nHeadstart Mentoring`;
};

const DAY = 86400000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / DAY);

/** "80 - ready to start" and "40% - early stage" both mean the number in front. */
function scoreOf(raw) {
  const m = String(raw || "").match(/^\s*(\d{1,3})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 0 && n <= 100 ? n : null;
}

/** The touches this particular lead earns, in order. */
const planFor = (score) => TOUCHES.filter((t) => !t.minPct || (score || 0) >= t.minPct);

/**
 * Where a lead is in their sequence.
 * @param {object} l  consultedOn, score, stage
 * @param {string} today YYYY-MM-DD
 */
function nextTouch(l, today) {
  const plan = planFor(l.score);
  const stage = Number(l.stage) || 0;
  const done = stage >= plan.length;
  const next = done ? null : plan[stage];
  const age = l.consultedOn ? daysBetween(l.consultedOn, today) : null;
  const dueOn = next && l.consultedOn
    ? ymd(new Date(new Date(l.consultedOn + "T00:00:00Z").getTime() + next.day * DAY))
    : "";
  const due = Boolean(next) && age !== null && age >= next.day;
  return {
    plan, stage, done, next, age, dueOn, due,
    label: next ? `t+${next.day}` : "",
    overdueBy: due ? age - next.day : 0,
  };
}

module.exports = {
  TOUCHES, FINAL_TOUCH_MIN_PCT, CHECKIN_SUBJECT, checkinBody, shortIndustry,
  scoreOf, planFor, nextTouch, ymd, daysBetween,
};
