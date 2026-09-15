// channel-refresh.js — keeps reach current without anyone remembering to.
//
// Three jobs, daily, in this order because each one can fail on its own:
//
//   1. Refresh the Instagram token. An IGAA token lives 60 days and can be
//      exchanged for a fresh 60 days any time before it dies, so touching it
//      daily means it never expires again. The new token is written straight
//      back into the site's own environment through the Netlify API, so there
//      is no copy on anyone's laptop to go stale.
//
//      This is the failure that was always coming: the token was minted by
//      hand, lived in two places that had already drifted apart, and would
//      have died quietly 60 days after whichever copy was last touched.
//
//   2. Pull Instagram reach into the Channel Stats table, keyed on
//      "channel|week", so rerunning a day corrects a week instead of
//      duplicating it. The current week is rewritten every run and only
//      settles once it is complete.
//
//   3. Check how old the LinkedIn numbers are. LinkedIn publishes no API for a
//      personal profile, so that export genuinely has to be downloaded by
//      hand. What can be automated is the noticing, and this emails Fidel once
//      the data goes stale rather than letting a flat line pass for a quiet
//      week.
//
// Silent when everything is fine. An email means something needs doing.

const SITE_ID = "0d9f1de6-3df0-4cbc-822e-efa03a90cb64";
const ACCOUNT = "theuniheadstart";
const STATS_TABLE = "tbltaZOnKGN7zRHfY";

// How many days of LinkedIn silence is worth an email. The export is weekly, so
// this allows a full week plus a few days of slippage before it nags.
const LINKEDIN_STALE_DAYS = 11;
// How much Instagram history to rewrite each run. Long enough to correct a week
// that was still running last time, short enough to stay cheap.
const IG_WEEKS = 6;

const SENDER = { name: "The Headstart", email: "fidel@theheadstartmentoring.com" };
const TO = [{ email: "fidelhon@gmail.com", name: "Fidel" }];

const TZ = "Australia/Sydney";
const ymd = (d) => new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** The Monday of whatever week a date falls in, in Sydney. */
function monday(d) {
  const local = new Date(`${ymd(d)}T00:00:00Z`);
  const shift = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - shift);
  return local.toISOString().slice(0, 10);
}

async function jsonFetch(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (body && (body.error?.message || body.message)) || text.slice(0, 200);
    throw new Error(`${res.status} ${msg}`);
  }
  return body;
}

// --- 1. the token ---------------------------------------------------------

/**
 * Swap the current token for a fresh 60 days and store it back on the site.
 *
 * Returns the token to keep using. On failure it returns the old one, because
 * a refresh that did not work does not stop today's numbers being collected:
 * the old token is valid until it is not.
 */
async function refreshToken(token, netlifyToken, notes) {
  let fresh;
  try {
    const out = await jsonFetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token` +
      `&access_token=${encodeURIComponent(token)}`);
    fresh = out.access_token;
    if (!fresh) throw new Error("no access_token in the response");
    const days = Math.round((out.expires_in || 0) / 86400);
    if (days && days < 20) {
      notes.push(`Instagram token only renewed for ${days} days, which is short. ` +
        `It is normally 60. Worth checking the app in Meta.`);
    }
  } catch (e) {
    notes.push(`Could not refresh the Instagram token: ${e.message}. ` +
      `It still works for now, but it dies 60 days after it was last renewed, ` +
      `and after that reach stops updating.`);
    return token;
  }

  if (!netlifyToken) {
    notes.push("NETLIFY_API_TOKEN is not set, so the refreshed Instagram token " +
      "could not be saved. It will be refreshed again tomorrow from the old one, " +
      "which works until the old one expires.");
    return fresh;
  }
  try {
    await jsonFetch(
      `https://api.netlify.com/api/v1/accounts/${ACCOUNT}/env/IG_TOKEN?site_id=${SITE_ID}`,
      { method: "PATCH",
        headers: { Authorization: `Bearer ${netlifyToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ context: "all", value: fresh }) });
  } catch (e) {
    notes.push(`The Instagram token was refreshed but could not be saved back: ${e.message}`);
  }
  return fresh;
}

// --- 2. Instagram ---------------------------------------------------------

/** Weekly reach for the last IG_WEEKS weeks, Monday keyed. */
async function instagramWeeks(token) {
  const since = new Date(Date.now() - IG_WEEKS * 7 * 86400000);
  const url = `https://graph.instagram.com/me/insights` +
    `?metric=reach&period=day&since=${ymd(since)}&until=${ymd(new Date())}` +
    `&access_token=${encodeURIComponent(token)}`;
  const out = await jsonFetch(url);
  const values = (out.data || []).find((m) => m.name === "reach")?.values || [];

  const weeks = new Map();
  for (const v of values) {
    // end_time is the end of that day's window, so the day it describes is the
    // one before it. Getting this wrong shifts every number a day left.
    const day = new Date(new Date(v.end_time).getTime() - 86400000);
    const key = monday(day);
    const w = weeks.get(key) || { impressions: 0, days: 0 };
    w.impressions += v.value || 0;
    w.days += 1;
    weeks.set(key, w);
  }
  return weeks;
}

// --- 3. Airtable ----------------------------------------------------------

async function airtable(path, opts, token) {
  return jsonFetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
}

async function allRows(base, token) {
  const out = [];
  let offset = null;
  do {
    const d = await airtable(`${base}/${STATS_TABLE}?pageSize=100${offset ? `&offset=${offset}` : ""}`, {}, token);
    out.push(...(d.records || []));
    offset = d.offset || null;
  } while (offset);
  return out;
}

exports.handler = async () => {
  const {
    IG_TOKEN, NETLIFY_API_TOKEN, AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, BREVO_API_KEY,
  } = process.env;
  const notes = [];
  const done = [];

  if (!AIRTABLE_API_TOKEN || !AIRTABLE_CORE_BASE_ID) {
    return { statusCode: 500, body: "Airtable credentials are not set" };
  }

  let token = IG_TOKEN;
  if (!token) {
    notes.push("IG_TOKEN is not set, so Instagram reach cannot update at all.");
  } else {
    token = await refreshToken(token, NETLIFY_API_TOKEN, notes);
  }

  const existing = await allRows(AIRTABLE_CORE_BASE_ID, AIRTABLE_API_TOKEN);
  const byKey = new Map(existing.map((r) => [r.fields["Key"], r]));

  // --- Instagram into the table ---
  if (token) {
    try {
      const weeks = await instagramWeeks(token);
      const creates = [];
      const updates = [];
      const now = new Date().toISOString();
      for (const [week, w] of weeks) {
        const key = `instagram|${week}`;
        const fields = {
          Key: key, Channel: "instagram", Week: week,
          Impressions: w.impressions, Days: w.days,
          Partial: w.days < 7, Source: "Meta Graph API", Updated: now,
        };
        const hit = byKey.get(key);
        if (hit) updates.push({ id: hit.id, fields });
        else creates.push({ fields });
      }
      for (let i = 0; i < creates.length; i += 10) {
        await airtable(`${AIRTABLE_CORE_BASE_ID}/${STATS_TABLE}`,
          { method: "POST", body: JSON.stringify({ records: creates.slice(i, i + 10), typecast: true }) },
          AIRTABLE_API_TOKEN);
      }
      for (let i = 0; i < updates.length; i += 10) {
        await airtable(`${AIRTABLE_CORE_BASE_ID}/${STATS_TABLE}`,
          { method: "PATCH", body: JSON.stringify({ records: updates.slice(i, i + 10), typecast: true }) },
          AIRTABLE_API_TOKEN);
      }
      done.push(`Instagram: ${creates.length} new week(s), ${updates.length} corrected.`);
    } catch (e) {
      notes.push(`Instagram reach did not update: ${e.message}`);
    }
  }

  // --- LinkedIn staleness ---
  // Measured weeks only. A projected week filling the gap would otherwise look
  // like fresh data and silence this, which is exactly backwards: the whole
  // point of projecting is to keep the chart readable WHILE the export is
  // late, not to stop asking for it.
  const li = existing
    .filter((r) => r.fields["Channel"] === "linkedin" && r.fields["Week"]
                && !r.fields["Estimated"])
    .map((r) => r.fields["Week"]).sort();
  const newest = li[li.length - 1] || null;
  const ageDays = newest
    ? Math.round((Date.now() - new Date(`${newest}T00:00:00Z`).getTime()) / 86400000)
    : null;
  if (ageDays === null) {
    notes.push("There is no LinkedIn data at all. Export it from LinkedIn and run the importer.");
  } else if (ageDays > LINKEDIN_STALE_DAYS) {
    notes.push(`The last measured LinkedIn week is ${newest}, ${ageDays} days ago. ` +
      `Anything since is projected from the KPI doc and is roughly 11% out. ` +
      `LinkedIn has no API for a personal profile, so this one needs the export: ` +
      `Profile, Analytics, Export, then drop the file into "LinkedIn post execution" ` +
      `and say it is there.`);
  }

  // Silence is the point. An email from this means something needs doing.
  if (notes.length && BREVO_API_KEY) {
    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: SENDER, to: TO,
        subject: notes.length === 1 ? "Channel stats need a hand" : `${notes.length} channel stats problems`,
        htmlContent: `<p>Morning Fidel,</p>` +
          notes.map((n) => `<p style="margin:0 0 12px">&bull; ${n}</p>`).join("") +
          (done.length ? `<p style="color:#777;font-size:13px">${done.join(" ")}</p>` : ""),
      }),
    }).catch(() => {});
  }

  return { statusCode: 200, body: JSON.stringify({ done, notes, linkedinNewest: newest, linkedinAgeDays: ageDays }) };
};
