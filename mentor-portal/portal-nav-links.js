// portal-nav-links.js — the owner navigation, as five top-level areas.
//
// Each area groups the pages that belong to one job, so the nav answers
// "what am I working on" rather than listing every page at once. Areas with a
// single page link straight to it and show no second row.
//
// Inside an area, `group` splits the second row into labelled runs. Mentors
// covers three unrelated jobs (hiring, onboarding, watching performance) and
// nine links in one flat row gave no clue where one job ended and the next
// began. A link with no group sits in an unlabelled run at the front.
//
// `page` keys are what a page passes as `active` to mountPortalNav.
// Some sub-links deep-link into a tab on admin.html via ?view=.

export const NAV_AREAS = [
  {
    key: "consultation",
    label: "Consultation",
    // The six screens of a sales call, in the order they get opened. They used
    // to carry their own separate nav bar, which made stepping in and out of
    // the portal feel like leaving it. They are pages of the portal now.
    links: [
      { href: "/consultation-tool/index.html", label: "Call flow", page: "consultation" },
      { href: "/consultation-tool/matrix.html", label: "Where you are", page: "consult-matrix" },
      { href: "/consultation-tool/structure.html", label: "Session structure", page: "consult-structure" },
      { href: "/consultation-tool/mentors.html", label: "Mentors", page: "consult-mentors" },
      { href: "/consultation-tool/roi.html", label: "ROI", page: "consult-roi" },
      { href: "/consultation-tool/pricing.html", label: "Pricing", page: "consult-pricing" },
    ],
  },
  {
    // Top of the funnel: where leads come from and what they turn into.
    key: "leads",
    label: "Leads",
    links: [
      { href: "/mentor-portal/journey.html", label: "Customer journey", page: "journey" },
      { href: "/mentor-portal/leads.html", label: "Attribution", page: "leads" },
    ],
  },
  {
    // Was two areas, "Pre Assigned Mentees" and "Current Mentees". They are the
    // same people at different points, so they are one area with two runs.
    key: "mentees",
    label: "Mentees",
    links: [
      { href: "/mentor-portal/contacts.html", label: "Contacts to add", page: "contacts", group: "Before a mentor" },
      { href: "/mentor-portal/assign.html", label: "Assign mentees", page: "assign", group: "Before a mentor" },
      { href: "/mentor-portal/followups.html", label: "Follow-ups", page: "followups", group: "Before a mentor" },
      { href: "/mentor-portal/admin.html?view=mentees", label: "Mentee status", page: "mentee-status", group: "Once mentoring" },
    ],
  },
  {
    key: "mentors",
    label: "Mentors",
    links: [
      { href: "/mentor-portal/pipeline.html", label: "Pipeline", page: "pipeline", group: "Hiring" },
      { href: "/mentor-portal/second-interviews.html", label: "Second interviews", page: "second-interviews", group: "Hiring" },
      { href: "/mentor-portal/agreements.html", label: "Agreements", page: "agreements", group: "Hiring" },
      { href: "/mentor-portal/drafts.html", label: "Profiles", page: "drafts", group: "Hiring" },
      { href: "/mentor-portal/onboarding-plan.html", label: "Plan", page: "onboarding-plan", group: "Onboarding" },
      { href: "/mentor-portal/onboarding-call.html", label: "Call", page: "onboarding-call", group: "Onboarding" },
      { href: "/mentor-portal/delivery-checks.html", label: "Delivery check-in", page: "delivery-checks", group: "Onboarding" },
      { href: "/mentor-portal/admin.html?view=overview", label: "Big picture", page: "big-picture", group: "Performance" },
      { href: "/mentor-portal/admin.html?view=performance", label: "Detailed", page: "performance", group: "Performance" },
      { href: "/mentor-portal/admin.html?view=calendar", label: "Calendar", page: "calendar", group: "Performance" },
    ],
  },
  {
    // Money in and money out. Billing and payslips sit here rather than under
    // Mentors: they are the finance run, not mentor management.
    key: "admin",
    label: "Admin",
    links: [
      { href: "/mentor-portal/billing.html", label: "Billing", page: "billing", group: "Money" },
      { href: "/mentor-portal/payslips.html", label: "Payslips", page: "payslips", group: "Money" },
      { href: "/mentor-portal/pl.html", label: "P&amp;L", page: "pl", group: "Reporting" },
      { href: "/mentor-portal/ltv.html", label: "LTV", page: "ltv", group: "Reporting" },
    ],
  },
];

/** The area a page key belongs to, or null for pages outside the owner nav. */
export function areaFor(page) {
  return NAV_AREAS.find((a) => a.links.some((l) => l.page === page)) || null;
}

/** Page keys inside an area, for the per-owner visibility filter. */
export function pagesIn(area) {
  return area.links.map((l) => l.page);
}

/**
 * An area's links as labelled runs, in the order the groups first appear.
 * Ungrouped links come first under no label, so an area that never sets
 * `group` renders exactly as it always did.
 */
export function groupsIn(links) {
  const out = [];
  for (const l of links) {
    const name = l.group || "";
    const last = out[out.length - 1];
    if (last && last.name === name) last.links.push(l);
    else out.push({ name, links: [l] });
  }
  return out;
}
