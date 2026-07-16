// contacts.js — owner-only "contacts to add" list. Each new mentee gets a
// one-tap Save contact (vCard) so they land in WhatsApp, a Message button
// (opens the WhatsApp chat), and Mark done to clear them off the list.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
let ownerEmail = "";

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const MOCK = { contacts: [
  { id: "recC1", name: "Mary Chen",    phone: "61412345678", stage: "Acquired",             mentor: "Angelica" },
  { id: "recC2", name: "Priya Sharma", phone: "61423456789", stage: "First session booked", mentor: "Aidan" },
  { id: "recC3", name: "Sam Wong",     phone: "",            stage: "Waiting on Contract",  mentor: "Not matched yet" },
] };

async function load() {
  const loading = document.getElementById("loading");
  const empty = document.getElementById("empty");
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
  render(data.contacts || []);
}

function card(c) {
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
        <button type="button" class="c-btn c-btn--done" data-act="done" data-id="${c.id}">Mark done</button>
      </div>
    </article>`;
}

function render(contacts) {
  const list = document.getElementById("contact-list");
  const empty = document.getElementById("empty");
  if (!contacts.length) { empty.hidden = false; return; }
  window._contacts = new Map(contacts.map((c) => [c.id, c]));
  list.innerHTML = contacts.map(card).join("");
  updateCount();
}

function updateCount() {
  const n = document.querySelectorAll(".contact-card").length;
  const el = document.getElementById("contacts-count");
  el.textContent = n
    ? `${n} new mentee${n === 1 ? "" : "s"} to add. Tap Save contact, then Message to say hi, then Mark done.`
    : "All caught up. No new mentees to add right now.";
  if (!n) document.getElementById("empty").hidden = false;
}

// vCard: tapping the download on a phone opens "Add contact".
function vcard(c) {
  return [
    "BEGIN:VCARD", "VERSION:3.0",
    `N:;${c.name};;;`, `FN:${c.name}`,
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
  a.download = `${c.name}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function markDone(id, btn) {
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    if (!isLocal) {
      const res = await fetch("/.netlify/functions/admin-update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "mentee-contact-added", recordId: id, ownerEmail }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
    }
    document.querySelector(`[data-card="${id}"]`)?.remove();
    updateCount();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Mark done";
    alert(err.message || "Could not update. Try again.");
  }
}

document.getElementById("contact-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const c = window._contacts.get(btn.dataset.id);
  if (btn.dataset.act === "save" && c) saveContact(c);
  if (btn.dataset.act === "done") markDone(btn.dataset.id, btn);
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
