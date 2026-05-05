// Auto-fills the current year wherever <span id="year"> is rendered (footer).

export const init = () => {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();
};
