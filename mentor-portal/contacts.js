// contacts.js — owner-only "contacts to add", in three lists:
//   needsMentor      signed mentees with nobody teaching them yet
//   matched  (Koko)  mentees who now have a mentor and need a WhatsApp contact
//   consults (Fidel) mentees whose initial consultation is written up
// Saving uses a vCard so one tap opens "Add contact" on a phone.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const NAME_PREFIX = "THS Mentee - ";
const SITE = "https://theheadstartmentoring.com";

// The two halves of the shared calendar. Both get pasted into the same
// WhatsApp group at onboarding: the mentor puts times up, the mentee books one.
const availabilityLink = (c) => `${SITE}/availability?m=${c.mentorId}`;
const bookingLink = (c) => `${SITE}/book-session?c=${c.id}`;
let ownerEmail = "";
const byId = new Map();

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GROUPS = [
  // No "kind": this list clears itself when a mentor is set in Airtable, so
  // there is nothing to mark done.
  { key: "needsMentor", kind: "" },
  { key: "matched",  kind: "mentee-contact-added" },
  { key: "consults", kind: "mentee-consult-saved" },
];

// What a mentor is told when asked to take someone on. The two expectations
// are fixed on purpose: they are the deal, not a per-mentee negotiation.
// Change them here and every message follows.
const PITCH = { sessions: "10-15", frequency: "Weekly", firstSession: "Next week / week after" };

function mentorAsk(c) {
  const field = c.industry
    ? `who wants to go into ${c.industry}`
    : "who is still working out which industry they want";
  return `Hey! I got a new mentee for you ${field}.\n\n` +
    `Session amount expectation: ${PITCH.sessions}\n` +
    `Frequency expectation: ${PITCH.frequency}\n` +
    `First session timeline: ${PITCH.firstSession}\n\n` +
    `Let me know if you are keen to take the mentee!`;
}

const MOCK = {
  needsMentor: [
    { id: "recN1", name: "Rutuja Raorane", phone: "61400000000", stage: "Acquired",
      mentor: "Not matched yet", industry: "Marketing" },
  ],
  matched: [
    { id: "recC1", name: "Mary Chen", phone: "61412345678", stage: "Acquired", mentor: "Angelica" },
  ],
  consults: [
    { id: "recC2", name: "Priya Sharma", phone: "61423456789", stage: "Waiting on Contract", mentor: "Not matched yet" },
    { id: "recC3", name: "Sam Wong", phone: "", stage: "Waiting on Contract", mentor: "Not matched yet" },
  ],
};

async function load() {
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  let data;
  try {
    if (isLocal) {
      data = MOCK;
    } else {
      const res = await fetch("/.netlify/functions/get-contacts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load");
    }
  } catch (err) {
    loading.hidden = true;
    errorEl.textContent = err.message || "Could not load. Refresh to try again.";
    errorEl.hidden = false;
    return;
  }
  loading.hidden = true;
  GROUPS.forEach((g) => renderGroup(g, data[g.key] || []));
}

function card(c, kind) {
  const hasPhone = Boolean(c.phone);
  const readable = hasPhone ? "+" + c.phone : "No number in Airtable";
  // The ask goes to a mentor, not to the mentee, so this card carries the
  // message itself rather than a contact action.
  if (kind === "") {
    const msg = mentorAsk(c);
    return `
    <article class="contact-card" data-card="${c.id}">
      <div class="contact-card__info">
        <h3 class="contact-card__name">${esc(c.name)}</h3>
        <p class="contact-card__meta">${c.industry ? `Wants ${esc(c.industry)}` : "No industry recorded"}</p>
      </div>
      <div class="contact-card__actions">
        <button type="button" class="c-btn c-btn--save" data-act="copyask" data-id="${c.id}">Copy message</button>
      </div>
      <details class="contact-msg" open>
        <summary>The message to send a mentor</summary>
        <p class="contact-msg__body">${esc(msg)}</p>
      </details>
    </article>`;
  }
  return `
    <article class="contact-card" data-card="${c.id}">
      <div class="contact-card__info">
        <h3 class="contact-card__name">${esc(c.name)}</h3>
        <p class="contact-card__meta">Mentor: ${esc(c.mentor)}</p>
        <p class="contact-card__meta">${esc(c.stage)} &middot; <span class="contact-card__phone">${esc(readable)}</span></p>
      </div>
      <div class="contact-card__actions">
        <button type="button" class="c-btn c-btn--save" data-act="save" data-id="${c.id}" ${hasPhone ? "" : "disabled"}>Save contact</button>
        ${(c.messages || []).map((m, i) =>
          `<button type="button" class="c-btn" data-act="copymsg" data-id="${c.id}" data-msg="${i}"
             title="${esc(m.when || "")}">Copy ${esc(m.label)}</button>`).join("")}
        ${c.mentorId ? `<button type="button" class="c-btn" data-act="copyavail" data-id="${c.id}"
          title="Send this to the mentor">Mentor availability link</button>` : ""}
        <button type="button" class="c-btn" data-act="copybook" data-id="${c.id}"
          title="Send this to the mentee">Mentee booking link</button>
        <a class="c-btn c-btn--msg${hasPhone ? "" : " is-disabled"}" ${hasPhone ? `href="https://wa.me/${c.phone}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>Message</a>
        <button type="button" class="c-btn c-btn--done" data-act="done" data-id="${c.id}" data-kind="${kind}">Mark done</button>
      </div>
      ${(c.messages || []).length ? `
      <details class="contact-msg">
        <summary>Read the ${c.messages.length} message${c.messages.length === 1 ? "" : "s"}</summary>
        ${c.messages.map((m) => `
          <p class="contact-msg__label">${esc(m.label)}${m.when ? ` &middot; ${esc(m.when)}` : ""}</p>
          <p class="contact-msg__body">${esc(m.text)}</p>`).join("")}
      </details>` : ""}
    </article>`;
}

function renderGroup(g, list) {
  const section = document.getElementById("group-" + g.key);
  const listEl = document.getElementById("list-" + g.key);
  if (!section || !listEl) return;
  list.forEach((c) => byId.set(c.id, c));
  section.hidden = false;
  listEl.innerHTML = list.map((c) => card(c, g.kind)).join("");
  updateCount(g.key);
}

function updateCount(key) {
  const listEl = document.getElementById("list-" + key);
  const n = listEl.querySelectorAll(".contact-card").length;
  document.getElementById("count-" + key).textContent = n ? `(${n})` : "";
  document.getElementById("empty-" + key).hidden = n > 0;
}

// vCard: tapping the download on a phone opens "Add contact". Every contact is
// prefixed so they group together in the phonebook and in WhatsApp.
function vcard(c) {
  const display = NAME_PREFIX + c.name;
  return [
    "BEGIN:VCARD", "VERSION:3.0",
    `N:;${display};;;`, `FN:${display}`,
    c.phone ? `TEL;TYPE=CELL:+${c.phone}` : "",
    `NOTE:Headstart mentee. Mentor: ${c.mentor}`,
    "END:VCARD",
  ].filter(Boolean).join("\r\n");
}

function saveContact(c) {
  const blob = new Blob([vcard(c)], { type: "text/vcard;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${NAME_PREFIX}${c.name}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function markDone(id, kind, btn) {
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, recordId: id, ownerEmail }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
    }
    const cardEl = document.querySelector(`[data-card="${id}"]`);
    const key = cardEl?.closest(".contact-group")?.id.replace("group-", "");
    cardEl?.remove();
    if (key) updateCount(key);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Mark done";
    alert(err.message || "Could not update. Try again.");
  }
}

// One-tap copy. Falls back to selecting the source element when the clipboard
// API is unavailable (e.g. an insecure context).
async function copyToClipboard(btn, text, srcEl) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    if (srcEl) {
      const range = document.createRange();
      range.selectNodeContents(srcEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  const original = btn.textContent;
  btn.textContent = "Copied";
  setTimeout(() => { btn.textContent = original; }, 2000);
}

document.querySelector(".contacts-page").addEventListener("click", (e) => {
  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) {
    const el = document.getElementById(copyBtn.dataset.copy);
    if (el) copyToClipboard(copyBtn, el.textContent, el);
    return;
  }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const c = byId.get(btn.dataset.id);
  if (btn.dataset.act === "save" && c) saveContact(c);
  if (btn.dataset.act === "copymsg" && c) {
    const m = (c.messages || [])[Number(btn.dataset.msg)];
    if (m) copyToClipboard(btn, m.text);
  }
  if (btn.dataset.act === "copyask" && c) copyToClipboard(btn, mentorAsk(c));
  if (btn.dataset.act === "copyavail" && c) copyToClipboard(btn, availabilityLink(c));
  if (btn.dataset.act === "copybook" && c) copyToClipboard(btn, bookingLink(c));
  if (btn.dataset.act === "done") markDone(btn.dataset.id, btn.dataset.kind, btn);
});

requireAuth((session) => {
  const email = session?.user?.email || "";
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  ownerEmail = email;
  mountPortalNav({ email, isOwner: true, active: "contacts" });
  load();
});
