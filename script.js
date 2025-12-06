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
  };

  // Multi-step forms
  document.querySelectorAll(".multi-step").forEach((form) => {
    const steps = Array.from(form.querySelectorAll(".form-step"));
    if (!steps.length) return;
    let current = 0;

    const showStep = (index) => {
      steps.forEach((step, i) => {
        step.classList.toggle("is-active", i === index);
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
        const boxes = Array.from(group.querySelectorAll('input[type=\"checkbox\"]'));
        if (boxes.length && !boxes.some((box) => box.checked)) {
          alert("Please select at least one option.");
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
  });

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

  document.querySelectorAll(".month-year-field").forEach((field) => initMonthYearField(field));
});
