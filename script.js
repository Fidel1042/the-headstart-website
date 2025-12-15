document.addEventListener("DOMContentLoaded", () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

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

  // Back-to-top button
  const backToTop = document.querySelector(".back-to-top");
  window.addEventListener("scroll", () => {
    if (!backToTop) return;
    backToTop.classList.toggle("visible", window.scrollY > 200);
  });
  backToTop?.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" })
  );

  // Reveal on scroll (simple IntersectionObserver)
  const revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => obs.observe(el));
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
      "AD +376",
      "AO +244",
      "AG +1-268",
      "AR +54",
      "AM +374",
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
      "BT +975",
      "BO +591",
      "BA +387",
      "BW +267",
      "BR +55",
      "BN +673",
      "BG +359",
      "BF +226",
      "BI +257",
      "KH +855",
      "CM +237",
      "CA +1",
      "CV +238",
      "CF +236",
      "TD +235",
      "CL +56",
      "CN +86",
      "CO +57",
      "KM +269",
      "CG +242",
      "CD +243",
      "CR +506",
      "HR +385",
      "CU +53",
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
      "FJ +679",
      "FI +358",
      "FR +33",
      "GA +241",
      "GM +220",
      "GE +995",
      "DE +49",
      "GH +233",
      "GR +30",
      "GD +1-473",
      "GT +502",
      "GN +224",
      "GW +245",
      "GY +592",
      "HT +509",
      "HN +504",
      "HU +36",
      "IS +354",
      "IN +91",
      "ID +62",
      "IR +98",
      "IQ +964",
      "IE +353",
      "IL +972",
      "IT +39",
      "CI +225",
      "JM +1-876",
      "JP +81",
      "JO +962",
      "KZ +7",
      "KE +254",
      "KI +686",
      "XK +383",
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
      "MG +261",
      "MW +265",
      "MY +60",
      "MV +960",
      "ML +223",
      "MT +356",
      "MH +692",
      "MR +222",
      "MU +230",
      "MX +52",
      "FM +691",
      "MD +373",
      "MC +377",
      "MN +976",
      "ME +382",
      "MA +212",
      "MZ +258",
      "MM +95",
      "NA +264",
      "NR +674",
      "NP +977",
      "NL +31",
      "NZ +64",
      "NI +505",
      "NE +227",
      "NG +234",
      "KP +850",
      "MK +389",
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
      "PL +48",
      "PT +351",
      "QA +974",
      "RO +40",
      "RU +7",
      "RW +250",
      "KN +1-869",
      "LC +1-758",
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
      "SK +421",
      "SI +386",
      "SB +677",
      "SO +252",
      "ZA +27",
      "KR +82",
      "SS +211",
      "ES +34",
      "LK +94",
      "SD +249",
      "SR +597",
      "SE +46",
      "CH +41",
      "SY +963",
      "TW +886",
      "TJ +992",
      "TZ +255",
      "TH +66",
      "TL +670",
      "TG +228",
      "TO +676",
      "TT +1-868",
      "TN +216",
      "TR +90",
      "TM +993",
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

  const initSearchSelect = (group, options) => {
    const input = group.querySelector("[data-search-input]") || group.querySelector("input");
    const dropdown = group.querySelector(".search-select-dropdown");
    if (!input || !dropdown || !options.length) return;

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
      hideDropdown();
    });

    input.addEventListener("focus", () => {
      renderOptions();
    });

    input.addEventListener("input", () => {
      renderOptions();
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideDropdown();
      }
    });

    input.addEventListener("blur", () => {
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
        el.scrollIntoView({ behavior: "smooth" });
      }
    });
  });


  const initPainQuiz = () => {
    const section = document.getElementById("pain-points-quiz");
    if (!section) return;

    const module = section.querySelector(".pain-quiz__module");
    const card = module?.querySelector("[data-quiz-card]");
    const cardText = module?.querySelector("[data-quiz-card-text]");
    const yesBtn = module?.querySelector("[data-quiz-yes]");
    const skipBtn = module?.querySelector("[data-quiz-skip]");
    const actions = module?.querySelector("[data-quiz-actions]");
    const progress = module?.querySelector("[data-quiz-progress]");
    const progressText = module?.querySelector("[data-quiz-progress-text]");
    const prevBtn = module?.querySelector("[data-quiz-prev]");
    const nextBtn = module?.querySelector("[data-quiz-next]");
    const dotsContainer = module?.querySelector(".pain-quiz__dots");
    if (!card || !cardText || !yesBtn || !skipBtn || !module) return;

    const prompts = [
      "Re-recording digital interviews again and again because they still don't feel right.",
      "Auto-rejected because of visa status even though the grad role is clearly in reach.",
      "Being told multiple internships are needed to stand out but you can't even land the first one.",
      "Feeling like being an introvert means you'll never stand out in assessment centres.",
      "You have no clue how to impress the professionals even after finally landing a coffee chat.",
      "Applying for part-time jobs with 600+ applicants and wondering how you're supposed to gain ANY experience for an internship.",
    ];

    let dots = Array.from(module.querySelectorAll("[data-quiz-dot]"));
    if (!dots.length && dotsContainer) {
      dots = prompts.map((_, index) => {
        const dot = document.createElement("span");
        dot.className = "pain-quiz__dot";
        if (index === 0) dot.classList.add("is-active");
        dotsContainer.appendChild(dot);
        return dot;
      });
    }

    const total = prompts.length;
    let currentIndex = 0;
    let yesCount = 0;
    let isAnimating = false;
    const navCta = document.querySelector(".nav-cta--gold");
    const freeCallHref = navCta?.getAttribute("href") || "discovery-call.html";

    const updateProgress = () => {
      if (progressText) {
        const safeIndex = Math.min(currentIndex + 1, total);
        progressText.textContent = `Card ${safeIndex} of ${total}`;
      }
      dots.forEach((dot, index) => {
        dot.classList.toggle("is-active", index === currentIndex);
      });
      if (prevBtn) {
        prevBtn.disabled = currentIndex === 0;
      }
    };

    const changeCard = (nextIndex, direction = 1) => {
      if (nextIndex < 0 || nextIndex >= total) return;
      if (isAnimating) return;

      const applyChange = () => {
        currentIndex = nextIndex;
        cardText.textContent = prompts[currentIndex];
        card.classList.remove("pain-quiz__card--result");
        cardText.classList.remove("pain-quiz__result");
        updateProgress();
      };

      const animate = typeof card.animate === "function";
      if (!animate) {
        applyChange();
        return;
      }

      isAnimating = true;
      const distance = direction > 0 ? -18 : 18;
      const outAnim = card.animate(
        [
          { opacity: 1, transform: "translateX(0)" },
          { opacity: 0, transform: `translateX(${distance}px)` },
        ],
        { duration: 220, easing: "ease", fill: "forwards" }
      );

      outAnim.onfinish = () => {
        applyChange();
        card.animate(
          [
            { opacity: 0, transform: `translateX(${-distance}px)` },
            { opacity: 1, transform: "translateX(0)" },
          ],
          { duration: 220, easing: "ease", fill: "forwards" }
        ).onfinish = () => {
          isAnimating = false;
        };
      };
    };

    const finishQuiz = () => {
      module.classList.add("pain-quiz__module--complete");
      card.classList.add("pain-quiz__card--result");
      cardText.classList.add("pain-quiz__result");
      const servicesLink = `<a class="gradient-link gold-link" href="services.html">help</a>`;
      const callLink = `<a class="gradient-link gold-link" href="${freeCallHref}">booking a free call</a>`;
      cardText.innerHTML = `You are not alone in this challenge, see how we ${servicesLink} or go straight to ${callLink}.`;
      actions?.setAttribute("hidden", "");
      progress?.setAttribute("hidden", "");
      prevBtn?.setAttribute("hidden", "");
      nextBtn?.setAttribute("hidden", "");
      document.removeEventListener("keydown", handleKeyDown);
    };

    const goNext = (countYes) => {
      if (module.classList.contains("pain-quiz__module--complete")) return;
      if (countYes) yesCount += 1;
      const nextIndex = currentIndex + 1;
      if (nextIndex >= total) {
        finishQuiz();
        return;
      }
      changeCard(nextIndex, 1);
    };

    const goPrev = () => {
      if (module.classList.contains("pain-quiz__module--complete")) return;
      if (currentIndex === 0) return;
      changeCard(currentIndex - 1, -1);
    };

    const handleKeyDown = (event) => {
      const activeTag = document.activeElement?.tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag || "")) return;
      if (module.classList.contains("pain-quiz__module--complete")) return;

      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        goNext(true);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext(false);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
    };

    yesBtn.addEventListener("click", () => goNext(true));
    skipBtn.addEventListener("click", () => goNext(false));
    nextBtn?.addEventListener("click", () => goNext(false));
    prevBtn?.addEventListener("click", () => goPrev());
    document.addEventListener("keydown", handleKeyDown);

    cardText.textContent = prompts[0];
    updateProgress();
  };

  document.querySelectorAll(".month-year-field").forEach((field) => initMonthYearField(field));
  initPainQuiz();
});
