// portal-ui.js — injects the shared portal chrome (top nav + theme toggle)
// into any page with a <div id="portal-nav"></div> mount point.
// Keeps every portal page's header identical: edit here, updates everywhere.

import { signOut, ownerCanSee } from "./auth.js";
import { NAV_AREAS } from "./portal-nav-links.js";

const THEME_KEY = "headstart_theme";

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle");
  // Label says what the button switches TO, so it reads as "the light mode button".
  if (btn) btn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

export function initTheme() {
  // Light is the portal default. Anyone who has already chosen a theme keeps
  // their choice: only a first visit, with nothing stored, lands on light.
  let saved = "light";
  try { saved = localStorage.getItem(THEME_KEY) || "light"; } catch (e) {}
  applyTheme(saved);
}

/**
 * Render the shared nav: five areas on top, the active area's pages below.
 * @param {object} opts
 * @param {string}  opts.email      text for the user chip (email or "viewing as …")
 * @param {boolean} opts.isOwner    show owner-only links
 * @param {string}  opts.active     page key, e.g. billing | financials | pl
 * @param {string}  opts.loginEmail the real signed-in owner, for link filtering
 *                                  (defaults to email; matters when email is a
 *                                  "viewing as …" label)
 * @param {string}  opts.lockTheme  "dark" | "light" to pin the page's theme and
 *                                  drop the toggle. For pages whose content is
 *                                  built for one theme only, such as the
 *                                  consultation screens shown to a prospect.
 */
export function mountPortalNav({ email = "", isOwner = false, active = "", loginEmail = "", lockTheme = "" } = {}) {
  const mount = document.getElementById("portal-nav");
  if (!mount) return;

  const roleEmail = loginEmail || email;
  // Hide pages this owner cannot see, then drop any area left with nothing.
  const areas = NAV_AREAS
    .map((a) => ({ ...a, links: a.links.filter((l) => ownerCanSee(roleEmail, l.page)) }))
    .filter((a) => a.links.length);

  const current = areas.find((a) => a.links.some((l) => l.page === active)) || null;

  const ownerLinks = isOwner
    ? areas.map((a) => {
        const on = current && a.key === current.key;
        // An area with one page links straight to it; no second row needed.
        return `<a href="${a.links[0].href}" class="nav-pill${on ? " is-active" : ""}">${a.label}</a>`;
      }).join("")
    : "";

  // Second row only earns its place when the area has somewhere else to go.
  const subLinks = (isOwner && current && current.links.length > 1)
    ? `<div class="nav-sub"><div class="nav-sub-inner">${
        current.links.map((l) =>
          `<a href="${l.href}" class="nav-sub-link${l.page === active ? " is-active" : ""}">${l.label}</a>`
        ).join("")
      }</div></div>`
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
          <span class="user-chip" id="user-chip" ${email ? "" : "hidden"}></span>
          ${lockTheme ? "" : '<button class="nav-pill" id="theme-toggle" type="button" title="Switch between light and dark mode">Light mode</button>'}
          <button class="nav-pill" id="signout-btn" type="button" title="Sign out">Sign out</button>
          ${isOwner ? '<button class="nav-burger" id="nav-burger" type="button" aria-label="Menu">&#9776;</button>' : ""}
        </div>
      </div>
      ${isOwner ? `<div class="nav-owner" id="nav-owner"><div class="nav-owner-inner">
            <select id="view-as" class="nav-pill" style="display:none;" title="View the portal as a mentor" aria-label="View as mentor"></select>
            ${ownerLinks}
          </div></div>` : ""}
      ${subLinks}
    </header>`;

  const chip = document.getElementById("user-chip");
  if (chip && email) chip.textContent = email;

  // A locked page pins its theme without touching what the rest of the portal
  // is set to, so switching the portal to light does not white out a screen
  // that is built dark.
  if (lockTheme) {
    document.documentElement.setAttribute("data-theme", lockTheme);
  } else {
    // Re-apply so the freshly injected icon matches the current theme.
    initTheme();
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      applyTheme(current === "dark" ? "light" : "dark");
    });
  }

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
