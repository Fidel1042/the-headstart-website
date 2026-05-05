// Page-by-page horizontal scroller for the reviews carousel.

export const init = () => {
  const scroller = document.querySelector(".review-column__scroller");
  if (!scroller) return;
  const prevBtn = document.querySelector("[data-review-prev]");
  const nextBtn = document.querySelector("[data-review-next]");
  if (!prevBtn && !nextBtn) return;

  const scrollByPage = (direction) => {
    const amount = scroller.clientWidth;
    scroller.scrollBy({ left: amount * direction, behavior: "smooth" });
  };

  prevBtn?.addEventListener("click", () => scrollByPage(-1));
  nextBtn?.addEventListener("click", () => scrollByPage(1));
};
