// referral-link.js — mentor affiliate links.
//
// A mentor shares theheadstartmentoring.com/discovery-call?ref=koda and the
// signup form arrives with them already set as the referrer, so the mentee
// never has to remember a name and the referral is not lost to a shrug.
//
// Three things this deliberately does NOT do:
//
//   It does not write the URL value into the form. `ref` is matched against
//   the real mentor list and the MATCHED name is used, so a junk or hostile
//   ?ref= cannot inject text into an Airtable field. Same rule the agreement
//   page applies to ?mentee=.
//
//   It does not set the two form fields by hand. It sets the select and fires
//   a change event, letting the page's own handler do the rest. That handler
//   is what disables the unused referral_name input, and when both are left
//   enabled Netlify receives an array and stores ["", ""] instead of a name.
//   Three live submissions already look like that. Reusing the handler means
//   this cannot be the fourth.
//
//   It does not overwrite an earlier referral. First touch wins, for 90 days,
//   the same rule attribution.js applies to campaign sources. Otherwise a
//   mentee who later opens a different mentor's link hands the credit over.
//
// Attribution is read from "Referrer Name" in Airtable, never "Lead Source":
// the consultation summary scenario overwrites Lead Source with whatever the
// call transcript said.

import { searchSources } from "../data/search-sources.js";

const STORAGE_KEY = "hs_ref_v1";
const MAX_AGE_DAYS = 90;

/** localStorage, or null in private mode where touching it throws. */
function store() {
  try {
    const t = "__hs_ref_test__";
    window.localStorage.setItem(t, "1");
    window.localStorage.removeItem(t);
    return window.localStorage;
  } catch (e) {
    return null;
  }
}

/** The mentor whose name matches this slug, or "" if none does. */
function matchMentor(raw) {
  const slug = String(raw || "").trim().toLowerCase();
  if (!slug || slug.length > 40) return "";
  const mentors = searchSources.mentors || [];
  return mentors.find((m) => m.toLowerCase() === slug) || "";
}

function remembered() {
  const s = store();
  if (!s) return "";
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return "";
    const data = JSON.parse(raw);
    const age = (Date.now() - (data.at || 0)) / 86400000;
    if (age > MAX_AGE_DAYS) { s.removeItem(STORAGE_KEY); return ""; }
    // Re-matched rather than trusted: the stored value is only as good as the
    // mentor list was on the day it was written.
    return matchMentor(data.ref);
  } catch (e) {
    return "";
  }
}

function remember(mentor) {
  const s = store();
  if (!s) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify({ ref: mentor, at: Date.now() }));
  } catch (e) { /* quota or private mode, the prefill still works this visit */ }
}

export function init() {
  const sourceSel = document.getElementById("referral-source");
  const mentorInput = document.getElementById("referral-mentor");
  if (!sourceSel || !mentorInput) return;

  let mentor = "";
  try {
    mentor = matchMentor(new URLSearchParams(window.location.search).get("ref"));
  } catch (e) { /* no URLSearchParams, fall through to the stored value */ }

  if (mentor) {
    // Only a fresh, valid link is written down. An unknown ?ref= is ignored
    // entirely rather than clearing what is already there.
    if (!remembered()) remember(mentor);
  } else {
    mentor = remembered();
  }
  if (!mentor) return;

  sourceSel.value = "Mentor Referral";
  sourceSel.dispatchEvent(new Event("change", { bubbles: true }));
  mentorInput.value = mentor;

  // Left editable on purpose. The link is right in almost every case, but a
  // mentee who was genuinely sent by someone else can still say so, and a
  // wrong name they cannot correct is worse data than one they can.
}
