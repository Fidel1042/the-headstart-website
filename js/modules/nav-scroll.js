// Adds .shrunk to the nav once the user has scrolled even slightly.
// Also offsets body padding-top to match the fixed header height.

export const init = () => {
  const nav = document.querySelector(".nav");
  const header = document.querySelector("body > header");
  if (!nav) return;

  const setOffset = () => {
    if (header) document.body.style.paddingTop = header.offsetHeight + "px";
  };

  const shrinkNav = () => {
    nav.classList.toggle("shrunk", window.scrollY > 8);
  };

  setOffset();
  window.addEventListener("resize", setOffset);
  window.addEventListener("scroll", shrinkNav);
  shrinkNav();
};
