// signup-funnel.js — the discovery-call page, and how many people who open it
// actually sign up.
//
// This is the only step in the whole funnel that the website itself controls.
// Everything upstream is a content and channel question; everything downstream
// is Calendly and the sales call. If a change to the site is meant to have
// worked, it shows up here or it did not work.
//
// Bookings come from Airtable rather than GA4 on purpose. GA4's
// invitee_meeting_scheduled fired 200 times for 46 users, because Calendly
// re-posts the message on reschedules and re-renders, so it counts intent, not
// bookings.

const { ga4Token, runReport, dateRange } = require("./ga4");

const PAGE = "/discovery-call";
const SUBMIT = "discovery_form_submit";

// Frozen 2026-08-27 over the preceding 60 days: 106 submits from 323 users.
// Compare against this, not against zero.
const BASELINE = { rate: 32.8, users: 323, submits: 106, from: "2026-06-28", to: "2026-08-27" };

async function signupFunnel(env, days, offset = 0) {
  const clientEmail = env.GA4_CLIENT_EMAIL;
  const privateKey = env.GA4_PRIVATE_KEY;
  const propertyId = env.GA4_PROPERTY_ID;
  if (!clientEmail || !privateKey || !propertyId) return null;

  try {
    const token = await ga4Token(clientEmail, privateKey);
    const range = dateRange(days, offset);

    const [pages, submits, byDevice, byLanding] = await Promise.all([
      // The legacy /html/discovery-call.html path still gets a trickle, so both
      // are counted or the denominator is quietly short.
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: { filter: { fieldName: "pagePath",
          stringFilter: { matchType: "CONTAINS", value: "discovery-call" } } },
        limit: 20,
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { value: SUBMIT } } },
        limit: 5,
      }),
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "deviceCategory" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: { filter: { fieldName: "eventName",
          inListFilter: { values: ["page_view", SUBMIT] } } },
        limit: 50,
      }),
      // Where someone first landed changes how warm they are by the time they
      // reach the form, which is the most useful cut on this page.
      runReport(token, propertyId, {
        dateRanges: range,
        dimensions: [{ name: "landingPage" }, { name: "eventName" }],
        metrics: [{ name: "totalUsers" }],
        dimensionFilter: { filter: { fieldName: "eventName",
          inListFilter: { values: ["page_view", SUBMIT] } } },
        limit: 200,
      }),
    ]);

    const users = pages.reduce((n, r) => n + r.mets[0], 0);
    const submitted = submits.reduce((n, r) => n + r.mets[0], 0);

    // page_view here is site-wide per device, so it is only useful as a ratio
    // between devices, never as a funnel denominator.
    const dev = {};
    byDevice.forEach(({ dims, mets }) => {
      const d = (dev[dims[0]] = dev[dims[0]] || { device: dims[0], views: 0, submits: 0 });
      if (dims[1] === SUBMIT) d.submits += mets[0]; else d.views += mets[0];
    });

    const land = {};
    byLanding.forEach(({ dims, mets }) => {
      const key = dims[0] || "(not set)";
      const l = (land[key] = land[key] || { page: key, views: 0, submits: 0 });
      if (dims[1] === SUBMIT) l.submits += mets[0]; else l.views += mets[0];
    });

    return {
      users, submits: submitted,
      rate: users ? (submitted / users) * 100 : 0,
      baseline: BASELINE,
      devices: Object.values(dev).sort((a, b) => b.submits - a.submits),
      landing: Object.values(land)
        .filter((l) => l.submits > 0)
        .sort((a, b) => b.submits - a.submits).slice(0, 10),
    };
  } catch (e) {
    return null;
  }
}

module.exports = { signupFunnel, BASELINE, PAGE };
