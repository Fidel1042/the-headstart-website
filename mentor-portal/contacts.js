// contacts.js — owner-only "contacts to add", in two lists:
//   matched  (Koko)  mentees who now have a mentor and need a WhatsApp contact
//   consults (Fidel) mentees whose initial consultation is written up
// Saving uses a vCard so one tap opens "Add contact" on a phone.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const NAME_PREFIX = "THS Mentee - ";
let ownerEmail = "";
const byId = new Map();

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const GROUPS = [
  { key: "matched",  kind: "mentee-contact-added" },
  { key: "consults", kind: "mentee-consult-saved" },
];

const MOCK = {
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
  return `
    <article class="contact-card" data-card="${c.id}">
      <div class="contact-card__info">
        <h3 class="contact-card__name">${esc(c.name)}</h3>
        <p class="contact-card__meta">Mentor: ${esc(c.mentor)}</p>
        <p class="contact-card__meta">${esc(c.stage)} &middot; <span class="contact-card__phone">${esc(readable)}</span></p>
      </div>
      <div class="contact-card__actions">
        <button type="button" class="c-btn c-btn--save" data-act="save" data-id="${c.id}" ${hasPhone ? "" : "disabled"}>Save contact</button>
        <a class="c-btn c-btn--msg${hasPhone ? "" : " is-disabled"}" ${hasPhone ? `href="https://wa.me/${c.phone}" target="_blank" rel="noopener"` : 'aria-disabled="true"'}>Message</a>
        <button type="button" class="c-btn c-btn--done" data-act="done" data-id="${c.id}" data-kind="${kind}">Mark done</button>
      </div>
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

// One-tap copy for the welcome message. Falls back to selecting the text when
// the clipboard API is unavailable (e.g. an insecure context).
async function copyText(btn) {
  const el = document.getElementById(btn.dataset.copy);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
  } catch {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  const original = btn.textContent;
  btn.textContent = "Copied";
  setTimeout(() => { btn.textContent = original; }, 2000);
}

document.querySelector(".contacts-page").addEventListener("click", (e) => {
  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) { copyText(copyBtn); return; }
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const c = byId.get(btn.dataset.id);
  if (btn.dataset.act === "save" && c) saveContact(c);
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
