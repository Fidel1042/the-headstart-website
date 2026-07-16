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

// Section links every mentor sees; they all live on the portal home page.
const SECTION_LINKS = [
  { href: "/mentor-portal/index.html#log-session", label: "Session Log" },
  { href: "/mentor-portal/index.html#mentee-info", label: "Mentee Info" },
  { href: "/mentor-portal/index.html#session-history", label: "Session History" },
  { href: "/mentor-portal/index.html#resources", label: "Resources" },
];

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

  const sectionLinks = SECTION_LINKS
    .map((l) => `<a href="${l.href}" class="nav-link">${l.label}</a>`)
    .join("");

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
        <nav class="top-nav-links" aria-label="Portal sections">${sectionLinks}</nav>
        <div class="top-nav-actions">
          <select id="view-as" class="nav-pill" style="display:none;" title="View the portal as a mentor" aria-label="View as mentor"></select>
          ${ownerLinks}
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

  return mount;
}
