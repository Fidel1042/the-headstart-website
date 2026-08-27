// mentor-assets.js — the logo and the two photos, uploaded from the portal
// instead of emailed around.
//
// Drafts are copy, and copy can be written from a transcript. These three
// cannot: somebody has to find the file. That is why they were the part that
// kept getting forgotten. Uploading here parks them on the Airtable record so
// they are waiting when the profile gets shipped into the website files.
//
// Uploading a file ticks its own checkbox. The box means "the file is here",
// so it should not be possible to have one without the other.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com", "dev@localhost"];

// Each slot is an attachment field plus the checkbox it answers for.
//
// Only the card photo reaches the public site: it is the thumbnail on the
// landing page and the mentors page. The detail photo and the company logo are
// both internal, used on the consultation tool profile that gets screen-shared
// on calls, and only the 15 mentors marked `detailed: true` there have them.
// So the card photo is the one that blocks going live; the other two are not.
const SLOTS = {
  logo: { field: "fldjU1uwg28l9rKxk", name: "Company Logo File", check: "Logo Added" },
  cardPhoto: { field: "fldRsscfjff6BX8aR", name: "Card Photo File", check: "Card Photo" },
  detailPhoto: { field: "fldRUPRakaXts0UiI", name: "Detail Photo File", check: "Detail Photo" },
};

const REQUIRED = ["cardPhoto"];

// Airtable's upload endpoint rejects anything larger. Worth catching here so
// the failure says what is wrong rather than arriving as a raw 413.
const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml"];

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts || {}).headers },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

/**
 * Airtable takes the bytes directly on a separate host, so there is no need to
 * host the file publicly first just to hand over a URL.
 */
async function upload(base, recordId, fieldId, file, token) {
  const res = await fetch(
    `https://content.airtable.com/v0/${base}/${recordId}/${fieldId}/uploadAttachment`,
    { method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: file.type, file: file.data, filename: file.name }) });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error((data.error && (data.error.message || data.error.type)) || `Upload failed (${res.status})`);
  }
  return data;
}

const shapeSlots = (fields) => {
  const out = {};
  for (const [key, s] of Object.entries(SLOTS)) {
    const files = fields[s.name] || [];
    out[key] = files.length
      ? { filename: files[0].filename, url: files[0].url, size: files[0].size }
      : null;
  }
  return out;
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }
  if (!OWNERS.includes((p.adminEmail || "").toLowerCase().trim())) {
    return json(403, { error: "Not authorised" });
  }

  const { AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
          AIRTABLE_MENTOR_TABLE_ID: table } = process.env;
  if (!token || !base || !table) return json(500, { error: "Airtable env vars missing" });

  const slot = SLOTS[p.slot];
  if (!p.mentorId) return json(400, { error: "No mentor" });

  try {
    if (p.action === "upload") {
      if (!slot) return json(400, { error: "Unknown slot" });
      const f = p.file || {};
      if (!f.data) return json(400, { error: "No file" });
      if (!ALLOWED.includes(f.type)) {
        return json(400, { error: `${f.type || "That file"} is not an image Airtable will take` });
      }
      // base64 runs about a third larger than the bytes it encodes.
      if (Math.floor(f.data.length * 0.75) > MAX_BYTES) {
        return json(400, { error: "Too big. Airtable caps uploads at 5MB." });
      }

      // Airtable appends rather than replaces, so a second upload would leave
      // the old file sitting first in the list and that is the one that would
      // get shipped. Empty the slot first so it always holds exactly one file.
      await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH", body: JSON.stringify({ fields: { [slot.name]: [] } }),
      }, token);
      await upload(base, p.mentorId, slot.field, f, token);
      // Ticked only after the file is actually on the record.
      const saved = await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH", body: JSON.stringify({ fields: { [slot.check]: true } }),
      }, token);
      return json(200, { slots: shapeSlots(saved.fields), checks: {
        logo: Boolean(saved.fields["Logo Added"]),
        cardPhoto: Boolean(saved.fields["Card Photo"]),
        detailPhoto: Boolean(saved.fields["Detail Photo"]),
      } });
    }

    if (p.action === "clear") {
      if (!slot) return json(400, { error: "Unknown slot" });
      const saved = await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { [slot.name]: [], [slot.check]: false } }),
      }, token);
      return json(200, { slots: shapeSlots(saved.fields), checks: {
        logo: Boolean(saved.fields["Logo Added"]),
        cardPhoto: Boolean(saved.fields["Card Photo"]),
        detailPhoto: Boolean(saved.fields["Detail Photo"]),
      } });
    }

    if (p.action === "ready" || p.action === "unready") {
      const on = p.action === "ready";
      if (on) {
        // Marking a mentor ready with nothing attached would put an empty
        // record in the queue and waste the trip.
        const rec = await at(`${base}/${table}/${p.mentorId}`, {}, token);
        if (!(rec.fields["Drafts Approved"] || "")) {
          return json(400, { error: "Approve the drafts first." });
        }
        const missing = REQUIRED
          .filter((k) => !(rec.fields[SLOTS[k].name] || []).length)
          .map((k) => SLOTS[k].name.replace(" File", "").toLowerCase());
        if (missing.length) {
          return json(400, { error: `Still missing: ${missing.join(", ")}` });
        }
      }
      const saved = await at(`${base}/${table}/${p.mentorId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: { "Ready To Ship": on ? new Date().toISOString().slice(0, 10) : null } }),
      }, token);
      return json(200, { ready: (saved.fields["Ready To Ship"] || "").slice(0, 10) });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(502, { error: err.message || "Could not save that file" });
  }
};
