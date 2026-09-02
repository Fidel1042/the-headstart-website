// links-test-emails.js — the two review emails for the /links page test.
//
// One metric: Instagram offer-viewers per impression.
//
//   sessions from Instagram that viewed / , /mentors , /discovery-call , /reviews
//   ----------------------------------------------------------------------------
//                     Instagram views over the same window
//
// Every click-share measure was dropped on 1 Sep. Once the Job Alerts button
// comes off, the share of /links clicks reaching the offer rises toward 100%
// by construction: it looks like a triumph and means nothing. Anchoring to
// impressions instead makes the number honest through a change that edits the
// very options being counted.
//
// Baseline and bands: Operations/analytics/links-page-test.md. Frozen, not
// recomputed here.

// Jul+Aug combined, deliberately not August alone. July ran at 0.0696% and
// August at 0.0362% with nobody touching the page, so one month is a coin
// toss. Taking August alone would set the bar at a two-month low.
const BASE_RATE = 0.0470;          // % of impressions
const BASE = { julViews: 343146, julOffer: 239, augViews: 720824, augOffer: 261,
               augLinks: 603 };

const FAIL_RATE = 0.0400;          // below this: revert
const WIN_RATE  = 0.0564;          // at or above: success

const OFFER_PAGES = ["/", "/index.html", "/mentors", "/discovery-call", "/reviews"];
const IG_SOURCES  = ["ig", "instagram.com", "l.instagram.com", "instagram_bio"];

const pct4 = (n) => `${n.toFixed(4)}%`;

/**
 * Sessions from Instagram that saw an offer page.
 *
 * No pagePath dimension on purpose. Filtering pagePath and reading `sessions`
 * makes GA4 count each session once however many offer pages it visited;
 * adding the dimension splits it per page and double-counts anyone who saw two.
 * That mistake produced a 25% overstatement in the first draft of this test.
 */
async function offerSessions(ga4, startDate, endDate) {
  const rows = await ga4({
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: { andGroup: { expressions: [
      { filter: { fieldName: "sessionSource", inListFilter: { values: IG_SOURCES } } },
      { filter: { fieldName: "pagePath", inListFilter: { values: OFFER_PAGES } } },
    ] } },
  });
  return rows.length ? rows[0].mets[0] : 0;
}

/** The diagnostic: did people stop tapping the bio at all? */
async function linksSessions(ga4, startDate, endDate) {
  const rows = await ga4({
    dateRanges: [{ startDate, endDate }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: { andGroup: { expressions: [
      { filter: { fieldName: "sessionSource", inListFilter: { values: IG_SOURCES } } },
      { filter: { fieldName: "landingPage", stringFilter: { value: "/links" } } },
    ] } },
  });
  return rows.length ? rows[0].mets[0] : 0;
}

/** Instagram views for the window, straight from the Graph API. */
async function igViews(since, until) {
  const token = process.env.IG_TOKEN;
  if (!token) throw new Error("IG_TOKEN is not set, so impressions cannot be read");
  const url = "https://graph.instagram.com/v21.0/me/insights" +
    `?metric=views&metric_type=total_value&period=day&since=${since}&until=${until}` +
    `&access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(`Instagram: ${data.error.message}`);
  const m = (data.data || []).find((x) => x.name === "views");
  return (m && m.total_value && m.total_value.value) || 0;
}

async function gather(ga4, from, to) {
  const [offer, links, views] = await Promise.all([
    offerSessions(ga4, from, to),
    linksSessions(ga4, from, to),
    igViews(from, to),
  ]);
  return { offer, links, views, rate: views ? (offer / views) * 100 : 0 };
}

function verdictOf(rate) {
  if (rate < FAIL_RATE) return "FAIL";
  if (rate >= WIN_RATE) return "SUCCESS";
  return "NO CHANGE";
}

function buildLinksTestEmail({ verdict, now, days, t }) {
  const v = verdictOf(now.rate);
  const need = (r) => Math.round((now.views * r) / 100);

  const table = t.tbl(["Metric", `Now (${days} days)`, "Baseline (Jul+Aug)"], [
    ["<b>Offer-viewers per impression</b>", `<b>${pct4(now.rate)}</b>`, `<b>${pct4(BASE_RATE)}</b>`],
    ["Instagram views", now.views.toLocaleString(), (BASE.julViews + BASE.augViews).toLocaleString()],
    ["Sessions that saw an offer page", now.offer.toLocaleString(), (BASE.julOffer + BASE.augOffer).toLocaleString()],
    ["/links sessions <i>(diagnostic)</i>", now.links.toLocaleString(), `${BASE.augLinks} in Aug`],
  ]);

  const bands = t.tbl(["Verdict", "Per impression", `At ${now.views.toLocaleString()} views`], [
    ["FAIL, revert", `below ${pct4(FAIL_RATE)}`, `below ${need(FAIL_RATE)}`],
    ["No change", `${pct4(FAIL_RATE)} to ${pct4(WIN_RATE)}`, `${need(FAIL_RATE)} to ${need(WIN_RATE)}`],
    ["SUCCESS", `${pct4(WIN_RATE)} or more`, `${need(WIN_RATE)} or more`],
  ]);

  // The same fall has two opposite fixes, so always say which one this is.
  const why = now.links < BASE.augLinks * 0.8
    ? t.callout("Check this before acting",
        `/links sessions are <b>${now.links}</b> against ${BASE.augLinks} in August. People have ` +
        `stopped tapping the bio at all, which is a creative or reach problem. Reverting the ` +
        `page will not fix it.`)
    : "";

  if (!verdict) {
    return t.shell("Early look", "/links: has anything broken?",
      "Two weeks after Job Alerts came off the bio page. This can only catch a breakage. " +
      "The real read is 29 September.",
      t.callout(v === "FAIL" ? "Tracking below the revert line" : "Nothing looks broken",
        v === "FAIL"
          ? `<b>${pct4(now.rate)}</b> against a <b>${pct4(BASE_RATE)}</b> baseline, below the ` +
            `${pct4(FAIL_RATE)} revert line. Two weeks is short and this metric swung 92% between ` +
            `July and August on its own, so do not revert on this alone. Look again on the 29th.`
          : `<b>${pct4(now.rate)}</b> against a <b>${pct4(BASE_RATE)}</b> baseline. Holding.`) +
      table + why);
  }

  return t.shell("Verdict", "/links: drop Job Alerts, promote LinkedIn",
    "Four weeks in. Judge on the rate; the absolute number is the sanity check.",
    t.callout(v,
      v === "FAIL"
        ? `<b>${pct4(now.rate)}</b>, below the ${pct4(FAIL_RATE)} line. Fewer people are reaching ` +
          `a page that explains the offer than before the change. Put Job Alerts back.`
        : v === "SUCCESS"
        ? `<b>${pct4(now.rate)}</b> against <b>${pct4(BASE_RATE)}</b>. More of the same reach is ` +
          `now arriving at the offer. Keep it.`
        : `<b>${pct4(now.rate)}</b> against <b>${pct4(BASE_RATE)}</b>. Inside the noise band, so ` +
          `this is "no detectable change" rather than a win or a loss. Nothing broke, so keep it ` +
          `and let LinkedIn in slot two run.`) +
    table + bands + why +
    t.callout("What this cannot tell you",
      "This measures offer awareness only. Whether that traffic is better <i>quality</i> needs " +
      "about three months at current volume, so that read is due in December. And if the post " +
      "images were not updated in the same week, some of any drop is people arriving to look for " +
      "a Job Alerts button that is no longer there."));
}

module.exports = { gather, buildLinksTestEmail, verdictOf, BASE_RATE, FAIL_RATE, WIN_RATE };
