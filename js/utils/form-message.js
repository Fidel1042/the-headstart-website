// Lightweight toast for form validation errors. Lazily creates the panel.

let timeoutId;

export const showFormMessage = (message) => {
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
