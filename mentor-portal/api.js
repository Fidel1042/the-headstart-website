// api.js — the one way the portal talks to a Netlify function.
//
// Every call carries the Supabase access token, which is what the functions
// now check. Sending the caller's email in the body proved nothing, because
// the caller wrote it.
//
// Use callFn() for anything owner-gated. Passing adminEmail or ownerEmail in
// the body is harmless and still done in places for readability, but the
// server ignores it.

import { getSession } from "./auth.js";

/**
 * POST to a function with the signed-in user's token attached.
 *
 * @param {string} name  function name, e.g. "leads-attribution"
 * @param {object} body  JSON body
 * @returns {Promise<object>} parsed JSON
 * @throws {Error} on a non-2xx, carrying the server's message
 */
export async function callFn(name, body = {}) {
  const session = await getSession();
  const token = session && session.access_token ? session.access_token : "";

  const res = await fetch(`/.netlify/functions/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  // A function that failed to deploy returns Netlify's HTML error page, and
  // JSON.parse on it throws something unreadable. Say what actually happened.
  if (text.trim().startsWith("<")) {
    throw new Error("This page needs the live site. Preview mode cannot run the data function.");
  }
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`${name} returned something that is not JSON.`); }

  if (!res.ok) {
    // 403 after a real login almost always means the session expired rather
    // than that the account lost access, and "sign in again" is the fix.
    if (res.status === 403 && /sign in/i.test(data.error || "")) {
      throw new Error("Your session has expired. Refresh the page and sign in again.");
    }
    throw new Error(data.error || `${name} failed (${res.status})`);
  }
  return data;
}
