// portal-nav-links.js — the owner navigation, as five top-level areas.
//
// Each area groups the pages that belong to one job, so the nav answers
// "what am I working on" rather than listing every page at once. Areas with a
// single page link straight to it and show no second row.
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
    key: "preassigned",
    label: "Pre Assigned Mentees",
    // Follow-ups first: the section pill goes to links[0], so this lands
    // straight on the list rather than needing a second click.
    links: [
      { href: "/mentor-portal/followups.html", label: "Follow-ups", page: "followups" },
      { href: "/mentor-portal/contacts.html", label: "Contacts to add", page: "contacts" },
    ],
  },
  {
    key: "mentees",
    label: "Current Mentees",
    links: [
      { href: "/mentor-portal/admin.html?view=mentees", label: "Mentee status", page: "mentee-status" },
    ],
  },
  {
    key: "mentors",
    label: "Mentors",
    links: [
      { href: "/mentor-portal/admin.html?view=overview", label: "Big picture", page: "big-picture" },
      { href: "/mentor-portal/admin.html?view=performance", label: "Detailed performance", page: "performance" },
      { href: "/mentor-portal/admin.html?view=calendar", label: "Calendar", page: "calendar" },
      { href: "/mentor-portal/onboarding-plan.html", label: "Onboarding plan", page: "onboarding-plan" },
      { href: "/mentor-portal/onboarding-call.html", label: "Onboarding call", page: "onboarding-call" },
      { href: "/mentor-portal/delivery-checks.html", label: "Delivery check-in", page: "delivery-checks" },
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
    // Money in and money out. Billing and payslips sit here rather than under
    // Mentors: they are the finance run, not mentor management.
    key: "admin",
    label: "Admin",
    links: [
      { href: "/mentor-portal/billing.html", label: "Billing", page: "billing" },
      { href: "/mentor-portal/payslips.html", label: "Payslips", page: "payslips" },
      { href: "/mentor-portal/pl.html", label: "P&amp;L", page: "pl" },
      { href: "/mentor-portal/ltv.html", label: "LTV", page: "ltv" },
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
