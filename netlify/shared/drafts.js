// drafts.js — parsing the Make.com "Drafts" field into individual messages.
//
// Shared by the contacts page and the consultation follow-up page, because both
// send the same drafted messages and a second copy of this parser would drift.

const HEADING = /^\s*#*\s*(whatsapp|gmail|email)\s+(follow-?up|nudge)\s*:?\s*$/i;

// The current Make.com prompt writes three blocks separated by banner lines:
//   === FOLLOW-UP (send now) ===   === NUDGE 1 ... ===   === NUDGE 2 ... ===
// Each is a separate message sent on a different day, so they are split apart
// and returned as a list rather than one blob. Older records used
// "WhatsApp follow-up:" style headings, so both shapes are handled.
// The closing "===" is optional: the model writes "=== NUDGE 1 ===" most of the
// time and "=== NUDGE 1" the rest, and when the trailing markers were required
// a whole record collapsed into one unlabelled message with no nudge buttons.
// The label must start with something other than "=" so a bare "======" rule
// line is not mistaken for a heading.
const BANNER = /^\s*={2,}\s*([^=\s].*?)\s*=*\s*$/;

// "FOLLOW-UP (send now)" → { label: "Follow-up", when: "send now" }, so the
// buttons can be short and the timing still shown.
function splitLabel(raw) {
  const m = String(raw).match(/^(.*?)\s*\((.+)\)\s*$/);
  const title = (m ? m[1] : raw).trim();
  const nice = title.charAt(0).toUpperCase() + title.slice(1).toLowerCase();
  return { label: nice, when: m ? m[2].trim() : "" };
}

/** Every draft message in the field, in order, each with its own label. */
function draftMessages(drafts) {
  if (!drafts) return [];
  const lines = drafts.split(/\r?\n/);

  const out = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const text = current.lines.join("\n").trim();
    if (text) out.push({ label: current.label, when: current.when, text });
    current = null;
  };

  lines.forEach((l) => {
    const banner = l.match(BANNER);
    if (banner) { push(); current = { ...splitLabel(banner[1]), lines: [] }; return; }
    const heading = l.match(HEADING);
    if (heading) {
      push();
      // Older records carry a WhatsApp AND a Gmail version of each message, so
      // the channel has to be in the label. Without it you get two buttons both
      // saying "Follow-up" and no way to tell which is which.
      const channel = /whatsapp/i.test(heading[1]) ? "WhatsApp" : "Email";
      const type = /nudge/i.test(heading[2]) ? "nudge" : "follow-up";
      current = { label: `${channel} ${type}`, when: "", lines: [] };
      return;
    }
    if (current) current.lines.push(l);
    // Text before any heading is a message with no label of its own. This is
    // how the oldest records look, so it must not be dropped.
    else current = { label: "Follow-up", when: "", lines: [l] };
  });
  push();
  return out;
}

module.exports = { draftMessages };
