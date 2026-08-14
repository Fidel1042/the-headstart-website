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
let days = 28;

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
  const visitors = d.channels.reduce((s, c) => s + c.visitors, 0);
  const signups = d.channels.reduce(
    (s, c) => s + c.signups.job_alerts + c.signups.audit_roadmap + c.signups.discovery_call, 0);
  const booked = d.channels.reduce((s, c) => s + c.booked, 0);
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

function renderChannels(d) {
  const rows = d.channels;
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
      <th class="num">Call form</th>
      <th class="num">Booked</th>
      <th class="num">Book rate</th>
    </tr></thead>
    <tbody>${rows.map((c) => {
      const br = c.visitors ? c.booked / c.visitors : null;
      return `<tr>
        <td class="src">${esc(c.source)}${c.medium ? ` <span class="dim">/ ${esc(c.medium)}</span>` : ""}</td>
        <td class="num strong">${num(c.visitors)}</td>
        <td class="num">${num(c.signups.job_alerts)}</td>
        <td class="num">${num(c.signups.audit_roadmap)}</td>
        <td class="num">${num(c.callForms)}</td>
        <td class="num strong">${num(c.booked)}</td>
        <td class="num ${rateClass(br, 0.03, 0.015)}">${pct(c.booked, c.visitors)}</td>
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

function renderTrend(d) {
  const weeks = d.weekly || [];
  const el = document.getElementById("trend");
  if (!weeks.length) { el.innerHTML = `<p class="dim">No weekly data yet.</p>`; return; }

  const totals = {};
  weeks.forEach((w) => Object.entries(w.sources).forEach(([s, n]) => { totals[s] = (totals[s] || 0) + n; }));
  const top = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s]) => s);
  const colours = Object.fromEntries(top.map((s, i) => [s, colourFor(s, i)]));
  const max = Math.max(...weeks.map((w) => Object.values(w.sources).reduce((a, b) => a + b, 0)), 1);

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
  const unattributed = (d.channels || []).find((c) => c.source === "(not set)");
  if (unattributed && unattributed.visitors) {
    msgs.push(`${num(unattributed.visitors)} visitors have no source recorded. Attribution started 14 Aug 2026, so anything before that is blank.`);
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

  renderKpis(data);
  renderNotice(data);
  renderChannels(data);
  renderSales(data);
  renderTrend(data);
  renderCampaigns(data);

  loading.hidden = true;
  content.hidden = false;
}

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
