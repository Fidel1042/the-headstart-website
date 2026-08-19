// email-snapshot.js — copies Brevo email stats into Airtable, for good.
//
// Brevo answers a 90-day window and nothing older. That is fine for "how did
// last month go" and useless for "show me the year". This runs daily, reads
// the whole window Brevo will give, rolls it into one row per email per week,
// and upserts those rows into the Email Stats table. Airtable keeps them
// forever, so the year builds itself a week at a time.
//
// Two properties make it safe to run as often as you like:
//
//   Idempotent. Rows are keyed "week|email" and upserted, so a re-run
//   overwrites rather than duplicating.
//
//   Self-correcting. Opens keep arriving for days after a send, so a week
//   snapshotted on Monday is wrong by Friday. Re-reading the full 90 days
//   every run means every week is rewritten until it falls out of Brevo's
//   window, by which time it has long since settled.
//
// Manual run, writes nothing:  /.netlify/functions/email-snapshot?dryRun=1

const headers = { "Content-Type": "application/json" };
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const TABLE = "Email Stats";
const WINDOW_DAYS = 89;           // Brevo refuses a range wider than 90
const AIRTABLE_BATCH = 10;        // hard limit on records per upsert call

// The emails worth a permanent record. A subject can carry a date or a name,
// so each is matched by shape. Anything unmatched is reported, not stored.
const EMAILS = [
  ["Consultation: booking confirmation", /^(subject:\s*)?locked in: your headstart consultation/i],
  ["Consultation: morning of", /^initial consultation: see you today/i],
  ["Consultation: 2 hours before", /^initial consultation: see you in 2 hours/i],
  ["Consultation: no-show follow-up", /^missed you on the consultation/i],
  ["Consultation: pick a time", /^you.re almost in/i],
  ["Session reminder (mentee)", /^reminder: you have a session tomorrow/i],
  ["Follow-up: still job hunting", /^still job hunting/i],
  ["Follow-up: 90 day check-in", /^how did the job search go/i],
  ["Payslip", /^your headstart payslip/i],
  ["Invoice", /^your headstart invoice/i],
];
const classify = (s) => (EMAILS.find(([, re]) => re.test(String(s || "").trim())) || [])[0] || null;

const EVENTS = ["requests", "delivered", "opened", "loadedByProxy", "clicks",
                "softBounces", "hardBounces", "unsubscribed"];

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** Monday of the week a date falls in, as YYYY-MM-DD. */
function weekOf(date) {
  const d = new Date(String(date).slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return ymd(d);
}

async function pullEvents(apiKey, event, start, end) {
  const out = [];
  for (let offset = 0; offset <= 30000; offset += 2500) {
    const url = `https://api.brevo.com/v3/smtp/statistics/events` +
      `?limit=2500&offset=${offset}&startDate=${start}&endDate=${end}&event=${event}`;
    const res = await fetch(url, { headers: { "api-key": apiKey, accept: "application/json" } });
    const data = await res.json();
    if (data.code) break;
    const rows = data.events || [];
    out.push(...rows);
    if (rows.length < 2500) break;
  }
  return out;
}

/**
 * Roll raw events into one record per email per week.
 *
 * The open rate is measured only on recipients no mail-app proxy touched, then
 * applied to all of them. Apple's pre-fetch both fakes opens and suppresses
 * real ones, so the raw count is wrong in both directions. The parts are stored
 * alongside the rate so any other definition can be recomputed later without
 * needing Brevo again.
 */
function rollUp(all) {
  const buckets = new Map();
  const bucket = (week, email) => {
    const key = `${week}|${email}`;
    if (!buckets.has(key)) {
      buckets.set(key, { key, week, email, ids: {} });
      EVENTS.forEach((e) => { buckets.get(key).ids[e] = new Set(); });
    }
    return buckets.get(key);
  };

  // A message belongs to the week it was SENT, not the week it was opened, or
  // an open landing on Monday would create a phantom row in the wrong week.
  const sentWeek = new Map();
  all.filter((x) => x._ev === "requests")
    .forEach((x) => sentWeek.set(x.messageId, weekOf(x.date)));

  all.forEach((x) => {
    const email = classify(x.subject);
    const week = sentWeek.get(x.messageId) || weekOf(x.date);
    if (!email || !week) return;
    bucket(week, email).ids[x._ev].add(x.messageId);
  });

  return [...buckets.values()].map((b) => {
    const n = (e) => b.ids[e].size;
    const delivered = n("delivered");
    const cleanOpens = [...b.ids.opened].filter((id) => !b.ids.loadedByProxy.has(id)).length;
    const cleanRecipients = delivered - [...b.ids.loadedByProxy].filter((id) => b.ids.delivered.has(id)).length;
    const base = delivered || n("requests") || 1;
    return {
      Key: b.key,
      Week: b.week,
      Email: b.email,
      Sent: n("requests"),
      Delivered: delivered,
      Opened: n("opened"),
      "Proxy Touched": n("loadedByProxy"),
      "Clean Opens": cleanOpens,
      "Clean Recipients": cleanRecipients,
      Clicked: n("clicks"),
      Bounced: n("softBounces") + n("hardBounces"),
      Unsubscribed: n("unsubscribed"),
      "Open Rate": cleanRecipients > 0
        ? Math.round((cleanOpens / cleanRecipients) * 100)
        : Math.round((n("opened") / base) * 100),
      "Click Rate": Math.round((n("clicks") / base) * 100),
    };
  }).filter((r) => r.Sent > 0 || r.Delivered > 0);
}

/** Upsert on Key, so a re-run rewrites a week instead of duplicating it. */
async function upsert(rows, baseId, token, today) {
  let created = 0, updated = 0;
  for (let i = 0; i < rows.length; i += AIRTABLE_BATCH) {
    const slice = rows.slice(i, i + AIRTABLE_BATCH);
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(TABLE)}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn: ["Key"] },
          typecast: true,
          records: slice.map((fields) => ({ fields: { ...fields, "Last Snapshot": today } })),
        }),
      });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    created += (data.createdRecords || []).length;
    updated += (data.updatedRecords || []).length;
  }
  return { created, updated };
}

exports.handler = async (event) => {
  const { BREVO_API_KEY, AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID } = process.env;
  const dryRun = Boolean(event && event.queryStringParameters && event.queryStringParameters.dryRun);

  if (!BREVO_API_KEY) return json(500, { error: "BREVO_API_KEY missing" });

  // Brevo reads dates as UTC, so asking for today's Melbourne date is rejected
  // as being in the future. Yesterday is always safe.
  const end = ymd(Date.now() - 86400000);
  const start = ymd(Date.now() - 86400000 - WINDOW_DAYS * 86400000);

  try {
    const all = [];
    for (const ev of EVENTS) {
      (await pullEvents(BREVO_API_KEY, ev, start, end)).forEach((x) => all.push({ ...x, _ev: ev }));
    }

    const rows = rollUp(all).sort((a, b) => a.Key.localeCompare(b.Key));
    const unmatched = [...new Set(all.filter((x) => x._ev === "requests" && !classify(x.subject))
      .map((x) => x.subject))];

    if (dryRun) {
      return json(200, { dryRun: true, window: [start, end], events: all.length,
        weeks: rows.length, unmatched: unmatched.slice(0, 20), sample: rows.slice(0, 5) });
    }

    const result = await upsert(rows, AIRTABLE_CORE_BASE_ID, AIRTABLE_API_TOKEN, ymd(Date.now()));
    return json(200, { window: [start, end], events: all.length, weeks: rows.length, ...result });
  } catch (err) {
    return json(502, { error: err.message || "Snapshot failed" });
  }
};
