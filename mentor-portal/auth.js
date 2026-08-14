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
];

// Owners who see a reduced portal. Koko runs mentee support, not money, so the
// billing (charging mentees) and payslips (paying mentors) pages are hidden
// from her nav and blocked if she reaches the URL directly. Keyed by page id.
export const LIMITED_OWNERS = {
  // "leads" is Fidel's attribution dashboard, hidden from Koko by request.
  "kokoro.araki1015@gmail.com": ["billing", "payslips", "leads"],
};

/** Whether an owner is allowed to see a given owner page. */
export function ownerCanSee(email, page) {
  const hidden = LIMITED_OWNERS[String(email || "").toLowerCase().trim()] || [];
  return !hidden.includes(page);
}

// ─── CLIENT ───────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles OAuth callback in the URL hash
  },
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Check if an email is on the mentor allowlist. */
export function isAllowedEmail(email) {
  if (!email) return false;
  return ALLOWED_MENTOR_EMAILS
    .map((e) => e.trim().toLowerCase())
    .includes(email.trim().toLowerCase());
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
  if (!isAllowedEmail(email)) {
    await supabase.auth.signOut();
    window.location.replace(
      `/mentor-portal/login.html?error=${encodeURIComponent(
        "Your account is not on the mentor allowlist. Contact Fidel."
      )}`
    );
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
