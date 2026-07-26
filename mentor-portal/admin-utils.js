// admin-utils.js — pure helpers shared by the admin overview and its table.

const DAY_MS = 86400000;

export const fmtMoney = (n) =>
  "$" + (n || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtDate = (d) =>
  d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const daysSince = (d) => {
  if (!d) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((t - new Date(d.slice(0, 10) + "T00:00:00")) / DAY_MS));
};

// Package purchase rows record a payment, not a delivered session.
export const isPurchase = (s) => s.status === "Package" && s.amountCharged > 0;

export const sameMentee = (s, m) =>
  (s.menteeId && s.menteeId === m.id) ||
  s.mentee.trim().toLowerCase() === m.name.trim().toLowerCase();

// A YYYY-MM-DD string N days before today (local time).
export const daysAgoISO = (n) => {
  const x = new Date(); x.setDate(x.getDate() - n);
  return x.toISOString().slice(0, 10);
};

// Average gap between sessions, in days, given session dates ascending.
// Needs at least 2 dates (one gap) to mean anything; null otherwise.
export function avgGapDays(datesAsc) {
  if (!datesAsc || datesAsc.length < 2) return null;
  let total = 0;
  for (let i = 1; i < datesAsc.length; i++) {
    total += Math.round((new Date(datesAsc[i]) - new Date(datesAsc[i - 1])) / DAY_MS);
  }
  return total / (datesAsc.length - 1);
}

// Human label for a gap in days: weeks once it is roomy enough, days otherwise.
export function fmtFrequency(days) {
  if (days == null) return null;
  const weeks = days / 7;
  const d = Math.round(days);
  return weeks >= 1.3 ? `~${weeks.toFixed(1)} wk` : `~${d} day${d === 1 ? "" : "s"}`;
}
