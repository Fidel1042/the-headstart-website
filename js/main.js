// Entry point. Imports every feature module and calls its init() once the DOM
// is parsed. Each module is responsible for detecting whether the elements it
// needs exist, so wiring is order-independent.

import { gsapReady } from "./utils/motion.js";

import { init as initLocalRouteRewrites } from "./modules/local-route-rewrites.js";
import { init as initFooterYear }         from "./modules/footer-year.js";
import { init as initInsightsCta }        from "./modules/insights-cta.js";
import { init as initNavScroll }          from "./modules/nav-scroll.js";
import { init as initNavMoreDropdown }    from "./modules/nav-more-dropdown.js";
import { init as initBackToTop }          from "./modules/back-to-top.js";
import { init as initRevealOnScroll }     from "./modules/reveal-on-scroll.js";
import { init as initServicesToggle }     from "./modules/services-toggle.js";
import { init as initMentorFilters }      from "./modules/mentor-filters.js";
import { init as initMultiStepForm }      from "./modules/multi-step-form.js";
import { init as initServiceCheckboxTriggers } from "./modules/service-checkbox-triggers.js";
import { init as initMentorApplicationForm }   from "./modules/mentor-application-form.js";
import { init as initSearchSelect }       from "./modules/search-select.js";
import { init as initMonthYearPicker }    from "./modules/month-year-picker.js";
import { init as initScrollTo }           from "./modules/scroll-to.js";
import { init as initOurStoryFlow }       from "./modules/our-story-flow.js";
import { init as initReviewScroller }     from "./modules/review-scroller.js";
import { init as initReviewTranslations } from "./modules/review-translations.js";
import { init as initPainQuiz }           from "./modules/pain-quiz.js";
import { init as initHomeGsapAnimations } from "./modules/home-gsap-animations.js";

const bootstrap = () => {
  initFooterYear();
  initLocalRouteRewrites();
  initInsightsCta();
  initNavScroll();
  initNavMoreDropdown();
  initBackToTop();
  initRevealOnScroll();
  initServicesToggle();
  initMentorFilters();
  initMultiStepForm();
  initServiceCheckboxTriggers();
  initMentorApplicationForm();
  initSearchSelect();
  initMonthYearPicker();
  initScrollTo();
  // CSS-driven flow effect would fight GSAP's transforms on the home page.
  if (!gsapReady) initOurStoryFlow();
  initReviewScroller();
  initReviewTranslations();
  initPainQuiz();
  initHomeGsapAnimations();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
