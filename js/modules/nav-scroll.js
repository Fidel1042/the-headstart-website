// Adds .shrunk to the nav once the user has scrolled even slightly.

export const init = () => {
  const nav = document.querySelector(".nav");
  if (!nav) return;

  const shrinkNav = () => {
    nav.classList.toggle("shrunk", window.scrollY > 8);
  };
  window.addEventListener("scroll", shrinkNav);
  shrinkNav();
};
