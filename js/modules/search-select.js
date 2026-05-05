// Combobox-style search input: type to filter, click to commit. Used for
// universities and country codes. Country-code mode also sanitises input.

import { searchSources } from "../data/search-sources.js";

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

export const init = () => {
  document.querySelectorAll(".search-select").forEach((group) => {
    const source = group.dataset.searchSource;
    const options = source ? searchSources[source] : null;
    if (options?.length) {
      initSearchSelect(group, options);
    }
  });
};
