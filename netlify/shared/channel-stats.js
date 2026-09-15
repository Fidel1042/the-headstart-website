// channel-stats.js — weekly reach per channel, from the table that updates
// itself rather than the file that did not.
//
// Reach used to live in netlify/data/channel-stats.json, written by a script on
// Fidel's laptop and deployed with the site. That meant every number on the
// dashboard was only as fresh as the last time somebody remembered, and a stale
// week looked exactly like a quiet one.
//
// It now lives in the Channel Stats table, which channel-refresh.js updates
// every morning. The JSON file is still read as a fallback so a bad Airtable
// call shows old numbers rather than an empty chart, and so the history that
// predates the table is never lost.

const TABLE = "tbltaZOnKGN7zRHfY";

function fallbackFile() {
  try { return require("../data/channel-stats.json"); }
  catch { return { linkedin: {}, instagram: {}, updated: null }; }
}

/**
 * @returns {Promise<{linkedin:Object, instagram:Object, updated:string|null, source:Object}>}
 *          Weeks keyed by Monday, same shape the pages have always consumed.
 */
async function channelStats(env) {
  const token = env.AIRTABLE_API_TOKEN;
  const base = env.AIRTABLE_CORE_BASE_ID;
  if (!token || !base) return fallbackFile();

  try {
    // Start from the file so everything it carries that the table does not,
    // notably posts_linkedin, survives. The table then overlays the weekly
    // reach, which is the only part that goes stale.
    const file = fallbackFile();
    const out = { ...file, linkedin: {}, instagram: {}, updated: null, source: { ...(file.source || {}) } };
    let offset = null;
    let newest = null;
    do {
      const url = `https://api.airtable.com/v0/${base}/${TABLE}` +
        `?pageSize=100${offset ? `&offset=${offset}` : ""}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Airtable error");
      for (const r of data.records || []) {
        const f = r.fields;
        const ch = f["Channel"];
        const week = (f["Week"] || "").slice(0, 10);
        if (!ch || !week || !out[ch]) continue;
        out[ch][week] = {
          impressions: Number(f["Impressions"]) || 0,
          engagements: Number(f["Engagements"]) || 0,
          days: Number(f["Days"]) || 0,
          partial: Boolean(f["Partial"]),
        };
        if (f["Source"]) out.source[ch] = f["Source"];
        if (f["Updated"] && (!newest || f["Updated"] > newest)) newest = f["Updated"];
      }
      offset = data.offset || null;
    } while (offset);

    // An empty table means the seed never ran, not that reach is zero. Showing
    // nothing there would read as a dead channel.
    if (!Object.keys(out.linkedin).length && !Object.keys(out.instagram).length) {
      return file;
    }
    out.updated = newest;
    return out;
  } catch {
    return fallbackFile();
  }
}

module.exports = { channelStats, TABLE };
