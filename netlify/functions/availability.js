// availability.js — the shared calendar between a mentor and their mentee.
//
// Three jobs, one endpoint, chosen by `action`:
//
//   mentor  who the mentor link belongs to, plus what they have already put in
//   save    replace a mentor's open blocks with the ones just picked
//   mentee  what a mentee sees: their mentor's open blocks
//   book    a mentee takes one, and it stops being open for anyone else
//
// Identity is the Airtable record id carried in the link. Those are 17
// characters of random, so they are unguessable in practice, and it means a
// mentor filling this in from a WhatsApp link needs no password on a phone.

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
const json = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });

const TABLE = "Availability";
const DAYS_AHEAD = 21;

// The blocks on offer. Kept coarse on purpose: a mentor picking "6pm to 9pm"
// in one tap is the point, and the pair settle the exact minute in chat.
const SLOTS = {
  morning: "9am to 12pm",
  arvo: "12pm to 3pm",
  late: "3pm to 6pm",
  evening: "6pm to 9pm",
};

const ymd = (d) => new Date(d).toISOString().slice(0, 10);
const today = () => ymd(Date.now());

async function at(path, opts, token) {
  const res = await fetch(`https://api.airtable.com/v0/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts || {}).headers },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data;
}

async function fetchAll(baseId, table, token, filter) {
  const out = [];
  let offset = null;
  do {
    const q = `?pageSize=100${filter ? `&filterByFormula=${encodeURIComponent(filter)}` : ""}` +
      (offset ? `&offset=${offset}` : "");
    const data = await at(`${baseId}/${encodeURIComponent(table)}${q}`, {}, token);
    out.push(...(data.records || []));
    offset = data.offset || null;
  } while (offset);
  return out;
}

/** Open, future blocks for one mentor, oldest first. */
async function openBlocks(baseId, token, mentorId) {
  const rows = await fetchAll(baseId, TABLE, token,
    `AND({Mentor Id}="${mentorId}", {Status}="Open", IS_AFTER({Date}, "${today()}"))`);
  return rows
    .map((r) => ({
      id: r.id, date: (r.fields["Date"] || "").slice(0, 10),
      slot: r.fields["Slot"], label: SLOTS[r.fields["Slot"]] || r.fields["Slot"],
    }))
    .filter((b) => b.date && b.slot)
    .sort((a, b) => a.date.localeCompare(b.date) ||
      Object.keys(SLOTS).indexOf(a.slot) - Object.keys(SLOTS).indexOf(b.slot));
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let p;
  try { p = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON" }); }

  const {
    AIRTABLE_API_TOKEN: token, AIRTABLE_CORE_BASE_ID: base,
    AIRTABLE_MENTOR_TABLE_ID: mentorTable, AIRTABLE_MENTEE_TABLE_ID: menteeTable,
  } = process.env;

  try {
    /* ---- who a mentor link belongs to, and what they already offered ---- */
    if (p.action === "mentor") {
      const rec = await at(`${base}/${mentorTable}/${p.mentorId}`, {}, token).catch(() => null);
      if (!rec || !rec.fields) return json(404, { error: "That link does not match a mentor" });
      return json(200, {
        mentorId: p.mentorId,
        name: rec.fields["Name"] || "",
        blocks: await openBlocks(base, token, p.mentorId),
        slots: SLOTS, daysAhead: DAYS_AHEAD,
      });
    }

    /* ---- a mentor saving what they picked ---- */
    if (p.action === "save") {
      const rec = await at(`${base}/${mentorTable}/${p.mentorId}`, {}, token).catch(() => null);
      if (!rec || !rec.fields) return json(404, { error: "That link does not match a mentor" });

      const picked = Array.isArray(p.blocks) ? p.blocks : [];
      const valid = picked.filter((b) => SLOTS[b.slot] && /^\d{4}-\d{2}-\d{2}$/.test(b.date)
        && b.date > today());

      // Existing rows for this mentor. A block already taken is left alone:
      // withdrawing a time a mentee has booked would silently cancel on them.
      const existing = await fetchAll(base, TABLE, token, `{Mentor Id}="${p.mentorId}"`);
      const byKey = new Map(existing.map((r) => [r.fields["Key"], r]));
      const wanted = new Set(valid.map((b) => `${p.mentorId}|${b.date}|${b.slot}`));

      const toCreate = valid
        .filter((b) => !byKey.has(`${p.mentorId}|${b.date}|${b.slot}`))
        .map((b) => ({ fields: {
          Key: `${p.mentorId}|${b.date}|${b.slot}`,
          "Mentor Id": p.mentorId,
          "Mentor Name": rec.fields["Name"] || "",
          "Mentor Email": (rec.fields["Email"] || "").toLowerCase().trim(),
          Date: b.date, Slot: b.slot, Status: "Open", Updated: today(),
        } }));

      const toWithdraw = existing.filter((r) =>
        r.fields["Status"] === "Open" && !wanted.has(r.fields["Key"]));

      for (let i = 0; i < toCreate.length; i += 10) {
        await at(`${base}/${encodeURIComponent(TABLE)}`,
          { method: "POST", body: JSON.stringify({ records: toCreate.slice(i, i + 10), typecast: true }) }, token);
      }
      for (let i = 0; i < toWithdraw.length; i += 10) {
        await at(`${base}/${encodeURIComponent(TABLE)}`, {
          method: "PATCH",
          body: JSON.stringify({ records: toWithdraw.slice(i, i + 10)
            .map((r) => ({ id: r.id, fields: { Status: "Withdrawn", Updated: today() } })) }),
        }, token);
      }

      return json(200, {
        saved: valid.length, added: toCreate.length, withdrawn: toWithdraw.length,
        kept: existing.filter((r) => r.fields["Status"] === "Booked").length,
        blocks: await openBlocks(base, token, p.mentorId),
      });
    }

    /* ---- what a mentee sees ---- */
    if (p.action === "mentee") {
      const rec = await at(`${base}/${menteeTable}/${p.menteeId}`, {}, token).catch(() => null);
      if (!rec || !rec.fields) return json(404, { error: "That link does not match a mentee" });
      const mentorEmail = (rec.fields["Mentor Email Plain"] || "").toLowerCase().trim();
      if (!mentorEmail) {
        return json(200, { name: rec.fields["Name"] || "", mentor: "", blocks: [], noMentor: true });
      }
      const mentors = await fetchAll(base, mentorTable, token, `LOWER({Email})="${mentorEmail}"`);
      const mentor = mentors[0];
      if (!mentor) return json(200, { name: rec.fields["Name"] || "", mentor: "", blocks: [], noMentor: true });

      // A booking this mentee already made, so the page can say so rather than
      // letting them book a second first session.
      const mine = await fetchAll(base, TABLE, token,
        `AND({Booked By Id}="${p.menteeId}", {Status}="Booked")`);
      return json(200, {
        name: rec.fields["First Name"] || rec.fields["Name"] || "",
        mentor: mentor.fields["Name"] || "your mentor",
        blocks: await openBlocks(base, token, mentor.id),
        booked: mine.length ? {
          date: (mine[0].fields["Date"] || "").slice(0, 10),
          label: SLOTS[mine[0].fields["Slot"]] || "",
        } : null,
        slots: SLOTS,
      });
    }

    /* ---- a mentee taking a block ---- */
    if (p.action === "book") {
      const rec = await at(`${base}/${menteeTable}/${p.menteeId}`, {}, token).catch(() => null);
      if (!rec || !rec.fields) return json(404, { error: "That link does not match a mentee" });

      const row = await at(`${base}/${encodeURIComponent(TABLE)}/${p.blockId}`, {}, token).catch(() => null);
      if (!row || !row.fields) return json(404, { error: "That time is no longer there" });
      // Re-read before writing: two mentees on the page at once must not both
      // get the same slot.
      if (row.fields["Status"] !== "Open") {
        return json(409, { error: "Somebody just took that time. Pick another one." });
      }

      const name = rec.fields["Name"] || "A mentee";
      await at(`${base}/${encodeURIComponent(TABLE)}/${p.blockId}`, {
        method: "PATCH",
        body: JSON.stringify({ fields: {
          Status: "Booked", "Booked By": name, "Booked By Id": p.menteeId,
          "Booked At": new Date().toISOString(),
          "Agreed Time": `${row.fields["Date"]} ${SLOTS[row.fields["Slot"]] || ""}`,
        } }),
      }, token);

      return json(200, {
        booked: true,
        date: (row.fields["Date"] || "").slice(0, 10),
        label: SLOTS[row.fields["Slot"]] || "",
        mentor: row.fields["Mentor Name"] || "",
        mentorEmail: row.fields["Mentor Email"] || "",
        mentee: name,
      });
    }

    return json(400, { error: "Unknown action" });
  } catch (err) {
    return json(502, { error: err.message || "Availability failed" });
  }
};
