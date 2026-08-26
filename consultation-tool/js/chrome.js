// chrome.js — the portal nav, on a consultation page.
//
// These screens used to carry their own nav bar with a "← Portal" link, which
// is what made them feel like a separate site: you left the portal to open
// them and had to come back out the same door. They mount the shared portal
// nav now, so Consultation reads as one more area alongside Mentors and Admin.
//
// Three things differ from an ordinary portal page:
//
//   1. The theme is pinned. Most of these screens are shown to a prospect on
//      a screen share and their styling assumes a black background, so the
//      portal being switched to light must not white them out.
//   2. The Live button survives. It reloads with a fresh ?v=, which the page
//      then passes to its own module import to skip the browser cache.
//   3. Present mode hides the nav. On a share the prospect would otherwise be
//      reading "Mentor Portal · Internal use only" and Fidel's email address
//      above the screen meant for them.

import { getSession } from "/mentor-portal/auth.js";
import { mountPortalNav } from "/mentor-portal/portal-ui.js";

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];

// Per tab, not permanent: a call runs across several of these screens, so the
// setting has to survive navigation, but the next time the tool is opened it
// should start normal rather than mysteriously chromeless.
const PRESENT_KEY = "headstart_presenting";

const isPresenting = () => {
  try { return sessionStorage.getItem(PRESENT_KEY) === "1"; } catch { return false; }
};

function setPresenting(on) {
  try { sessionStorage.setItem(PRESENT_KEY, on ? "1" : "0"); } catch { /* private mode */ }
  document.documentElement.classList.toggle("is-presenting", on);
}

/**
 * The way back out. Deliberately a bare dot in the corner: it has to be
 * findable by the one person looking for it and ignorable by everyone else,
 * so it stays nearly transparent until the pointer is on it.
 */
function addExitHandle() {
  const dot = document.createElement("button");
  dot.type = "button";
  dot.id = "present-exit";
  dot.title = "Show the menu again (Esc)";
  dot.setAttribute("aria-label", "Exit present mode");
  dot.addEventListener("click", () => setPresenting(false));
  document.body.appendChild(dot);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isPresenting()) setPresenting(false);
  });
}

/**
 * @param {string} active page key from portal-nav-links.js
 * @param {string} theme  the theme to pin. The call screens are light, matching
 *                        the call flow, which is Fidel's own script
 */
export async function mountConsultNav(active, theme = "light", present = true) {
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const session = local ? null : await getSession();
  const email = local ? "dev@localhost" : (session?.user?.email || "").toLowerCase().trim();

  // Before the nav is built, so a screen that was already being presented
  // never flashes the chrome on its way in.
  if (present && isPresenting()) document.documentElement.classList.add("is-presenting");

  mountPortalNav({ email, isOwner: true, active, lockTheme: theme });

  const actions = document.querySelector(".top-nav-actions");
  const pill = (label, title, onClick) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-pill";
    btn.title = title;
    btn.textContent = label;
    btn.addEventListener("click", onClick);
    actions.insertBefore(btn, actions.querySelector("#signout-btn"));
    return btn;
  };

  if (actions) {
    // Cache-bust in place, the same job the old nav's Live button did.
    pill("Live", "Reload this page past the browser cache",
      () => { location.href = location.pathname + "?v=" + Date.now(); });

    // Only the screens a prospect actually sees need hiding. The call flow is
    // Fidel's own script and never leaves his monitor.
    if (present) {
      pill("Present", "Hide the menu for screen share (Esc brings it back)",
        () => setPresenting(true));
      addExitHandle();
    }
  }

  // Carry ?v= across the nav so one Live click keeps every screen fresh for
  // the rest of the call, not just the one you were on.
  const v = new URLSearchParams(location.search).get("v");
  if (v) {
    document.querySelectorAll(".nav-sub-link, .nav-pill[href]").forEach((a) => {
      const u = new URL(a.getAttribute("href"), location.href);
      u.searchParams.set("v", v);
      a.setAttribute("href", u.pathname + u.search);
    });
  }
}
