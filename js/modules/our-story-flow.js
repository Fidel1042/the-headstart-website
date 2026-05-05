// Subtle scroll-driven flow animation for the "Our story" blocks. Used as the
// fallback when GSAP is not loaded; on the home page GSAP handles entrance
// animation instead and this module is skipped.

import { prefersReducedMotion } from "../utils/motion.js";

export const init = () => {
  const section = document.getElementById("our-story");
  if (!section) return;
  const blocks = Array.from(section.querySelectorAll(".about-real__block--text"));
  if (!blocks.length) return;

  let active = false;
  let rafId = 0;

  const resetBlocks = () => {
    section.style.setProperty("--story-flow-progress", "0");
    blocks.forEach((block) => {
      block.style.setProperty("--story-flow-glow", "0.06");
    });
  };

  const applyFlow = () => {
    rafId = 0;
    if (!active || prefersReducedMotion) return;

    const rect = section.getBoundingClientRect();
    const viewportHeight = window.innerHeight || 1;
    const progressRaw = (viewportHeight - rect.top) / (viewportHeight + rect.height);
    const progress = Math.min(1, Math.max(0, progressRaw));
    const compact = viewportHeight < 760 || window.innerWidth < 720;
    const xAmplitude = compact ? 4.5 : 8;
    const yAmplitude = compact ? 2.4 : 3.8;

    section.style.setProperty("--story-flow-progress", progress.toFixed(4));

    blocks.forEach((block, index) => {
      const phase = progress * Math.PI * 2 + index * 0.9;
      const offsetX = Math.sin(phase) * xAmplitude;
      const offsetY = Math.cos(phase * 0.85) * yAmplitude;
      const glow = 0.05 + ((Math.sin(phase) + 1) * 0.06);

      block.style.setProperty("--story-flow-glow", glow.toFixed(3));
    });
  };

  const requestFlow = () => {
    if (rafId) return;
    rafId = window.requestAnimationFrame(applyFlow);
  };

  const setActive = (nextActive) => {
    if (active === nextActive) return;
    active = nextActive;
    section.classList.toggle("about-real--flow-active", active);
    if (!active) {
      resetBlocks();
      return;
    }
    requestFlow();
  };

  if (prefersReducedMotion) {
    resetBlocks();
    return;
  }

  const observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          (entries) => {
            const entry = entries[0];
            if (!entry) return;
            setActive(entry.isIntersecting);
          },
          { threshold: 0.08 }
        )
      : null;

  const evaluateActiveByRect = () => {
    const rect = section.getBoundingClientRect();
    setActive(rect.top < window.innerHeight * 0.92 && rect.bottom > window.innerHeight * 0.08);
  };

  if (observer) {
    observer.observe(section);
  } else {
    evaluateActiveByRect();
  }

  const onViewportChange = () => {
    if (!observer) {
      evaluateActiveByRect();
    }
    if (!active) return;
    requestFlow();
  };

  window.addEventListener("scroll", onViewportChange, { passive: true });
  window.addEventListener("resize", onViewportChange);
  requestFlow();
};
