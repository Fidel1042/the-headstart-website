// One-shot Chinese translation toggle on review cards. Once tapped the button
// disables itself, leaving the translated text in place.

export const init = () => {
  const cards = document.querySelectorAll(".review-column__card");
  if (!cards.length) return;

  cards.forEach((card) => {
    const quote = card.querySelector(".review-column__quote");
    const btn = card.querySelector("[data-review-translate]");
    if (!quote || !btn) return;

    const zh = quote.dataset.reviewZh;
    if (!zh) return;
    if (!quote.dataset.reviewEn) {
      quote.dataset.reviewEn = quote.textContent.trim();
    }

    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      quote.textContent = zh;
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
    });
  });
};
