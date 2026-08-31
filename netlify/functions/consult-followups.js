// consult-followups.js — the post-consultation follow-up sequence.
//
// Someone who has had a consultation but not signed sits at "Waiting on
// Contract". They get four touches, and no more:
//
//   t+0   straight after the call, while it is still warm
//   t+1   the next day
//   t+3   the last of the standard three
//   t+20  one final nudge, but only if the call scored 40% or better.
//         Below that they said no in all but words, and chasing them three
//         weeks later just annoys someone who was never going to sign.
//   t+90  a check-in three months on, by email rather than WhatsApp. By then
//         it is not a sales follow-up, it is asking how the job hunt went, and
//         email is the right register for that. Everyone gets this one.
//
// "Follow Up Stage" counts how many touches have been sent, so the page always
// knows what is next without storing a date per touch. The plan differs by
// score, so the stage is an index into that lead's own plan, not a global one.

const { draftMessages } = require("../shared/drafts");
const { requireOwner } = require("../shared/require-owner");
const {
  TOUCHES, FINAL_TOUCH_MIN_PCT, CHECKIN_SUBJECT, checkinBody,
  scoreOf, nextTouch, ymd, daysBetween,
} = require("../shared/followups");

// The one touch this page is for.
const FINAL_TOUCH_DAY = 20;

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// The stage a consultation is in while it is still worth chasing.
const OPEN_STAGE = "Waiting on Contract";


async function fetchAll(baseId, tableId, fields, token) {
  const out = [];
  let offset = null;
  do {
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}` +
      `?${fields.map((f) => `fields[]=${encodeURIComponent(f)}`).join("&")}` +
      (offset ? `&offset=${offset}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || "Airtable error");
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

// Return a wa.me-ready international number (digits only, no +).
function normalizePhone(raw, aussie) {
  if (!raw) return "";
  let s = String(raw).trim().replace(/[\s\-()]/g, "");
  if (s.startsWith("+")) return s.replace(/^\+/, "");
  if (s.startsWith("00")) return s.slice(2);
  if (s.startsWith("0")) return "61" + s.slice(1);
  if (/^4\d{8}$/.test(s)) return "61" + s;
  if (aussie === "Aussie" && /^\d{8,9}$/.test(s)) return "61" + s.replace(/^0/, "");
  return s.replace(/\D/g, "");
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const auth = await requireOwner(event, OWNERS);
  if (!auth.ok) {
    return json(403, { error: "Not authorised" });
  }

  const { AIRTABLE_API_TOKEN, AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID } = process.env;

  try {
    const recs = await fetchAll(AIRTABLE_CORE_BASE_ID, AIRTABLE_MENTEE_TABLE_ID,
      ["Name", "First Name", "Client Pipeline", "Meeting Time", "Notes filled at",
       "Conversion %", "Drafts", "Gmail", "Phone Number", "Aussie Number", "Target Industry",
       "Follow Up Stage"], AIRTABLE_API_TOKEN);

    const today = ymd(new Date());

    const leads = recs
      .filter((r) => (r.fields["Client Pipeline"] || "") === OPEN_STAGE)
      .map((r) => {
        const f = r.fields;
        // The call itself is the anchor. When it is missing, the moment the
        // notes landed is the next best thing: Fathom writes them right after.
        const anchorRaw = f["Meeting Time"] || f["Notes filled at"] || "";
        const consultedOn = anchorRaw ? ymd(new Date(anchorRaw)) : "";
        const age = consultedOn ? daysBetween(consultedOn, today) : null;
        const score = scoreOf(f["Conversion %"]);
        const stage = Number(f["Follow Up Stage"]) || 0;
        const first = (f["First Name"] || String(f["Name"] || "").trim().split(/\s+/)[0] || "there");

        // The drafted messages cover the first three touches. The last one is
        // deliberately a single plain line: three weeks on, a long pitch reads
        // like a sales sequence, which is what it is.
        const drafted = draftMessages(f["Drafts"] || "");
        const byDay = {
          0: drafted[0] ? drafted[0].text : "",
          1: drafted[1] ? drafted[1].text : "",
          3: drafted[2] ? drafted[2].text : "",
          20: `Hey ${first}, still looking to get your grad role in Au?`,
          90: checkinBody(first, f["Target Industry"]),
        };

        // Where they are in their own sequence, from the shared resolver.
        const earnsFinal = (score || 0) >= FINAL_TOUCH_MIN_PCT;
        const t = nextTouch({ consultedOn, score, stage }, today);
        const { next, done, dueOn, due, plan } = t;

        return {
          id: r.id,
          next,
          name: f["Name"] || "Unnamed",
          first,
          consultedOn, age, score, stage, done,
          nextLabel: next ? `t+${next.day}` : "",
          channel: next ? next.channel : "",
          subject: next && next.channel === "email" ? CHECKIN_SUBJECT : "",
          dueOn,
          due,
          overdueBy: t.overdueBy,
          earnsFinal,
          planLength: plan.length,
          message: next ? (byDay[next.day] || "") : "",
          hasDraft: Boolean(drafted.length),
          email: f["Gmail"] || "",
          phone: normalizePhone(f["Phone Number"] || "", f["Aussie Number"] || ""),
        };
      });

    // Only the t+20 nudge. The first three touches happen in the day or two
    // after a call, when the lead is still front of mind and the message is
    // already drafted; they never needed a screen. t+20 is three weeks later,
    // against someone long forgotten, and only for the calls that scored well
    // enough to be worth one more try. That is the list worth showing.
    const atFinal = leads.filter((l) => l.next && l.next.day === FINAL_TOUCH_DAY);

    // Due first, most overdue at the top: that is the order to work down.
    const dueNow = atFinal.filter((l) => l.due)
      .sort((a, b) => b.overdueBy - a.overdueBy);
    const waiting = atFinal.filter((l) => !l.due)
      .sort((a, b) => (a.dueOn || "").localeCompare(b.dueOn || ""));
    // Everyone who has been through it, plus everyone who never earned one.
    const finished = leads.filter((l) => l.done)
      .sort((a, b) => (b.consultedOn || "").localeCompare(a.consultedOn || ""));
    const skipped = leads.filter((l) => !l.done && !l.earnsFinal)
      .sort((a, b) => (b.consultedOn || "").localeCompare(a.consultedOn || ""));

    return json(200, {
      dueNow, waiting, finished, skipped,
      touches: TOUCHES.map((t) => t.day),
      finalMinPct: FINAL_TOUCH_MIN_PCT,
      finalDay: FINAL_TOUCH_DAY,
    });
  } catch (err) {
    return json(502, { error: err.message || "Could not reach Airtable" });
  }
};
