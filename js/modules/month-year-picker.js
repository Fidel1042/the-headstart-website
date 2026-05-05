// Month + year picker dropdown. Builds two lists, commits to the input as
// "Month YYYY" once both are chosen.

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
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

export const init = () => {
  document.querySelectorAll(".month-year-field").forEach(initMonthYearField);
};
