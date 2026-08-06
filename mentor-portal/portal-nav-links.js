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
    links: [
      { href: "/consultation-tool/index.html", label: "Consultation tool", page: "consultation" },
    ],
  },
  {
    key: "preassigned",
    label: "Pre Assigned Mentees",
    links: [
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
