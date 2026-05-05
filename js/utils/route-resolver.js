// Resolves route-style links (e.g. "/services") to real file paths when running
// in a local preview that does not honour Netlify's _redirects rules.

const routeToFileMap = {
  "/": "index.html",
  "/services": "html/services.html",
  "/mentors": "html/mentors.html",
  "/careers": "html/careers.html",
  "/discovery-call": "html/discovery-call.html",
  "/free-call-submitted": "html/free-call-submitted.html",
  "/job-application": "html/job-application.html",
  "/mentor-role": "html/mentor-role.html",
  "/mentor-application": "html/mentor-application.html",
  "/mentee-signup": "html/mentee-signup.html",
  "/mentee-agreement": "html/mentee-agreement.html",
  "/mentee-agreement-popup": "html/mentee-agreement-popup.html",
  "/mentee-agreement-submitted": "html/mentee-agreement-submitted.html",
  "/strategy-intern-role": "html/strategy-intern-role.html",
  "/strategy-intern-application": "html/strategy-intern-application.html",
  "/marketing-intern-role": "html/marketing-intern-role.html",
  "/marketing-intern-application": "html/marketing-intern-application.html",
  "/mentor-onboarding": "html/mentor-onboarding.html",
  "/mentor-onboarding/how-headstart-works":
    "html/mentor-onboarding-how-headstart-works.html",
  "/mentor-onboarding/professional-standards":
    "html/mentor-onboarding-professional-standards.html",
  "/mentor-onboarding/extra-services":
    "html/mentor-onboarding-extra-services.html",
  "/thank-you": "thank-you.html",
  "/blog": "html/index.html",
  "/blog/index.html": "html/index.html",
  "/blog/does-your-degree-matter-australia-international-student":
    "html/does-your-degree-matter-australia-international-student.html",
  "/blog/does-your-degree-matter-australia-international-student.html":
    "html/does-your-degree-matter-australia-international-student.html",
  "/blog/australian-graduate-job-market-2025":
    "html/australian-graduate-job-market-2025.html",
  "/blog/australian-graduate-job-market-2025.html":
    "html/australian-graduate-job-market-2025.html",
  "/blog/temporary-graduate-visa-fee-increase-2026-what-it-means":
    "html/temporary-graduate-visa-fee-increase-2026-what-it-means.html",
  "/blog/temporary-graduate-visa-fee-increase-2026-what-it-means.html":
    "html/temporary-graduate-visa-fee-increase-2026-what-it-means.html",
  "/blog/resume-experience-alignment-australia-international-student":
    "html/resume-experience-alignment-australia-international-student.html",
};

export const isLikelyNoRewriteEnv =
  location.protocol === "file:" ||
  ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

const moduleScriptTag =
  document.querySelector("script[src$='js/main.js']") ||
  document.querySelector("script[src*='/js/main.js']");
const legacyScriptTag =
  document.querySelector("script[src$='script.js']") ||
  document.querySelector("script[src*='/script.js']");
const scriptSrc =
  moduleScriptTag?.getAttribute("src") ||
  legacyScriptTag?.getAttribute("src") ||
  "js/main.js";
const scriptUrl = new URL(scriptSrc, location.href);
// Site root is two levels up from js/main.js, one level up from /script.js.
const siteRootUrl = new URL(scriptSrc.includes("/js/") ? "../" : ".", scriptUrl);

const normalizeRoutePath = (path) => {
  if (!path) return "/";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
};

export const resolveLocalRouteHref = (routePath) => {
  const mappedFile = routeToFileMap[normalizeRoutePath(routePath)];
  if (!mappedFile) return routePath;
  return new URL(mappedFile, siteRootUrl).toString();
};

export const routeHref = (routePath) =>
  isLikelyNoRewriteEnv ? resolveLocalRouteHref(routePath) : routePath;
