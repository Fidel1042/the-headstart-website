// Service add-on checkboxes: when ticked, reveal the matching textarea/option
// block, set required, and clear value on uncheck.

export const init = () => {
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
};
