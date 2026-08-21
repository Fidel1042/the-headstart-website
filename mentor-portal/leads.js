// leads.js — owner-only leads attribution.
// GA4 says where people came from and what they did on the site.
// Airtable says what happened after the call. This page shows both together,
// because traffic that never signs is not a lead.

import { requireAuth } from "./auth.js";
import { mountPortalNav, initTheme } from "./portal-ui.js";

initTheme();

const OWNERS = ["fidelhon@gmail.com", "kokoro.araki1015@gmail.com"];
const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

let ownerEmail = "";
let days = 90;
let mode = "first";   // "first" = new first-touch, "session" = GA4 history
let lastData = null;

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (n) => (n || 0).toLocaleString();
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

function rateClass(value, good, mid) {
  if (value == null) return "dim";
  if (value >= good) return "rate-good";
  if (value >= mid) return "rate-mid";
  return "rate-bad";
}

// Stable colour per channel so the trend bars stay readable.
const CHANNEL_COLOURS = {
  linkedin: "#0a66c2", instagram: "#d6336c", direct: "#8a8a8a",
  google: "#3b8a3b", chatgpt: "#10a37f", perplexity: "#20808d",
  brevo: "#c79b3b", lead_magnet: "#8e5cd9", whatsapp: "#25d366",
};
const colourFor = (src, i) =>
  CHANNEL_COLOURS[src] || ["#c79b3b", "#5b7fd6", "#c0632f", "#5aa0a8", "#9b6fd0"][i % 5];

const LABELS = {
  job_alerts: "Job alerts",
  audit_roadmap: "Offer roadmap",
  discovery_call: "Discovery call",
};

const MOCK = {
  days: 28, errors: [],
  channels: [
    { source: "linkedin", medium: "post", visitors: 420, signups: { job_alerts: 4, audit_roadmap: 2, discovery_call: 11 }, callForms: 11, booked: 9 },
    { source: "instagram", medium: "bio", visitors: 380, signups: { job_alerts: 26, audit_roadmap: 3, discovery_call: 5 }, callForms: 5, booked: 4 },
    { source: "direct", medium: "none", visitors: 210, signups: { job_alerts: 8, audit_roadmap: 1, discovery_call: 4 }, callForms: 4, booked: 3 },
  ],
  linksPage: [
    { linkId: "job_alerts", label: "Job alerts", total: 88, bySource: { instagram: 71, direct: 17 } },
    { linkId: "offer_roadmap", label: "Offer roadmap", total: 34, bySource: { instagram: 28, direct: 6 } },
    { linkId: "mentoring_landing", label: "Mentoring (main site)", total: 19, bySource: { instagram: 15, direct: 4 } },
  ],
  channelsSession: [
    { source: "linkedin", medium: "", visitors: 1776, signups: { job_alerts: 9, audit_roadmap: 0, discovery_call: 46 }, callForms: 46, booked: 48 },
    { source: "instagram", medium: "", visitors: 1625, signups: { job_alerts: 104, audit_roadmap: 0, discovery_call: 23 }, callForms: 23, booked: 54 },
    { source: "direct", medium: "", visitors: 1118, signups: { job_alerts: 53, audit_roadmap: 0, discovery_call: 32 }, callForms: 32, booked: 47 },
  ],
  weeklySession: [
    { week: "29", sources: { linkedin: 292, instagram: 187, direct: 141 } },
    { week: "30", sources: { linkedin: 289, instagram: 141, direct: 148 } },
    { week: "31", sources: { linkedin: 74, instagram: 79, direct: 71 } },
    { week: "32", sources: { linkedin: 64, instagram: 183, direct: 85 } },
    { week: "33", sources: { linkedin: 21, instagram: 153, direct: 41 } },
  ],
  statsUpdated: "2026-08-20T04:00:00Z",
  reach: [
    { week: "33", monday: "2026-08-10", channels: {
      linkedin: { impressions: 25921, visits: 44, ctr: 44/25921, partial: false },
      instagram: { impressions: null, visits: 231, ctr: null, partial: false } } },
    { week: "34", monday: "2026-08-17", channels: {
      linkedin: { impressions: 45012, visits: 54, ctr: 54/45012, partial: true },
      instagram: { impressions: null, visits: 143, ctr: null, partial: false } } },
  ],
  campaigns: [
    { campaign: "interview-fails", visitors: 180, conversions: 9 },
    { campaign: "grad-programs", visitors: 95, conversions: 3 },
  ],
  weekly: [
    { week: "31", sources: { linkedin: 120, instagram: 90 } },
    { week: "32", sources: { linkedin: 150, instagram: 110 } },
    { week: "33", sources: { linkedin: 150, instagram: 180 } },
  ],
  sales: {
    totals: { leads: 62, consulted: 41, signed: 16, showUpRate: 0.66, closeRate: 0.39 },
    bySource: [
      { source: "LinkedIn", leads: 40, consulted: 40, signed: 16, closeRate: 0.4 },
      { source: "Instagram", leads: 17, consulted: 17, signed: 5, closeRate: 0.29 },
    ],
  },
};

/* ----------------------------------------------------------- rendering --- */

function renderKpis(d) {
  const chans = mode === "session" ? (d.channelsSession || []) : (d.channels || []);
  const visitors = chans.reduce((s, c) => s + c.visitors, 0);
  const signups = chans.reduce(
    (s, c) => s + c.signups.job_alerts + c.signups.audit_roadmap + c.signups.discovery_call, 0);
  const booked = chans.reduce((s, c) => s + c.booked, 0);
  const t = d.sales.totals || {};

  const tiles = [
    { label: "Visitors", value: num(visitors), sub: "people, not sessions" },
    { label: "Signed up for something", value: num(signups), sub: pct(signups, visitors) + " of visitors" },
    { label: "Booked a call", value: num(booked), sub: pct(booked, visitors) + " of visitors" },
    { label: "Showed up", value: num(t.consulted), sub: t.showUpRate != null ? `${(t.showUpRate * 100).toFixed(0)}% of leads` : "" },
    { label: "Signed clients", value: num(t.signed), sub: "paying", accent: true },
    { label: "Close rate", value: t.closeRate != null ? `${(t.closeRate * 100).toFixed(0)}%` : "—", sub: "signed / showed up", accent: true },
  ];

  document.getElementById("kpis").innerHTML = tiles.map((k) => `
    <div class="kpi${k.accent ? " kpi--accent" : ""}">
      <div class="kpi__label">${esc(k.label)}</div>
      <div class="kpi__value">${esc(k.value)}</div>
      <div class="kpi__sub">${esc(k.sub || "")}</div>
    </div>`).join("");
}

const MODE_NOTES = {
  first: "Where someone FIRST arrived from, remembered across visits and read from your link tags. Started 14 Aug 2026.",
  session: "GA4's own session attribution. Goes back a year, but it is last-click and undercounts LinkedIn, since its in-app browser hides the referrer and that traffic lands in direct.",
};

function renderChannels(d) {
  const rows = mode === "session" ? (d.channelsSession || []) : (d.channels || []);
  document.getElementById("mode-note").textContent = MODE_NOTES[mode];
  const el = document.getElementById("channel-table");
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="dim">No attributed traffic yet.</td></tr></tbody>`;
    return;
  }
  el.innerHTML = `
    <thead><tr>
      <th>Channel</th>
      <th class="num">Visitors</th>
      <th class="num">Job alerts</th>
      <th class="num">Roadmap</th>
      <th class="num">Discovery call</th>
      <th class="num">Booked</th>
      <th class="num">Book rate</th>
      <th class="num">Tracked</th>
    </tr></thead>
    <tbody>${rows.map((c) => {
      const br = c.visitors ? c.booked / c.visitors : null;
      return `<tr>
        <td class="src">${esc(c.source)}${
          c.medium ? ` <span class="dim">/ ${esc(c.medium)}</span>`
          : (c.backfilled ? ` <span class="dim">/ from session history</span>` : "")}</td>
        <td class="num strong">${num(c.visitors)}</td>
        <td class="num">${num(c.signups.job_alerts)}</td>
        <td class="num">${num(c.signups.audit_roadmap)}</td>
        <td class="num">${num(Math.max(c.signups.discovery_call, c.callForms))}</td>
        <td class="num strong">${num(c.booked)}</td>
        <td class="num ${rateClass(br, 0.03, 0.015)}">${pct(c.booked, c.visitors)}</td>
        <td class="num ${c.confidence == null ? "dim" : rateClass(c.confidence, 0.9, 0.6)}"
            title="Of the bookings you labelled as this channel in Airtable, the share GA4 also caught.">
          ${c.confidence == null ? "—" : (c.confidence * 100).toFixed(0) + "%"}</td>
      </tr>`;
    }).join("")}</tbody>`;
}

function renderSales(d) {
  const rows = (d.sales && d.sales.bySource) || [];
  const el = document.getElementById("sales-table");
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="dim">No leads in this window.</td></tr></tbody>`;
    return;
  }
  el.innerHTML = `
    <thead><tr>
      <th>Source</th>
      <th class="num">Leads</th>
      <th class="num">Showed up</th>
      <th class="num">Signed</th>
      <th class="num">Close rate</th>
    </tr></thead>
    <tbody>${rows.map((s) => `
      <tr>
        <td class="src">${esc(s.source)}</td>
        <td class="num">${num(s.leads)}</td>
        <td class="num">${num(s.consulted)}</td>
        <td class="num strong">${num(s.signed)}</td>
        <td class="num ${rateClass(s.closeRate, 0.35, 0.2)}">${s.closeRate != null ? (s.closeRate * 100).toFixed(0) + "%" : "—"}</td>
      </tr>`).join("")}</tbody>`;
}

function renderLinks(d) {
  const rows = d.linksPage || [];
  const el = document.getElementById("links-table");
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="dim">No clicks on the links page yet in this window.</td></tr></tbody>`;
    return;
  }
  const total = rows.reduce((s, r) => s + r.total, 0);
  // Every source that sent anyone to the links page, biggest first.
  const sources = [...new Set(rows.flatMap((r) => Object.keys(r.bySource)))]
    .sort((a, b) => rows.reduce((s, r) => s + (r.bySource[b] || 0), 0)
                  - rows.reduce((s, r) => s + (r.bySource[a] || 0), 0))
    .slice(0, 4);

  el.innerHTML = `
    <thead><tr>
      <th>Option</th>
      <th class="num">Clicks</th>
      <th class="num">Share</th>
      ${sources.map((s) => `<th class="num">${esc(s)}</th>`).join("")}
    </tr></thead>
    <tbody>${rows.map((r) => `
      <tr>
        <td class="src">${esc(r.label)}</td>
        <td class="num strong">${num(r.total)}</td>
        <td class="num">${pct(r.total, total)}</td>
        ${sources.map((s) => `<td class="num ${r.bySource[s] ? "" : "dim"}">${num(r.bySource[s] || 0)}</td>`).join("")}
      </tr>`).join("")}</tbody>`;
}

function renderReach(d) {
  const rows = (d.reach || []).filter((r) =>
    r.channels.linkedin.impressions != null || r.channels.instagram.impressions != null ||
    r.channels.linkedin.visits || r.channels.instagram.visits).slice(-10);
  const el = document.getElementById("reach-table");
  const note = document.getElementById("reach-note");

  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="dim">No reach data yet. Run
      Operations/analytics/import-channel-stats.py after downloading a LinkedIn export.</td></tr></tbody>`;
    if (note) note.textContent = "";
    return;
  }

  el.innerHTML = `
    <thead><tr>
      <th>Week of</th>
      <th class="num">LI reach</th>
      <th class="num">LI visits</th>
      <th class="num">LI click rate</th>
      <th class="num">IG reach</th>
      <th class="num">IG visits</th>
      <th class="num">IG click rate</th>
    </tr></thead>
    <tbody>${rows.map((r) => {
      const l = r.channels.linkedin, i = r.channels.instagram;
      const cell = (c) => `
        <td class="num">${c.impressions == null ? "<span class=\"dim\">—</span>" : num(c.impressions)}</td>
        <td class="num strong">${num(c.visits)}</td>
        <td class="num ${c.ctr == null ? "dim" : rateClass(c.ctr, 0.004, 0.002)}">${
          c.ctr == null ? "—" : (c.ctr * 100).toFixed(2) + "%"}</td>`;
      return `<tr>
        <td class="src">${esc(r.monday)}${l.partial || i.partial ? ` <span class="dim">part week</span>` : ""}</td>
        ${cell(l)}${cell(i)}
      </tr>`;
    }).join("")}</tbody>`;

  if (note) {
    note.textContent = d.statsUpdated
      ? `Impressions last imported ${new Date(d.statsUpdated).toLocaleDateString("en-AU",
          { day: "numeric", month: "short" })}. Instagram reach is entered by hand; blank means not yet entered.`
      : "";
  }
}

function renderPosts(d) {
  const groups = d.topPosts || {};
  const rows = [...(groups.linkedin || []), ...(groups.instagram || [])];
  const el = document.getElementById("posts-table");
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="dim">No posts archived for this window yet. Run
      import-instagram-posts.py and import-channel-stats.py.</td></tr></tbody>`;
    return;
  }
  const block = (label, list) => !list.length ? "" : `
    <tr><td colspan="5" class="posts-head">${esc(label)}</td></tr>
    ${list.map((p) => `
      <tr>
        <td>
          <span class="dim">${esc(p.date)}</span>
          ${p.approx ? `<span class="dim" title="Matched to a draft by order within the week, not by exact day">~</span>` : ""}<br>
          ${p.permalink
            ? `<a href="${esc(p.permalink)}" target="_blank" rel="noopener">${esc(p.title.slice(0, 62))}</a>`
            : esc(p.title.slice(0, 62))}
        </td>
        <td class="num strong">${num(p.reach)}</td>
        <td class="num">${num(p.engagements)}</td>
        <td class="num ${p.profileVisits == null ? "dim" : ""}">${p.profileVisits == null ? "—" : num(p.profileVisits)}</td>
        <td class="num ${p.saves == null ? "dim" : ""}">${p.saves == null ? "—" : num(p.saves)}</td>
      </tr>`).join("")}`;

  el.innerHTML = `
    <thead><tr>
      <th>Post</th>
      <th class="num">Reach</th>
      <th class="num">Engagements</th>
      <th class="num">Profile visits</th>
      <th class="num">Saves</th>
    </tr></thead>
    <tbody>
      ${block("LinkedIn", groups.linkedin || [])}
      ${block("Instagram", groups.instagram || [])}
    </tbody>`;
}

function renderTrend(d) {
  // Always the session series, whatever the table above is showing. A trend
  // needs one method applied to every week; first-touch only exists from
  // 14 Aug 2026, so using it here would render a year of "(not set)".
  const weeks = (d.weeklySession && d.weeklySession.length ? d.weeklySession : d.weekly) || [];
  const el = document.getElementById("trend");
  if (!weeks.length) { el.innerHTML = `<p class="dim">No weekly data yet.</p>`; return; }

  const totals = {};
  weeks.forEach((w) => Object.entries(w.sources).forEach(([s, n]) => { totals[s] = (totals[s] || 0) + n; }));
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
  const colours = Object.fromEntries(top.map((s, i) => [s, colourFor(s, i)]));
  const max = Math.max(...weeks.map((w) => Object.values(w.sources).reduce((a, b) => a + b, 0)), 1);

  const note = document.getElementById("trend-note");
  if (note) note.textContent =
    "GA4 session data, so every week is measured the same way and the shape is comparable. " +
    "Undercounts LinkedIn slightly, since its in-app browser hides the referrer.";

  el.innerHTML = weeks.map((w) => {
    const total = Object.values(w.sources).reduce((a, b) => a + b, 0);
    const segs = top.filter((s) => w.sources[s]).map((s) =>
      `<i class="trend-seg" style="width:${(w.sources[s] / max) * 100}%;background:${colours[s]}" title="${esc(s)}: ${w.sources[s]}"></i>`
    ).join("");
    return `<div class="trend-row">
      <span class="trend-week">Week ${esc(w.week)}</span>
      <span class="trend-bars">${segs}</span>
      <span class="trend-total">${num(total)}</span>
    </div>`;
  }).join("") + `<div class="trend-key">${top.map((s) =>
    `<span><i style="background:${colours[s]}"></i>${esc(s)}</span>`).join("")}</div>`;
}

function renderCampaigns(d) {
  const rows = d.campaigns || [];
  const el = document.getElementById("campaign-table");
  if (!rows.length) {
    el.innerHTML = `<tbody><tr><td class="dim">No tagged campaigns yet. Build links with the link builder so each post can be judged separately.</td></tr></tbody>`;
    return;
  }
  el.innerHTML = `
    <thead><tr>
      <th>Campaign</th>
      <th class="num">Visitors</th>
      <th class="num">Conversions</th>
      <th class="num">Rate</th>
    </tr></thead>
    <tbody>${rows.map((c) => `
      <tr>
        <td class="src">${esc(c.campaign)}</td>
        <td class="num">${num(c.visitors)}</td>
        <td class="num strong">${num(c.conversions)}</td>
        <td class="num ${rateClass(c.visitors ? c.conversions / c.visitors : null, 0.05, 0.02)}">${pct(c.conversions, c.visitors)}</td>
      </tr>`).join("")}</tbody>`;
}

function renderNotice(d) {
  const el = document.getElementById("notice");
  const msgs = [];
  if (d.errors && d.errors.length) msgs.push(d.errors.join(" · "));
  if (d.recoveredFromSession) {
    msgs.push(`${num(d.recoveredFromSession)} visits from before 14 Aug have no first-touch tag, ` +
      `so their channel was recovered from GA4's own session data and merged in above. ` +
      (d.stillUnknown ? `${num(d.stillUnknown)} could not be placed at all.`
                      : `Nothing was left unattributed.`));
  }
  const unknown = (d.channels || []).find((c) => c.source === "not tagged");
  if (unknown && unknown.visitors) {
    msgs.push(`${num(unknown.visitors)} visitors carry no usable signal in either system.`);
  }
  if (!msgs.length) { el.hidden = true; return; }
  el.textContent = msgs.join(" ");
  el.hidden = false;
}

/* --------------------------------------------------------------- load --- */

async function load() {
  const loading = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const content = document.getElementById("content");

  loading.hidden = false;
  errorEl.hidden = true;
  content.hidden = true;

  let data;
  try {
    if (isLocal) {
      data = MOCK;
    } else {
      const res = await fetch("/.netlify/functions/leads-attribution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerEmail, days }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load");
    }
  } catch (err) {
    loading.hidden = true;
    errorEl.textContent = err.message || "Could not load. Refresh to try again.";
    errorEl.hidden = false;
    return;
  }

  data.channels = data.channels || [];
  data.sales = data.sales || { totals: {}, bySource: [] };
  data.linksPage = data.linksPage || [];
  data.reach = data.reach || [];
  data.topPosts = data.topPosts || {};
  data.channelsSession = data.channelsSession || [];
  data.weeklySession = data.weeklySession || [];
  lastData = data;

  // Default to whichever view actually has numbers, so the page is never
  // blank, but keep the switch visible so it is obvious which one is showing.
  const firstTouchVisitors = data.channels
    .filter((c) => c.source !== "(not set)" && c.source !== "(unknown)")
    .reduce((s, c) => s + c.visitors, 0);
  if (firstTouchVisitors < 20 && data.channelsSession.length) mode = "session";
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.mode === mode));

  renderKpis(data);
  renderNotice(data);
  renderChannels(data);
  renderSales(data);
  renderLinks(data);
  renderReach(data);
  renderPosts(data);
  renderTrend(data);
  renderCampaigns(data);

  loading.hidden = true;
  content.hidden = false;
}

document.getElementById("mode").addEventListener("click", (e) => {
  const btn = e.target.closest(".mode-btn");
  if (!btn || !lastData) return;
  mode = btn.dataset.mode;
  document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  renderKpis(lastData);
  renderChannels(lastData);
  renderTrend(lastData);
});

document.getElementById("range").addEventListener("click", (e) => {
  const btn = e.target.closest(".range-btn");
  if (!btn) return;
  document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
  days = Number(btn.dataset.days);
  load();
});

requireAuth((session) => {
  const email = session?.user?.email || "";
  if (!OWNERS.includes(email) && email !== "dev@localhost") {
    window.location.replace("/mentor-portal/index.html");
    return;
  }
  ownerEmail = email;
  mountPortalNav({ email, isOwner: true, active: "leads" });
  load();
});
