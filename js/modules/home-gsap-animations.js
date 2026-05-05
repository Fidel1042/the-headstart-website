// Home page entrance animations powered by GSAP + ScrollTrigger. Skipped on
// other pages or when GSAP is not loaded. Exposes window._playHeroAnimations
// so the splash inline script can trigger the hero animation after fade-out.

import { gsapReady } from "../utils/motion.js";

const animateHero = () => {
  const heroTitle = document.querySelector(".headline-standalone__title");
  const heroSub = document.querySelector(".headline-standalone__subtitle");
  const heroCtas = document.querySelector(".hero-ctas");

  // Remove reveal classes so GSAP takes full control, but keep hidden until splash done
  [heroTitle, heroSub, heroCtas].forEach((el) => {
    if (el) {
      el.classList.remove("reveal", "reveal--up");
      el.style.opacity = "0";
    }
  });

  const playHeroAnimations = () => {
    if (heroTitle) {
      gsap.fromTo(heroTitle,
        { opacity: 0, y: 50, scale: 0.95 },
        { opacity: 1, y: 0, scale: 1, duration: 1, ease: "power3.out", delay: 0.1, clearProps: "transform,opacity" }
      );
    }
    if (heroSub) {
      gsap.fromTo(heroSub,
        { opacity: 0, y: 40 },
        { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", delay: 0.3, clearProps: "transform,opacity" }
      );
    }
    if (heroCtas) {
      gsap.fromTo(heroCtas,
        { opacity: 0, y: 35 },
        { opacity: 1, y: 0, duration: 0.85, ease: "power3.out", delay: 0.5, clearProps: "transform,opacity" }
      );
    }
  };

  const splashEl = document.getElementById("splash");
  if (splashEl && splashEl.style.display !== "none") {
    window._playHeroAnimations = playHeroAnimations;
  } else {
    playHeroAnimations();
  }
};

const animateStoryBlocks = () => {
  const gsapBlocks = document.querySelectorAll(".gsap-block");
  const gsapDividers = document.querySelectorAll(".gsap-divider");

  gsap.set(gsapBlocks, {
    opacity: 0,
    scale: 0.82,
    rotateX: 8,
    rotateZ: -2,
    y: 60,
    transformOrigin: "center bottom",
    transformPerspective: 800,
  });
  gsap.set(gsapDividers, { opacity: 0, scaleX: 0 });

  const storyHeader = document.querySelector("#our-story .about-real__header");
  if (storyHeader) {
    storyHeader.classList.remove("reveal");
    storyHeader.classList.add("reveal-visible");
    gsap.fromTo(storyHeader,
      { opacity: 0, y: 40 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: "power3.out",
        scrollTrigger: { trigger: "#our-story", start: "top 75%", toggleActions: "play none none none" },
      }
    );
  }

  gsapBlocks.forEach((block, i) => {
    gsap.to(block, {
      opacity: 1, scale: 1, rotateX: 0, rotateZ: 0, y: 0,
      duration: 1.1, ease: "power3.out", delay: i * 0.15,
      scrollTrigger: { trigger: block, start: "top 85%", toggleActions: "play none none none" },
      clearProps: "transform,opacity",
    });
  });

  gsapDividers.forEach((div) => {
    gsap.to(div, {
      opacity: 1, scaleX: 1, duration: 0.8, ease: "power2.inOut",
      scrollTrigger: { trigger: div, start: "top 85%", toggleActions: "play none none none" },
    });
  });
};

const animateReviews = () => {
  const reviewHeader = document.querySelector("#reviews .about-real__header");
  if (reviewHeader) {
    reviewHeader.classList.remove("reveal");
    reviewHeader.classList.add("reveal-visible");
    gsap.fromTo(reviewHeader,
      { opacity: 0, y: 40 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: "power3.out",
        scrollTrigger: { trigger: "#reviews", start: "top 75%", toggleActions: "play none none none" },
      }
    );
  }

  const reviewWrap = document.querySelector(".review-column__scroller-wrap");
  if (reviewWrap) {
    reviewWrap.classList.remove("reveal", "reveal--up");
    reviewWrap.classList.add("reveal-visible");
    gsap.fromTo(reviewWrap,
      { opacity: 0, y: 50, scale: 0.96 },
      {
        opacity: 1, y: 0, scale: 1, duration: 1, ease: "power3.out",
        scrollTrigger: { trigger: reviewWrap, start: "top 80%", toggleActions: "play none none none" },
        clearProps: "transform,opacity",
      }
    );
  }
};

const animatePainQuiz = () => {
  const quizHead = document.querySelector(".pain-quiz__head");
  const quizModule = document.querySelector(".pain-quiz__module");

  if (quizHead) {
    quizHead.classList.remove("reveal", "reveal--up");
    quizHead.classList.add("reveal-visible");
    gsap.fromTo(quizHead,
      { opacity: 0, y: 50 },
      {
        opacity: 1, y: 0, duration: 0.9, ease: "power3.out",
        scrollTrigger: { trigger: "#pain-points-quiz", start: "top 75%", toggleActions: "play none none none" },
      }
    );
  }
  if (quizModule) {
    quizModule.classList.remove("reveal", "reveal--up");
    quizModule.classList.add("reveal-visible");
    gsap.fromTo(quizModule,
      { opacity: 0, y: 60, scale: 0.92, rotateX: 6, transformPerspective: 800 },
      {
        opacity: 1, y: 0, scale: 1, rotateX: 0, duration: 1.1, ease: "power3.out",
        scrollTrigger: { trigger: quizModule, start: "top 82%", toggleActions: "play none none none" },
        clearProps: "transform,opacity",
      }
    );
  }
};

export const init = () => {
  if (!gsapReady || !document.body.classList.contains("home-page")) return;
  gsap.registerPlugin(ScrollTrigger);

  animateHero();
  animateStoryBlocks();
  animateReviews();
  animatePainQuiz();
};
