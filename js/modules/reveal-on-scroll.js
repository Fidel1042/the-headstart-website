// Adds .reveal-visible to .reveal elements when they enter the viewport.
// Honours prefers-reduced-motion by revealing everything immediately.

import { prefersReducedMotion } from "../utils/motion.js";

export const init = () => {
  const revealEls = document.querySelectorAll(".reveal");
  if (!revealEls.length) return;

  if (prefersReducedMotion) {
    revealEls.forEach((el) => el.classList.add("reveal-visible"));
    return;
  }

  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          obs.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1 }
  );
  revealEls.forEach((el) => obs.observe(el));
};
