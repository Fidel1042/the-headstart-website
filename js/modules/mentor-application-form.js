// Mentor application form: trim text fields on submit and re-block invalid
// submissions (browser validation runs after our trim).

export const init = () => {
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
};
