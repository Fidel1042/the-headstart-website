// Smooth-scroll to elements declared via data-scroll-to="<selector>".
// Adjusts for fixed nav height + a 24px breathing-room offset.

export const init = () => {
  document.querySelectorAll("[data-scroll-to]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      const target = btn.getAttribute("data-scroll-to");
      if (!target) return;
      const el = document.querySelector(target);
      if (!el) return;
      const navHeight = document.querySelector("header")?.offsetHeight || 80;
      const top = el.getBoundingClientRect().top + window.scrollY - navHeight - 24;
      window.scrollTo({ top, behavior: "smooth" });
    });
  });
};
