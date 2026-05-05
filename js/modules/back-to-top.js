// Back-to-top floating button: visible after scrolling 200px, smooth-scrolls up.

export const init = () => {
  const backToTop = document.querySelector(".back-to-top");
  if (!backToTop) return;

  window.addEventListener("scroll", () => {
    backToTop.classList.toggle("visible", window.scrollY > 200);
  });
  backToTop.addEventListener("click", () =>
    window.scrollTo({ top: 0, behavior: "smooth" })
  );
};
