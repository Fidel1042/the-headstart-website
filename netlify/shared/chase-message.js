// chase-message.js — the message Fidel sends a mentee whose card declined.
// Shared so the billing popup and the next-day reminder email never drift.
//
// Voice rules from the project: no em dashes, plain English, casual, no
// corporate phrasing. Keep it short enough to paste straight into WhatsApp.

const firstName = (n) => String(n || "there").trim().split(/\s+/)[0];

/**
 * @param {string} name   mentee's full name
 * @param {number} amount amount that failed, in dollars
 * @param {string} reason Stripe's decline reason, if any
 */
function chaseMessage(name, amount, reason = "") {
  const who = firstName(name);
  const amt = `$${Number(amount || 0).toFixed(2)}`;
  // Insufficient funds is the common case and is worth naming, because it tells
  // the mentee exactly what to do. Anything else stays vague on purpose: the
  // raw Stripe wording is not something to forward to a customer.
  const cause = /insufficient/i.test(reason)
    ? "It looks like there wasn't enough in the account at the time."
    : "It looks like the card was declined.";

  return `Hi ${who}, quick heads up that the ${amt} payment for your recent session didn't go through. ` +
    `${cause} Could you check the card and let me know once it's sorted? ` +
    `I'll run it again from my end, so there's nothing for you to pay manually. Thanks!`;
}

module.exports = { chaseMessage, firstName };
