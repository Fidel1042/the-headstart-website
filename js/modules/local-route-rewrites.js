// In local previews (file://, localhost) Netlify rewrites do not run, so we
// rewrite "/foo" hrefs/actions to the actual file paths used in the repo.

import { isLikelyNoRewriteEnv, resolveLocalRouteHref } from "../utils/route-resolver.js";

const rewriteRouteAttribute = (el, attr) => {
  const rawValue = el.getAttribute(attr);
  if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) return;

  const parsed = new URL(rawValue, "https://local.headstart");
  const localPath = resolveLocalRouteHref(parsed.pathname);
  if (!localPath || localPath === parsed.pathname) return;

  el.setAttribute(attr, `${localPath}${parsed.search}${parsed.hash}`);
};

export const init = () => {
  if (!isLikelyNoRewriteEnv) return;

  document.querySelectorAll("a[href^='/']").forEach((link) => {
    rewriteRouteAttribute(link, "href");
  });

  document.querySelectorAll("form[action^='/']").forEach((form) => {
    rewriteRouteAttribute(form, "action");
  });
};
