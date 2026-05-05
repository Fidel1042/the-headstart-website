// Motion preferences and GSAP availability checks shared across modules.

export const prefersReducedMotion =
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const gsapReady =
  typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";

if (gsapReady) {
  gsap.registerPlugin(ScrollTrigger);
}
