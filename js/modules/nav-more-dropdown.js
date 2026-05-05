// Click toggle for the "More" nav dropdown so it works on touch/mobile where
// hover does not fire. Hover is still handled by CSS.

export const init = () => {
  const navMore = document.querySelector(".nav-more");
  if (!navMore) return;
  const trigger = navMore.querySelector(".nav-more__trigger");
  if (!trigger) return;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    navMore.classList.toggle("open");
  });
  document.addEventListener("click", () => navMore.classList.remove("open"));
};
