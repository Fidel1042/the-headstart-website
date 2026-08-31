// Shared Supabase client + auth helpers for the Headstart Mentor Portal.
// All protected pages import from this file via /mentor-portal/auth.js.

// ─── CONFIGURATION ────────────────────────────────────────────────────────────
// Paste your Supabase project values here (see SETUP.md).
//   1. https://supabase.com/dashboard → your project → Settings → API
//   2. Project URL → SUPABASE_URL
//   3. anon public key → SUPABASE_ANON_KEY
// The anon key is safe to expose; row-level security on the server enforces access.
export const SUPABASE_URL = "https://wfmtynqzdzpgymsgfjts.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_aW85xzuqmyaGZYk__UxI0Q_VD-jcsWD";

// Mentor email allowlist. Only emails on this list can complete signup.
// Add new mentors here as you onboard them. Lowercase, no spaces.
export const ALLOWED_MENTOR_EMAILS = [
  "fidelhon@gmail.com",
  "kokoro.araki1015@gmail.com",
  "angelicagrace160272@gmail.com",
  "aidanmwibrata@gmail.com",
  "samuelkember1@gmail.com",
  "wooheehan3@gmail.com",
  "edrickkoda@gmail.com",
  "laljimkf@gmail.com",
  "dhulipatideepika@gmail.com",
  "raunaqrsa@gmail.com",
  "jai.arora115@gmail.com",
  "brendonvo@outlook.com",
  "luischua18@gmail.com",
  "shriyanssh@gmail.com",
  "shifatrahman@gmail.com",
  "palakbedi2004@gmail.com",
  "abeshek1997@gmail.com",
];

// Owners who see a reduced portal. Koko runs mentee support, not money, so the
// billing (charging mentees) and payslips (paying mentors) pages are hidden
// from her nav and blocked if she reaches the URL directly. Keyed by page id.
/**
 * Owners who only see part of the portal.
 *
 * `only` is an allowlist of page keys. Everything else disappears from the nav
 * AND is bounced on a direct visit. An allowlist rather than a denylist on
 * purpose: a denylist silently exposes every page added later, which is the
 * wrong default for someone who should be looking at one screen.
 *
 * `home` is where they land, and where any other portal URL sends them.
 */
export const LIMITED_OWNERS = {
  "kokoro.araki1015@gmail.com": {
    // Finance is fine for a co-founder. Everything else in Mentors, and the
    // whole of Consultation, Calls, Leads and Mentees, stays hidden.
    only: ["second-interviews", "billing", "payslips", "pl", "ltv"],
    home: "/mentor-portal/second-interviews.html",
  },
};

const limitFor = (email) => LIMITED_OWNERS[String(email || "").toLowerCase().trim()] || null;

/** Whether an owner is allowed to see a given owner page. */
export function ownerCanSee(email, page) {
  const rule = limitFor(email);
  if (!rule) return true;
  if (rule.only) return rule.only.includes(page);
  return !(rule.hidden || []).includes(page);
}

/**
 * The page key a portal path belongs to, or null if it is not a nav page.
 * admin.html carries several keys behind ?view=, so it deliberately resolves
 * to whichever comes first: a limited owner has none of them either way, and
 * failing closed is the right way to be wrong here.
 */
function pageForPath(path) {
  for (const area of NAV_AREAS) {
    for (const link of area.links) {
      if (link.href.split("?")[0] === path) return link.page;
    }
  }
  return null;
}

/** Whether this owner may open this path at all. */
export function ownerCanOpen(email, path) {
  const rule = limitFor(email);
  if (!rule) return true;
  return ownerCanSee(email, pageForPath(path));
}

/** Where a limited owner lands, or null if they are a full owner. */
export function ownerHome(email) {
  const rule = limitFor(email);
  return rule && rule.home ? rule.home : null;
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { NAV_AREAS } from "./portal-nav-links.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles OAuth callback in the URL hash
  },
});

/**
 * Attach the session token to every portal call to a Netlify function.
 *
 * The functions used to decide access from an email in the request body, which
 * the caller wrote, so anyone could claim to be an owner. They now verify a
 * Supabase token instead. Rather than edit two dozen call sites and risk
 * missing one, the header is added here, in the one module every portal page
 * already imports.
 *
 * Only requests to /.netlify/functions/ are touched. Supabase's own calls go to
 * a different origin and fall straight through, so getSession() cannot recurse
 * into this.
 *
 * portal-access is the exception by nature: checkAccess() runs during login,
 * before a session exists, so it simply goes without a token.
 */
(function attachToken() {
  if (typeof window === "undefined" || window.__hsFetchPatched) return;
  window.__hsFetchPatched = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.startsWith("/.netlify/functions/")) return nativeFetch(input, init);

    const opts = { ...(init || {}) };
    const headers = new Headers(opts.headers || {});
    if (!headers.has("Authorization")) {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data && data.session ? data.session.access_token : "";
        if (token) headers.set("Authorization", `Bearer ${token}`);
      } catch { /* no session, let the function decide */ }
    }
    opts.headers = headers;
    return nativeFetch(input, opts);
  };
})();


// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Check if an email is on the hardcoded fallback list. */
export function isAllowedEmail(email) {
  if (!email) return false;
  return ALLOWED_MENTOR_EMAILS
    .map((e) => e.trim().toLowerCase())
    .includes(email.trim().toLowerCase());
}

/**
 * Whether this email may use the portal, with Airtable as the authority:
 * Status "Hired" gets in, anything else does not. That means hiring somebody
 * grants access with no deploy, and dropping somebody removes it the same way.
 *
 * The list above is the fallback, used only when the lookup cannot be reached.
 * A broken lookup must never lock the team out of their own portal, and it must
 * never let somebody in who was never on the list to begin with.
 *
 * Cached for the tab so it costs one request per session, not one per page.
 */
const ACCESS_KEY = "headstart_portal_access";

export async function checkAccess(email) {
  if (!email) return false;
  const key = email.trim().toLowerCase();
  try {
    const cached = sessionStorage.getItem(`${ACCESS_KEY}:${key}`);
    if (cached !== null) return cached === "1";
  } catch (e) { /* private mode, just ask again */ }

  try {
    const res = await fetch("/.netlify/functions/portal-access", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: key }),
    });
    if (!res.ok) return isAllowedEmail(key);
    const data = await res.json();
    if (typeof data.allowed !== "boolean") return isAllowedEmail(key);
    try { sessionStorage.setItem(`${ACCESS_KEY}:${key}`, data.allowed ? "1" : "0"); } catch (e) {}
    return data.allowed;
  } catch (e) {
    return isAllowedEmail(key);
  }
}

/**
 * Ask the browser to remember this login so the phone can autofill it behind
 * Face ID / fingerprint next time. Uses the Credential Management API where
 * available (Chrome, Android); on iOS Safari the browser's own save prompt
 * handles it through the form's autocomplete attributes. Never blocks login.
 */
export async function saveCredential(id, password) {
  try {
    if (window.PasswordCredential && id && password) {
      const cred = new window.PasswordCredential({ id, password });
      await navigator.credentials.store(cred);
    }
  } catch (_) { /* saving is a convenience, never surface an error */ }
}

/** Get the current session (or null). */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.warn("getSession error:", error);
    return null;
  }
  return data.session || null;
}

/** Sign out and redirect to the login page. */
export async function signOut() {
  await supabase.auth.signOut();
  window.location.replace("/mentor-portal/login.html");
}

/**
 * Auth guard for protected pages.
 * - Redirects to login if no session, preserving the current path as ?next=...
 * - If the session exists but the user's email is not on the allowlist,
 *   signs them out and shows a blocked message.
 * - Once authed, calls onAuth(session) and reveals the body.
 */
export async function requireAuth(onAuth) {
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    document.documentElement.classList.add('auth-ok');
    if (typeof onAuth === 'function') onAuth({ user: { email: 'dev@localhost' } });
    return;
  }

  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/mentor-portal/login.html?next=${next}`);
    return;
  }
  // Verify allowlist (defence in depth — server should also enforce via RLS / trigger)
  const email = session.user?.email;
  if (!(await checkAccess(email))) {
    await supabase.auth.signOut();
    window.location.replace(
      `/mentor-portal/login.html?error=${encodeURIComponent(
        "Your account is not on the mentor allowlist. Contact Fidel."
      )}`
    );
    return;
  }
  // A limited owner gets exactly one page. Enforced here rather than per page,
  // so anything added later is closed to them by default instead of open.
  const home = ownerHome(email);
  if (home && !ownerCanOpen(email, window.location.pathname)) {
    window.location.replace(home);
    return;
  }

  document.documentElement.classList.add("auth-ok");
  if (typeof onAuth === "function") onAuth(session);
}

/** Helper to build a "Sign out" button bound to signOut(). */
export function bindSignOutButton(selector) {
  const el = document.querySelector(selector);
  if (!el) return;
  el.addEventListener("click", (e) => {
    e.preventDefault();
    signOut();
  });
}
