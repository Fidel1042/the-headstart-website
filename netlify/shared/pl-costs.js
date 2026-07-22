// Shared subscription costs for the P&L.
//
// This file is the ONE place monthly software costs are defined. monthly-pl.js
// (writes the closed month to Airtable) and preview-pl.js (shows the month in
// progress) both read from here, so the two can never disagree.
//
// It lives outside netlify/functions on purpose: files in that folder are
// deployed as callable endpoints, and this is a library, not an endpoint.

// Annual prepaid plans are recorded as one twelfth per month, not as a single
// hit in the month the card was charged, so each month carries the cost of the
// service it actually used. Same principle as mentee prepay packages.
//
// USD_AUD checked 22 Jul 2026 (spot 1.4285). Re-check yearly, or when the
// P&L opex line looks wrong against the bank statement.
const USD_AUD = 1.43;
const usd = (n) => Math.round(n * USD_AUD * 100) / 100;

// To add a subscription: add one line here, then create a currency column in
// the P&L table with the EXACT same name. The Opex Breakdown column always
// carries the full itemisation as text, so a forgotten column loses the column
// but never loses the number from Total Opex.
const FIXED_COSTS = {
  "Claude Pro": 34,       // AUD, billed monthly
  "Make.com":   15,       // approx, 9.50 USD billed monthly
  "Netlify":    usd(9),   // Personal plan, 9 USD/mo, 12 months prepaid
  "Airtable":   usd(20),  // Team plan, 1 seat, 20 USD/seat/mo billed annually
};

const TOTAL_OPEX = Math.round(
  Object.values(FIXED_COSTS).reduce((a, b) => a + b, 0) * 100
) / 100;

const OPEX_BREAKDOWN = Object.entries(FIXED_COSTS)
  .map(([name, cost]) => `${name} ${cost.toFixed(2)}`)
  .join("; ");

// Line-item form, for the detailed view in the portal.
const OPEX_LINES = Object.entries(FIXED_COSTS).map(([name, cost]) => ({ name, cost }));

module.exports = { USD_AUD, FIXED_COSTS, TOTAL_OPEX, OPEX_BREAKDOWN, OPEX_LINES };
