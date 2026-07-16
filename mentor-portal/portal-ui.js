// portal-ui.js — injects the shared portal chrome (top nav + theme toggle)
// into any page with a <div id="portal-nav"></div> mount point.
// Keeps every portal page's header identical: edit here, updates everywhere.

import { signOut } from "./auth.js";

const THEME_KEY = "headstart_theme";

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle");
  // Label says what the button switches TO, so it reads as "the light mode button".
  if (btn) btn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

export function initTheme() {
  let saved = "dark";
  try { saved = localStorage.getItem(THEME_KEY) || "dark"; } catch (e) {}
  applyTheme(saved);
}

const OWNER_LINKS = [
  { href: "/consultation-tool/index.html", label: "Consultation", page: "consultation" },
  { href: "/mentor-portal/contacts.html", label: "Contacts", page: "contacts" },
  { href: "/mentor-portal/billing.html", label: "Billing", page: "billing" },
  { href: "/mentor-portal/pl.html", label: "P&amp;L", page: "pl" },
  { href: "/mentor-portal/payslips.html", label: "Payslips", page: "payslips" },
  { href: "/mentor-portal/admin.html", label: "Admin", page: "admin" },
];

/**
 * Render the shared nav.
 * @param {object} opts
 * @param {string}  opts.email   text for the user chip (email or "viewing as …")
 * @param {boolean} opts.isOwner show owner-only links
 * @param {string}  opts.active  page key to highlight: home|billing|pl|payslips|admin
 */
export function mountPortalNav({ email = "", isOwner = false, active = "" } = {}) {
  const mount = document.getElementById("portal-nav");
  if (!mount) return;

  const ownerLinks = isOwner
    ? OWNER_LINKS.map((l) =>
        `<a href="${l.href}" class="nav-pill${l.page === active ? " is-active" : ""}">${l.label}</a>`
      ).join("")
    : "";

  mount.innerHTML = `
    <header class="top-nav">
      <div class="top-nav-inner">
        <a href="/mentor-portal/index.html" class="logo-home" aria-label="Mentor portal home">
          <img src="/images/headstart-italic-logo.png" alt="The Headstart" />
        </a>
        <div class="top-nav-text">
          <span class="top-nav-title">Mentor Portal</span>
          <span class="top-nav-subtitle">Internal use only</span>
        </div>
        <div class="top-nav-actions">
          ${isOwner ? '<button class="nav-burger" id="nav-burger" type="button" aria-label="Menu">&#9776;</button>' : ""}
          <div class="nav-owner" id="nav-owner">
            <select id="view-as" class="nav-pill" style="display:none;" title="View the portal as a mentor" aria-label="View as mentor"></select>
            ${ownerLinks}
          </div>
          <span class="user-chip" id="user-chip" ${email ? "" : "hidden"}></span>
          <button class="nav-pill" id="theme-toggle" type="button" title="Switch between light and dark mode">Light mode</button>
          <button class="nav-pill" id="signout-btn" type="button" title="Sign out">Sign out</button>
        </div>
      </div>
    </header>`;

  const chip = document.getElementById("user-chip");
  if (chip && email) chip.textContent = email;

  // Re-apply so the freshly injected icon matches the current theme.
  initTheme();
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  document.getElementById("signout-btn").addEventListener("click", (e) => {
    e.preventDefault();
    signOut();
  });

  // Mobile hamburger: the owner links collapse into a dropdown so they do not
  // stack across the top bar on a phone.
  const burger = document.getElementById("nav-burger");
  if (burger) {
    const nav = mount.querySelector(".top-nav");
    burger.addEventListener("click", (e) => { e.stopPropagation(); nav.classList.toggle("menu-open"); });
    document.addEventListener("click", () => nav.classList.remove("menu-open"));
  }

  return mount;
}
