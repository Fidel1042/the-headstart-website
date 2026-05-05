// Multi-step form controller: step navigation, per-step validation, conditional
// fields driven by data-study-level-field.

import { showFormMessage } from "../utils/form-message.js";

const initSingleForm = (form) => {
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

  wireStudyLevelConditionals(form);
};

const wireStudyLevelConditionals = (form) => {
  const studyLevelRadios = form.querySelectorAll('input[name="study_level"]');
  const conditionalFields = form.querySelectorAll("[data-study-level-field]");
  if (!studyLevelRadios.length || !conditionalFields.length) return;

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
};

export const init = () => {
  document.querySelectorAll(".multi-step").forEach(initSingleForm);
};
