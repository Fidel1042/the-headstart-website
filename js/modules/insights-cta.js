// Ensures every page renders the "Want more detailed insights?" CTA after the
// footer. If a static one already exists in the HTML it is reused.

import { routeHref } from "../utils/route-resolver.js";

export const init = () => {
  const insightsCtaHref = routeHref("/blog");
  let insightsCta = document.querySelector(".mobile-sticky-cta");
  if (!insightsCta) {
    insightsCta = document.createElement("div");
    insightsCta.className = "mobile-sticky-cta";
    const footer = document.querySelector("footer");
    if (footer?.parentNode) {
      footer.parentNode.insertBefore(insightsCta, footer.nextSibling);
    } else {
      document.body.appendChild(insightsCta);
    }
  }
  insightsCta.innerHTML = `
    <p>Want more detailed insights?</p>
    <a class="btn" href="${insightsCtaHref}"><strong>Check our blog</strong></a>
  `;
};
