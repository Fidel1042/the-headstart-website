// "Show details" toggle on service cards (services page).

export const init = () => {
  document.querySelectorAll("[data-toggle='service-more']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const more = card?.querySelector(".card-more");
      const open = more?.classList.toggle("show");
      if (open !== undefined) {
        btn.textContent = open ? "Show less" : "Show details";
      }
    });
  });
};
