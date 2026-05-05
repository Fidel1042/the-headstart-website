document.addEventListener("DOMContentLoaded", () => {
  if (typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined") {
    gsap.registerPlugin(ScrollTrigger);
  }

  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // GSAP is loaded on the home page via CDN
  const gsapReady = typeof gsap !== "undefined" && typeof ScrollTrigger !== "undefined";

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Keep route-style links working in local previews that do not support rewrites.
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

  const isLikelyNoRewriteEnv =
    location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  const scriptTag =
    document.querySelector("script[src$='script.js']") ||
    document.querySelector("script[src*='/script.js']");
  const scriptSrc = scriptTag?.getAttribute("src") || "script.js";
  const siteRootUrl = new URL(".", new URL(scriptSrc, location.href));

  const normalizeRoutePath = (path) => {
    if (!path) return "/";
    const trimmed = path.replace(/\/+$/, "");
    return trimmed || "/";
  };

  const resolveLocalRouteHref = (routePath) => {
    const mappedFile = routeToFileMap[normalizeRoutePath(routePath)];
    if (!mappedFile) return routePath;
    return new URL(mappedFile, siteRootUrl).toString();
  };

  const routeHref = (routePath) =>
    isLikelyNoRewriteEnv ? resolveLocalRouteHref(routePath) : routePath;

  if (isLikelyNoRewriteEnv) {
    const rewriteRouteAttribute = (el, attr) => {
      const rawValue = el.getAttribute(attr);
      if (!rawValue || !rawValue.startsWith("/") || rawValue.startsWith("//")) return;

      const parsed = new URL(rawValue, "https://local.headstart");
      const localPath = resolveLocalRouteHref(parsed.pathname);
      if (!localPath || localPath === parsed.pathname) return;

      el.setAttribute(attr, `${localPath}${parsed.search}${parsed.hash}`);
    };

    document.querySelectorAll("a[href^='/']").forEach((link) => {
      rewriteRouteAttribute(link, "href");
    });

    document.querySelectorAll("form[action^='/']").forEach((form) => {
      rewriteRouteAttribute(form, "action");
    });
  }

  // Ensure a consistent footer insights CTA exists on every page.
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

  // On home, if a hash was left in the URL (e.g. after clicking "Our story"), reset it and jump to top on refresh
  if (document.body.classList.contains("home-page") && location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => window.scrollTo(0, 0), 0);
  }

  // Shrink nav on scroll
  const nav = document.querySelector(".nav");
  const shrinkNav = () => {
    if (!nav) return;
    nav.classList.toggle("shrunk", window.scrollY > 8);
  };
  window.addEventListener("scroll", shrinkNav);
  shrinkNav();

  // Nav-more dropdown — toggle on click for touch/mobile
  const navMore = document.querySelector(".nav-more");
  if (navMore) {
    navMore.querySelector(".nav-more__trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      navMore.classList.toggle("open");
    });
    document.addEventListener("click", () => navMore.classList.remove("open"));
  }

  // Back-to-top button
  const backToTop = document.querySelector(".back-to-top");
  window.addEventListener("scroll", () => {
    if (!backToTop) return;
    backToTop.classList.toggle("visible", window.scrollY > 200);
  });
  backToTop?.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" })
  );

  // Reveal on scroll (IntersectionObserver) — works on ALL pages including home
  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    if (prefersReducedMotion) {
      revealEls.forEach((el) => el.classList.add("reveal-visible"));
    } else {
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
    }
  }

  // Services: toggle extra details
  document.querySelectorAll("[data-toggle='service-more']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const more = card?.querySelector(".card-more");
      const open = more?.classList.toggle("show");
      if (open !== undefined) {
        btn.textContent = open ? "Show less" : "Show details";
      }
    });
  });

  // Mentors: filters + search + counts
  const filterBtns = document.querySelectorAll("[data-filter]");
  const mentorCards = document.querySelectorAll("[data-mentor-type]");
  const searchInput = document.querySelector("[data-mentor-search]");
  const resetFilters = document.querySelector("[data-mentor-reset]");
  const resultCount = document.querySelector("[data-mentor-count]");
  if (mentorCards.length) {
    let activeType = "all";

    const applyMentorFilters = () => {
      const query = (searchInput?.value || "").trim().toLowerCase();
      let visible = 0;

      mentorCards.forEach((card) => {
        const matchesType =
          activeType === "all" || card.dataset.mentorType === activeType;
        const haystack = (
          card.dataset.mentorFocus || card.textContent || ""
        ).toLowerCase();
        const matchesQuery = !query || haystack.includes(query);
        const show = matchesType && matchesQuery;
        card.style.display = show ? "" : "none";
        if (show) visible += 1;
      });

      if (resultCount) {
        resultCount.textContent = `${visible} result${visible === 1 ? "" : "s"}`;
      }
    };

    filterBtns.forEach((btn) =>
      btn.addEventListener("click", () => {
        activeType = btn.dataset.filter || "all";
        filterBtns.forEach((b) => b.classList.toggle("active", b === btn));
        applyMentorFilters();
      })
    );

    searchInput?.addEventListener("input", () => applyMentorFilters());

    resetFilters?.addEventListener("click", () => {
      activeType = "all";
      filterBtns.forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));
      if (searchInput) searchInput.value = "";
      applyMentorFilters();
    });

    applyMentorFilters();
  }

  const searchSources = {
    universities: [
      "Australian Catholic University",
      "Australian National University",
      "Australian University of Theology",
      "Avondale University",
      "Bond University",
      "Central Queensland University (CQUniversity)",
      "Charles Darwin University",
      "Charles Sturt University",
      "Curtin University",
      "Deakin University",
      "Edith Cowan University",
      "Federation University Australia",
      "Flinders University",
      "Griffith University",
      "James Cook University",
      "La Trobe University",
      "Macquarie University",
      "Monash University",
      "Murdoch University",
      "Queensland University of Technology (QUT)",
      "RMIT University",
      "Southern Cross University",
      "Swinburne University of Technology",
      "The University of Adelaide",
      "The University of Melbourne",
      "The University of Newcastle",
      "The University of Notre Dame Australia",
      "The University of Queensland",
      "The University of Sydney",
      "The University of Western Australia",
      "Torrens University Australia",
      "University of Canberra",
      "University of Divinity",
      "University of New England",
      "University of New South Wales (UNSW)",
      "University of South Australia",
      "University of Southern Queensland",
      "University of Tasmania",
      "University of Technology Sydney (UTS)",
      "University of the Sunshine Coast",
      "University of Wollongong",
      "Victoria University",
      "Western Sydney University",
    ],
    "country-codes": [
      "AF +93",
      "AL +355",
      "DZ +213",
      "AS +1-684",
      "AD +376",
      "AQ +672",
      "AO +244",
      "AI +1-264",
      "AG +1-268",
      "AR +54",
      "AM +374",
      "AW +297",
      "AX +358",
      "AU +61",
      "AT +43",
      "AZ +994",
      "BS +1-242",
      "BH +973",
      "BD +880",
      "BB +1-246",
      "BY +375",
      "BE +32",
      "BZ +501",
      "BJ +229",
      "BM +1-441",
      "BT +975",
      "BO +591",
      "BQ +599",
      "BA +387",
      "BW +267",
      "BR +55",
      "IO +246",
      "BN +673",
      "BG +359",
      "BF +226",
      "BI +257",
      "KH +855",
      "CM +237",
      "CA +1",
      "CV +238",
      "KY +1-345",
      "CF +236",
      "TD +235",
      "CL +56",
      "CN +86",
      "CX +61",
      "CC +61",
      "CO +57",
      "KM +269",
      "CG +242",
      "CD +243",
      "CK +682",
      "CR +506",
      "CI +225",
      "HR +385",
      "CU +53",
      "CW +599",
      "CY +357",
      "CZ +420",
      "DK +45",
      "DJ +253",
      "DM +1-767",
      "DO +1-809",
      "EC +593",
      "EG +20",
      "SV +503",
      "GQ +240",
      "ER +291",
      "EE +372",
      "SZ +268",
      "ET +251",
      "FK +500",
      "FO +298",
      "FJ +679",
      "FI +358",
      "FR +33",
      "GF +594",
      "PF +689",
      "GA +241",
      "GM +220",
      "GE +995",
      "DE +49",
      "GH +233",
      "GI +350",
      "GR +30",
      "GS +500",
      "GL +299",
      "GD +1-473",
      "GP +590",
      "GU +1-671",
      "GT +502",
      "GG +44",
      "GN +224",
      "GW +245",
      "GY +592",
      "HT +509",
      "HN +504",
      "HK +852",
      "HU +36",
      "IS +354",
      "IN +91",
      "ID +62",
      "IR +98",
      "IQ +964",
      "IE +353",
      "IM +44",
      "JE +44",
      "IL +972",
      "IT +39",
      "JM +1-876",
      "JP +81",
      "JO +962",
      "KZ +7",
      "KE +254",
      "KI +686",
      "KP +850",
      "XK +383",
      "KR +82",
      "KW +965",
      "KG +996",
      "LA +856",
      "LV +371",
      "LB +961",
      "LS +266",
      "LR +231",
      "LY +218",
      "LI +423",
      "LT +370",
      "LU +352",
      "MO +853",
      "MG +261",
      "MW +265",
      "MY +60",
      "MV +960",
      "ML +223",
      "MT +356",
      "MH +692",
      "MQ +596",
      "MR +222",
      "MU +230",
      "YT +262",
      "MX +52",
      "FM +691",
      "MD +373",
      "MC +377",
      "MN +976",
      "ME +382",
      "MS +1-664",
      "MA +212",
      "MZ +258",
      "MM +95",
      "NA +264",
      "NR +674",
      "NP +977",
      "NL +31",
      "NC +687",
      "NZ +64",
      "NI +505",
      "NE +227",
      "NG +234",
      "NU +683",
      "NF +672",
      "MP +1-670",
      "NO +47",
      "OM +968",
      "PK +92",
      "PW +680",
      "PS +970",
      "PA +507",
      "PG +675",
      "PY +595",
      "PE +51",
      "PH +63",
      "PN +64",
      "PL +48",
      "PT +351",
      "PR +1-787",
      "QA +974",
      "RE +262",
      "RO +40",
      "RU +7",
      "RW +250",
      "BL +590",
      "SH +290",
      "KN +1-869",
      "LC +1-758",
      "MF +590",
      "PM +508",
      "VC +1-784",
      "WS +685",
      "SM +378",
      "ST +239",
      "SA +966",
      "SN +221",
      "RS +381",
      "SC +248",
      "SL +232",
      "SG +65",
      "SX +1-721",
      "SK +421",
      "SI +386",
      "SB +677",
      "SO +252",
      "ZA +27",
      "SS +211",
      "ES +34",
      "LK +94",
      "SD +249",
      "SR +597",
      "SJ +47",
      "SE +46",
      "CH +41",
      "SY +963",
      "TW +886",
      "TJ +992",
      "TZ +255",
      "TH +66",
      "TL +670",
      "TG +228",
      "TK +690",
      "TO +676",
      "TT +1-868",
      "TN +216",
      "TR +90",
      "TM +993",
      "TC +1-649",
      "TV +688",
      "UG +256",
      "UA +380",
      "AE +971",
      "UK +44",
      "US +1",
      "UY +598",
      "UZ +998",
      "VU +678",
      "VA +379",
      "VE +58",
      "VN +84",
      "VG +1-284",
      "VI +1-340",
      "WF +681",
      "EH +212",
      "YE +967",
      "ZM +260",
      "ZW +263",
    ],
    "uni-years": [
      "Year 1",
      "Year 2",
      "Year 3",
      "Year 4",
      "Year 5",
      "Year 6+",
    ],
    "highschool-years": [
      "Year 10",
      "Year 11",
      "Year 12",
    ],
  };

  searchSources["dial-codes"] = Array.from(
    new Set(
      searchSources["country-codes"]
        .map((option) => option.match(/\+\d[\d-]*/)?.[0] || "")
        .filter(Boolean)
    )
  );

  // Multi-step forms
  document.querySelectorAll(".multi-step").forEach((form) => {
    const steps = Array.from(form.querySelectorAll(".form-step"));
    if (!steps.length) return;
    let current = 0;

    const showStep = (index) => {
      steps.forEach((step, i) => {
        const isCurrent = i === index;
        const isUnlocked = i <= index;
        step.classList.toggle("is-active", isCurrent);
        if (isUnlocked) {
          step.classList.add("is-visible");
        } else {
          step.classList.remove("is-visible");
        }
      });
    };

    const validateStep = (index) => {
      const step = steps[index];
      const requiredFields = step.querySelectorAll("input[required], select[required], textarea[required]");
      for (const field of requiredFields) {
        if (!field.checkValidity()) {
          field.reportValidity();
          return false;
        }
      }

      const checkboxGroups = step.querySelectorAll(".checkbox-grid");
      for (const group of checkboxGroups) {
        const boxes = Array.from(group.querySelectorAll('input[type="checkbox"]'));
        const isHidden = group.offsetParent === null;
        if (isHidden) continue;
        if (boxes.length && !boxes.some((box) => box.checked)) {
          showFormMessage("Please select at least one option.");
          return false;
        }
      }
      return true;
    };

    const goToStep = (index) => {
      current = Math.max(0, Math.min(index, steps.length - 1));
      showStep(current);
    };

    form.querySelectorAll(".form-next").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (validateStep(current)) goToStep(current + 1);
      })
    );

    form.querySelectorAll(".form-prev").forEach((btn) =>
      btn.addEventListener("click", () => goToStep(current - 1))
    );

    goToStep(0);

    const studyLevelRadios = form.querySelectorAll('input[name="study_level"]');
    const conditionalFields = form.querySelectorAll("[data-study-level-field]");
    if (studyLevelRadios.length && conditionalFields.length) {
      const toggleStudyLevelFields = () => {
        const selected = form.querySelector('input[name="study_level"]:checked')?.value || "";
        conditionalFields.forEach((field) => {
          const levels = field.dataset.studyLevelField
            .split(",")
            .map((level) => level.trim())
            .filter(Boolean);
          const shouldShow = selected && levels.includes(selected);
          field.classList.toggle("is-visible", shouldShow);
          field.setAttribute("aria-hidden", shouldShow ? "false" : "true");
          if (shouldShow) {
            field.removeAttribute("hidden");
          } else if (!field.hasAttribute("hidden")) {
            field.setAttribute("hidden", "");
          }
          field.querySelectorAll("[data-require-when-visible]").forEach((input) => {
            if (shouldShow) {
              input.disabled = false;
              input.required = true;
            } else {
              input.required = false;
              input.disabled = true;
              if (input.tagName === "SELECT") {
                input.selectedIndex = 0;
              } else {
                input.value = "";
              }
            }
          });
        });
      };
      studyLevelRadios.forEach((radio) =>
        radio.addEventListener("change", () => toggleStudyLevelFields())
      );
      toggleStudyLevelFields();
    }
  });

  document.querySelectorAll(".checkbox-trigger input[type=\"checkbox\"]").forEach((checkbox) => {
    const label = checkbox.closest(".checkbox-trigger");
    const serviceTarget = label?.dataset.serviceTarget;
    const descriptionKey = label?.dataset.descriptionTarget;
    const descriptionBox = descriptionKey
      ? document.querySelector(`.service-description[data-description=\"${descriptionKey}\"]`)
      : null;

    const toggleTargets = () => {
      if (serviceTarget) {
        const target = document.getElementById(serviceTarget);
        if (target) target.classList.toggle("is-visible", checkbox.checked);
      }
      if (descriptionBox) {
        descriptionBox.classList.toggle("is-visible", checkbox.checked);
        const textarea = descriptionBox.querySelector("textarea");
        if (textarea) {
          textarea.required = checkbox.checked;
          if (!checkbox.checked) textarea.value = "";
        }
      }
    };

    checkbox.addEventListener("change", toggleTargets);
    toggleTargets();
  });

  const showFormMessage = (() => {
    let timeoutId;
    return (message) => {
      let panel = document.querySelector(".form-message");
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "form-message";
        document.body.appendChild(panel);
      }
      panel.textContent = message;
      panel.classList.add("is-visible");
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => panel.classList.remove("is-visible"), 3200);
    };
  })();

  document.querySelectorAll("form.mentor-application-form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      form
        .querySelectorAll(
          'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], textarea'
        )
        .forEach((field) => {
          if (typeof field.value === "string") field.value = field.value.trim();
        });

      if (!form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
      }
    });
  });

  const initSearchSelect = (group, options) => {
    const input = group.querySelector("[data-search-input]") || group.querySelector("input");
    const dropdown = group.querySelector(".search-select-dropdown");
    if (!input || !dropdown || !options.length) return;
    const countryCodeOnly = input.hasAttribute("data-country-code-only");
    let committedValue = options.includes((input.value || "").trim())
      ? (input.value || "").trim()
      : "";

    const sanitizeCountryCode = (value) => {
      let cleaned = (value || "").replace(/[^\d+-]/g, "");
      cleaned = cleaned.replace(/(?!^)\+/g, "");
      if (cleaned && cleaned[0] !== "+") {
        cleaned = `+${cleaned.replace(/\+/g, "")}`;
      }
      return cleaned;
    };

    const setCountryCodeValidity = () => {
      if (!countryCodeOnly) return;
      const value = (input.value || "").trim();
      if (!value) {
        input.setCustomValidity("Please select a country code.");
      } else if (options.includes(value)) {
        input.setCustomValidity("");
        committedValue = value;
      } else {
        input.setCustomValidity("Please choose a valid country code from the list.");
      }
    };

    if (countryCodeOnly && !committedValue) {
      committedValue = options.includes("+61") ? "+61" : options[0];
      input.value = committedValue;
    }

    const hideDropdown = () => {
      dropdown.classList.remove("show");
      dropdown.hidden = true;
    };

    const showDropdown = () => {
      dropdown.hidden = false;
      dropdown.classList.add("show");
    };

    const renderOptions = () => {
      const query = (input.value || "").trim().toLowerCase();
      dropdown.innerHTML = "";
      const filtered = options.filter((option) =>
        option.toLowerCase().includes(query)
      );
      if (!filtered.length) {
        hideDropdown();
        return;
      }
      filtered.forEach((option) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "search-select-option";
        btn.textContent = option;
        btn.dataset.value = option;
        dropdown.appendChild(btn);
      });
      showDropdown();
    };

    dropdown.addEventListener("mousedown", (event) => {
      const option = event.target.closest(".search-select-option");
      if (!option) return;
      event.preventDefault();
      input.value = option.dataset.value || "";
      setCountryCodeValidity();
      hideDropdown();
    });

    input.addEventListener("focus", () => {
      renderOptions();
    });

    input.addEventListener("input", () => {
      if (countryCodeOnly) {
        const sanitized = sanitizeCountryCode(input.value);
        if (sanitized !== input.value) {
          input.value = sanitized;
        }
        setCountryCodeValidity();
      }
      renderOptions();
    });

    input.addEventListener("keydown", (event) => {
      if (countryCodeOnly && event.key.length === 1 && !/[0-9+-]/.test(event.key)) {
        event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        hideDropdown();
      }
    });

    input.addEventListener("blur", () => {
      if (countryCodeOnly) {
        input.value = sanitizeCountryCode(input.value);
        if (!options.includes(input.value)) {
          input.value = committedValue;
        }
        setCountryCodeValidity();
      }
      setTimeout(() => hideDropdown(), 120);
    });

    document.addEventListener("click", (event) => {
      if (!group.contains(event.target)) hideDropdown();
    });
  };

  document.querySelectorAll(".search-select").forEach((group) => {
    const source = group.dataset.searchSource;
    const options = source ? searchSources[source] : null;
    if (options?.length) {
      initSearchSelect(group, options);
    }
  });

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const initMonthYearField = (field) => {
    const input = field.querySelector("[data-month-year-input]");
    const toggle = field.querySelector(".month-year-toggle");
    const dropdown = field.querySelector("[data-month-year-dropdown]");
    const monthList = dropdown?.querySelector("[data-month-list]");
    const yearList = dropdown?.querySelector("[data-year-list]");
    if (!input || !toggle || !dropdown || !monthList || !yearList) return;

    const yearStart = parseInt(field.dataset.yearStart, 10) || new Date().getFullYear() - 5;
    const yearEnd = parseInt(field.dataset.yearEnd, 10) || new Date().getFullYear() + 5;
    let selectedMonth = "";
    let selectedYear = "";

    const buildLists = () => {
      monthList.innerHTML = "";
      monthNames.forEach((name) => {
        const item = document.createElement("li");
        item.textContent = name;
        item.dataset.value = name;
        item.dataset.type = "month";
        item.tabIndex = 0;
        item.className = "month-year-option";
        item.setAttribute("role", "option");
        monthList.appendChild(item);
      });

      yearList.innerHTML = "";
      for (let year = yearStart; year <= yearEnd; year += 1) {
        const item = document.createElement("li");
        item.textContent = year.toString();
        item.dataset.value = year.toString();
        item.dataset.type = "year";
        item.tabIndex = 0;
        item.className = "month-year-option";
        item.setAttribute("role", "option");
        yearList.appendChild(item);
      }
    };

    const highlight = () => {
      monthList.querySelectorAll(".month-year-option").forEach((item) => {
        item.classList.toggle("active", item.dataset.value === selectedMonth);
      });
      yearList.querySelectorAll(".month-year-option").forEach((item) => {
        item.classList.toggle("active", item.dataset.value === selectedYear);
      });
    };

    const openDropdown = () => {
      dropdown.classList.add("show");
      input.setAttribute("aria-expanded", "true");
    };

    const closeDropdown = () => {
      dropdown.classList.remove("show");
      input.setAttribute("aria-expanded", "false");
    };

    const updateInputValue = () => {
      if (selectedMonth && selectedYear) {
        input.value = `${selectedMonth} ${selectedYear}`;
        closeDropdown();
      }
    };

    const handleSelect = (type, value) => {
      if (type === "month") {
        selectedMonth = value;
      } else {
        selectedYear = value;
      }
      highlight();
      updateInputValue();
    };

    const handleOptionEvent = (event) => {
      const option = event.target.closest(".month-year-option");
      if (!option) return;
      event.preventDefault();
      handleSelect(option.dataset.type, option.dataset.value);
      if (document.activeElement === option) {
        input.focus();
      }
    };

    const handleKeyDown = (event) => {
      const option = event.target.closest(".month-year-option");
      if (!option) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleSelect(option.dataset.type, option.dataset.value);
        input.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown();
        input.focus();
      }
    };

    const toggleDropdown = () => {
      if (dropdown.classList.contains("show")) {
        closeDropdown();
      } else {
        openDropdown();
      }
    };

    input.addEventListener("focus", openDropdown);
    input.addEventListener("click", openDropdown);
    input.addEventListener("input", () => {
      selectedMonth = "";
      selectedYear = "";
      highlight();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDropdown();
      }
    });

    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!field.contains(document.activeElement)) {
          closeDropdown();
        }
      }, 120);
    });

    toggle.addEventListener("click", (event) => {
      event.preventDefault();
      input.focus();
      toggleDropdown();
    });

    monthList.addEventListener("mousedown", handleOptionEvent);
    yearList.addEventListener("mousedown", handleOptionEvent);
    monthList.addEventListener("keydown", handleKeyDown);
    yearList.addEventListener("keydown", handleKeyDown);

    document.addEventListener("click", (event) => {
      if (!field.contains(event.target)) {
        closeDropdown();
      }
    });

    buildLists();
  };

  document.querySelectorAll("[data-scroll-to]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const target = btn.getAttribute("data-scroll-to");
      if (!target) return;
      const el = document.querySelector(target);
      if (el) {
        const navHeight = document.querySelector("header")?.offsetHeight || 80;
        const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 24;
        window.scrollTo({ top, behavior: "smooth" });
      }
    });
  });

  const initOurStoryFlow = () => {
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

  const initReviewScroller = () => {
    const scroller = document.querySelector(".review-column__scroller");
    if (!scroller) return;
    const prevBtn = document.querySelector("[data-review-prev]");
    const nextBtn = document.querySelector("[data-review-next]");
    if (!prevBtn && !nextBtn) return;

    const scrollByPage = (direction) => {
      const amount = scroller.clientWidth;
      scroller.scrollBy({ left: amount * direction, behavior: "smooth" });
    };

    prevBtn?.addEventListener("click", () => scrollByPage(-1));
    nextBtn?.addEventListener("click", () => scrollByPage(1));
  };

  const initReviewTranslations = () => {
    const cards = document.querySelectorAll(".review-column__card");
    if (!cards.length) return;

    cards.forEach((card) => {
      const quote = card.querySelector(".review-column__quote");
      const btn = card.querySelector("[data-review-translate]");
      if (!quote || !btn) return;

      const zh = quote.dataset.reviewZh;
      if (!zh) return;
      if (!quote.dataset.reviewEn) {
        quote.dataset.reviewEn = quote.textContent.trim();
      }

      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        quote.textContent = zh;
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
      });
    });
  };

  const initPainQuiz = () => {
    const section = document.getElementById("pain-points-quiz");
    if (!section) return;
    const module = section.querySelector(".pain-quiz__module");
    if (!module) return;

    const card       = module.querySelector("[data-quiz-card]");
    const cardText   = module.querySelector("[data-quiz-card-text]");
    const qNum       = module.querySelector("[data-quiz-num]");
    const liveCount  = module.querySelector("[data-quiz-live-count]");
    const yesBtn     = module.querySelector("[data-quiz-yes]");
    const noBtn      = module.querySelector("[data-quiz-no]");
    const actions    = module.querySelector("[data-quiz-actions]");
    const barsEl     = module.querySelector("[data-quiz-bars]");
    const yesPct     = module.querySelector("[data-quiz-yes-pct]");
    const noPct      = module.querySelector("[data-quiz-no-pct]");
    const yesBar     = module.querySelector("[data-quiz-yes-bar]");
    const noBar      = module.querySelector("[data-quiz-no-bar]");
    const peerLine   = module.querySelector("[data-quiz-peer-line]");
    const nextBtn    = module.querySelector("[data-quiz-next]");
    const pipsWrap   = module.querySelector("[data-quiz-pips]");
    if (!card || !cardText || !yesBtn || !noBtn) return;

    const prompts = [
      "Re-recording digital interviews again and again because they still don't feel right.",
      "Auto-rejected because of visa status even though the grad role is clearly in reach.",
      "Being told multiple internships are needed to stand out but you can't even land the first one.",
      "Feeling like being an introvert means you'll never stand out in assessment centres.",
      "You have no clue how to impress the professionals even after finally landing a coffee chat.",
      "Applying for part-time jobs with 600+ applicants and wondering how you're supposed to gain ANY experience for an internship.",
    ];
    const peerPct    = [82, 74, 78, 65, 58, 71];
    const liveCounts = [2143, 1742, 1517, 1204, 938, 876];
    const yesLines   = [
      "Imagine having someone who has done those exact interviews and landed the role, teaching you how to do the same.",
      "We understand the system is unfair to international students. Our mentors were once one of them.",
      "1 warm opportunity beats 20 cold applications. We teach you how to actually build those connections.",
      "Most introverts who landed roles stopped trying to act extroverted and leaned into their strengths.",
      "We help you go into coffee chats with the right questions and leave with an actual follow-up plan.",
      "We help you find one real opportunity that can actually be used to build your experience.",
    ];
    const noLines    = [
      "You're ahead of most. A lot of students waste weeks on this before realising what's actually being assessed.",
      "You've already removed one barrier that stops 40% of candidates before they even apply.",
      "If you've already landed one, you're in the top 20% of applicants. The question now is how to convert it into a better internship or grad role.",
      "That's a real advantage. A lot of people mistake confidence for preparation, and lose for it.",
      "Nice. Most people leave coffee chats with nothing concrete to follow up on.",
      "Smart move skipping that queue. Most students lose months there before finding a better path.",
    ];
    const archetypes = [
      { type: "The Early Mover",           desc: "None of these hit you, which puts you ahead of most. The students who land early aren't always better prepared. They just act on strategy before the competition heats up." },
      { type: "The 95% Candidate",         desc: "One thing is quietly costing you. That is often all it takes to miss a role that would have been yours. One focused session usually finds it fast." },
      { type: "The Quiet Grinder",         desc: "You're putting in the work. But effort without the right feedback doesn't compound. A session with someone who cracked it recently redirects that energy." },
      { type: "The Overthinking Applicant", desc: "You can see the gap but you're not sure what to fix first. That loop is expensive. One session with someone who has been there recently ends it." },
      { type: "The System Fighter",        desc: "The deck is stacked against you in more than one way. There is a path through it, but it is not the one advertised on university career pages." },
      { type: "The Invisible Candidate",   desc: "Everything looks right from the outside but nothing is landing. The gap is usually invisible until someone who has done the same interviews recently points it out." },
      { type: "The Deep End",              desc: "You are navigating the full weight of what international students face. This is not a tips list problem. It is exactly what 1-on-1 mentoring was built for." },
    ];

    let cur = 0, yesCount = 0;
    const navCta = document.querySelector(".nav-cta--gold");
    const freeCallHref = navCta?.getAttribute("href") || routeHref("/discovery-call");

    // Build pips
    const pipFills = prompts.map(() => {
      const pip = document.createElement("div");
      pip.className = "pain-quiz__pip";
      const fill = document.createElement("div");
      fill.className = "pain-quiz__pip-fill";
      pip.appendChild(fill);
      pipsWrap?.appendChild(pip);
      return fill;
    });

    const pulsePip = (index) => {
      const fill = pipFills[index];
      if (!fill || typeof gsap === "undefined") return;
      gsap.timeline()
        .to(fill, { width: "100%", duration: 0.4, ease: "power2.inOut" })
        .to(fill, { boxShadow: "0 0 10px #c9a84c, 0 0 22px rgba(201,168,76,0.45)", duration: 0.18 })
        .to(fill, { boxShadow: "none", duration: 0.4 });
    };

    const burst = (originEl) => {
      if (typeof gsap === "undefined") return;
      const rect = originEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      for (let i = 0; i < 18; i++) {
        const p = document.createElement("div");
        const size = 6 + Math.random() * 8;
        p.style.cssText = `position:fixed;width:${size}px;height:${size}px;border-radius:50%;background:#c9a84c;left:${cx}px;top:${cy}px;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);`;
        document.body.appendChild(p);
        const angle = (Math.PI * 2 / 18) * i + Math.random() * 0.3;
        const dist  = 60 + Math.random() * 100;
        gsap.fromTo(p,
          { x: 0, y: 0, opacity: 1, scale: 1 },
          { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 0.1,
            duration: 0.6 + Math.random() * 0.25, ease: "power2.out", onComplete: () => p.remove() }
        );
      }
    };

    const bounceBtn = (btn) => {
      if (typeof gsap === "undefined") return;
      gsap.timeline()
        .to(btn, { scale: 0.88, duration: 0.09, ease: "power2.in" })
        .to(btn, { scale: 1,    duration: 0.4,  ease: "back.out(3.5)" });
    };

    const countUp = (el, target) => {
      if (!el || typeof gsap === "undefined") return;
      const obj = { val: 0 };
      gsap.to(obj, { val: target, duration: 0.95, ease: "power2.out",
        onUpdate: () => { el.textContent = Math.round(obj.val) + "%"; }
      });
    };

    const load = () => {
      if (qNum)      qNum.textContent      = `Question ${cur + 1} of ${prompts.length}`;
      if (cardText)  cardText.textContent  = prompts[cur];
      if (liveCount) liveCount.textContent = `${liveCounts[cur].toLocaleString()} students have answered this`;
      if (actions) actions.style.display = "";
      if (barsEl)  barsEl.style.display  = "none";
      if (yesBar)  yesBar.style.width    = "0%";
      if (noBar)   noBar.style.width     = "0%";
      if (yesPct)  yesPct.textContent    = "0%";
      if (noPct)   noPct.textContent     = "0%";
    };

    const vote = (isYes) => {
      const btn = isYes ? yesBtn : noBtn;
      bounceBtn(btn);
      if (isYes) { yesCount++; setTimeout(() => burst(btn), 90); }
      pulsePip(cur);

      setTimeout(() => {
        if (actions) actions.style.display = "none";
        if (barsEl)  barsEl.style.display  = "";
        if (typeof gsap !== "undefined") {
          gsap.fromTo(barsEl, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3 });
        }
        const yp = peerPct[cur], np = 100 - yp;
        setTimeout(() => {
          if (yesBar) yesBar.style.width = yp + "%";
          if (noBar)  noBar.style.width  = np + "%";
          countUp(yesPct, yp);
          countUp(noPct,  np);
        }, 80);
        if (peerLine) {
          peerLine.innerHTML = isYes
            ? `<strong>${yp}% felt the same.</strong> ${yesLines[cur]}`
            : `<strong>You're in the ${np}% who don't.</strong> ${noLines[cur]}`;
        }
      }, 300);
    };

    const advance = () => {
      if (typeof gsap !== "undefined") {
        gsap.to(card, { opacity: 0, y: -14, duration: 0.25, ease: "power2.in", onComplete: () => {
          cur++;
          if (cur >= prompts.length) showResult();
          else { load(); gsap.fromTo(card, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" }); }
        }});
      } else {
        cur++;
        if (cur >= prompts.length) showResult(); else load();
      }
    };

    const showResult = () => {
      module.classList.add("pain-quiz__module--complete");
      if (actions)  actions.style.display  = "none";
      if (barsEl)   barsEl.style.display   = "none";
      if (pipsWrap) pipsWrap.style.display = "none";
      card.classList.add("pain-quiz__card--result");
      const a = archetypes[Math.min(yesCount, archetypes.length - 1)];
      const callLink = `<a class="gradient-link gold-link" href="${freeCallHref}">book a free call</a>`;
      cardText.innerHTML = `<strong class="pain-quiz__archetype-type">${a.type}</strong><span class="pain-quiz__archetype-desc">${a.desc}</span><span class="pain-quiz__archetype-cta">Ready to change that? ${callLink}.</span>`;
      if (typeof gsap !== "undefined") {
        gsap.fromTo(card,
          { scale: 0.9, opacity: 0 },
          { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(1.6)", clearProps: "transform,opacity" }
        );
      }
    };

    yesBtn.addEventListener("click", () => vote(true));
    noBtn.addEventListener("click",  () => vote(false));
    nextBtn?.addEventListener("click", advance);

    load();
  };

  document.querySelectorAll(".month-year-field").forEach((field) => initMonthYearField(field));
  // Only run the CSS-based flow effect if GSAP isn't handling it — they fight over transform
  if (!gsapReady) initOurStoryFlow();
  initReviewScroller();
  initReviewTranslations();
  initPainQuiz();

  // ── GSAP home page animations ──
  if (gsapReady && document.body.classList.contains("home-page")) {
    gsap.registerPlugin(ScrollTrigger);

    // Hero: title, subtitle, CTAs stagger in after splash finishes
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

    // Expose for splash script to call, or play immediately if no splash
    const splashEl = document.getElementById("splash");
    if (splashEl && splashEl.style.display !== "none") {
      window._playHeroAnimations = playHeroAnimations;
    } else {
      playHeroAnimations();
    }

    // ── Story blocks: Demo A cinematic scale + fade + rotation ──
    const gsapBlocks = document.querySelectorAll(".gsap-block");
    const gsapDividers = document.querySelectorAll(".gsap-divider");

    gsap.set(gsapBlocks, {
      opacity: 0,
      scale: 0.82,
      rotateX: 8,
      rotateZ: -2,
      y: 60,
      transformOrigin: "center bottom",
      transformPerspective: 800
    });
    gsap.set(gsapDividers, { opacity: 0, scaleX: 0 });

    // Section header
    const storyHeader = document.querySelector("#our-story .about-real__header");
    if (storyHeader) {
      storyHeader.classList.remove("reveal");
      storyHeader.classList.add("reveal-visible");
      gsap.fromTo(storyHeader,
        { opacity: 0, y: 40 },
        {
          opacity: 1, y: 0, duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: "#our-story", start: "top 75%", toggleActions: "play none none none" }
        }
      );
    }

    gsapBlocks.forEach((block, i) => {
      gsap.to(block, {
        opacity: 1, scale: 1, rotateX: 0, rotateZ: 0, y: 0,
        duration: 1.1, ease: "power3.out", delay: i * 0.15,
        scrollTrigger: { trigger: block, start: "top 85%", toggleActions: "play none none none" },
        clearProps: "transform,opacity"
      });
    });

    gsapDividers.forEach((div) => {
      gsap.to(div, {
        opacity: 1, scaleX: 1, duration: 0.8, ease: "power2.inOut",
        scrollTrigger: { trigger: div, start: "top 85%", toggleActions: "play none none none" }
      });
    });

    // ── Reviews header ──
    const reviewHeader = document.querySelector("#reviews .about-real__header");
    if (reviewHeader) {
      reviewHeader.classList.remove("reveal");
      reviewHeader.classList.add("reveal-visible");
      gsap.fromTo(reviewHeader,
        { opacity: 0, y: 40 },
        {
          opacity: 1, y: 0, duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: "#reviews", start: "top 75%", toggleActions: "play none none none" }
        }
      );
    }

    // Reviews scroller wrap
    const reviewWrap = document.querySelector(".review-column__scroller-wrap");
    if (reviewWrap) {
      reviewWrap.classList.remove("reveal", "reveal--up");
      reviewWrap.classList.add("reveal-visible");
      gsap.fromTo(reviewWrap,
        { opacity: 0, y: 50, scale: 0.96 },
        {
          opacity: 1, y: 0, scale: 1, duration: 1, ease: "power3.out",
          scrollTrigger: { trigger: reviewWrap, start: "top 80%", toggleActions: "play none none none" },
          clearProps: "transform,opacity"
        }
      );
    }

    // ── Pain quiz section entrance ──
    const quizHead = document.querySelector(".pain-quiz__head");
    const quizModule = document.querySelector(".pain-quiz__module");

    if (quizHead) {
      quizHead.classList.remove("reveal", "reveal--up");
      quizHead.classList.add("reveal-visible");
      gsap.fromTo(quizHead,
        { opacity: 0, y: 50 },
        {
          opacity: 1, y: 0, duration: 0.9, ease: "power3.out",
          scrollTrigger: { trigger: "#pain-points-quiz", start: "top 75%", toggleActions: "play none none none" }
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
          clearProps: "transform,opacity"
        }
      );
    }
  }
});
