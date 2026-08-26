// interview-confirm.js — the yes/no behind the link in an interview invitation.
//
// Public on purpose. The only key is the mentor's Airtable record id, which is
// already in the link they were emailed, and the worst a stranger could do with
// a guessed id is answer a question about somebody else's interview. No mentee
// data and no money sit behind it, so an auth wall would only cost confirmations.
//
// Round aware: someone at Second Interview is answering about the interview
// with Koko, not the first one weeks ago.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const ZOOM = {
  link: "https://us05web.zoom.us/j/2123046742?pwd=yjlZs0E8tBH3CEkLVuH4txJUoYnabe.1&omn=84465105461",
  passcode: "cRsn5u",
};
const ZOOM_FINAL = {
  link: "https://us05web.zoom.us/j/5621268756?pwd=j2kvxFvi6QOXQhD4b9GdNZNBUjFzYg.1",
  passcode: "1234",
};

const ANSWERS = ["Yes", "No"];

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts || {}).headers },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid request" }); }
  if (!p.mentorId) return json(400, { error: "No interview to confirm" });

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTOR_TABLE_ID: table } = process.env;

  try {
    const rec = await at(`${base}/${table}/${p.mentorId}`, {}, token).catch(() => null);
    if (!rec || !rec.fields) return json(404, { error: "We could not find that interview" });

    const f = rec.fields;
    const isFinal = (f["Status"] || "") === "Second Interview";
    const when = (isFinal ? f["Second Interview Date"] : f["First Interview Date"]) || "";
    if (!when) return json(404, { error: "That interview has not been scheduled yet" });

    const room = isFinal ? ZOOM_FINAL : ZOOM;
    const state = {
      name: String(f["Name"] || "").trim().split(/\s+/)[0] || "",
      at: when,
      zoom: room.link,
      passcode: room.passcode,
      answer: f["Interview Response"] || "",
    };

    if (p.answer === undefined) return json(200, state);

    if (!ANSWERS.includes(p.answer)) return json(400, { error: "That is not a valid answer" });

    const saved = await at(`${base}/${table}/${p.mentorId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fields: {
          "Interview Response": p.answer,
          "Interview Responded At": new Date().toISOString(),
        },
      }),
    }, token);

    return json(200, { ...state, answer: saved.fields["Interview Response"] || p.answer });
  } catch (err) {
    return json(502, { error: "Could not save that just now" });
  }
};
