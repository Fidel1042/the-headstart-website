// require-owner.js — proves who is calling, instead of believing them.
//
// Every owner-gated function used to decide access like this:
//
//   if (!OWNERS.includes(payload.adminEmail)) return 403;
//
// The email came from the request body, so the caller declared their own
// identity and the server took their word for it. Anyone who knew an endpoint
// name and Fidel's email address could read leads, P&L, LTV and mentee phone
// numbers with a single unauthenticated POST. No login, no cookie, no token.
//
// Now the email comes from a Supabase access token that the portal already
// issues at login and that a caller cannot forge. The body is ignored.
//
// No new secrets: the project URL and the anon key are public values, already
// shipped in mentor-portal/auth.js. The user's access token is the secret, and
// only a genuine login produces one.

const SUPABASE_URL = "https://wfmtynqzdzpgymsgfjts.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aW85xzuqmyaGZYk__UxI0Q_VD-jcsWD";

/** The bearer token on the request, or "" when there is not one. */
function bearer(event) {
  const h = event.headers || {};
  const raw = h.authorization || h.Authorization || "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

/**
 * Ask Supabase who this token belongs to.
 *
 * Verifying against the auth server rather than checking a signature locally
 * costs one round trip, and buys two things worth more than the milliseconds:
 * no JWT secret has to be stored in Netlify, and a signed-out or revoked
 * session stops working immediately instead of staying valid until it expires.
 *
 * Returns a lower-cased email, or null for anything that is not a live session.
 */
async function emailFromToken(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && user.email ? String(user.email) : "").toLowerCase().trim() || null;
  } catch {
    // Supabase unreachable. Deny rather than fall back to the body, because a
    // fallback is exactly the hole this replaces.
    return null;
  }
}

/**
 * Gate a function on a signed-in owner.
 *
 *   const auth = await requireOwner(event, OWNERS);
 *   if (!auth.ok) return json(403, { error: auth.error });
 *
 * `auth.email` is the verified address. Never read the email from the body
 * again: that value is whatever the caller typed.
 */
async function requireOwner(event, owners) {
  const email = await emailFromToken(bearer(event));
  if (!email) return { ok: false, error: "Sign in required" };
  if (!owners.map((o) => String(o).toLowerCase()).includes(email)) {
    return { ok: false, error: "Not authorised" };
  }
  return { ok: true, email };
}

/** Same, for any signed-in portal user. Used by mentor-facing endpoints. */
async function requireUser(event) {
  const email = await emailFromToken(bearer(event));
  return email ? { ok: true, email } : { ok: false, error: "Sign in required" };
}

module.exports = { requireOwner, requireUser, emailFromToken, bearer };
