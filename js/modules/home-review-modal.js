// Home reviews preview: open a centered modal showing the full review text
// when the user clicks "Read whole review" on any card.

export function init() {
  const modal = document.getElementById("homeReviewModal");
  if (!modal) return;

  const backdrop = modal.querySelector(".review-modal__backdrop");
  const panel = modal.querySelector(".review-modal__panel");
  const closeBtn = modal.querySelector(".review-modal__close");
  const headlineEl = modal.querySelector(".review-modal__headline");
  const quoteEl = modal.querySelector(".review-modal__quote");
  const avatarEl = modal.querySelector(".review-modal__avatar");
  const nameEl = modal.querySelector(".review-modal__name");
  const tagEl = modal.querySelector(".review-modal__tag");

  function open(card) {
    headlineEl.textContent = card.dataset.headline || "";
    quoteEl.textContent = card.dataset.quote || "";
    avatarEl.style.backgroundImage = card.dataset.avatar ? `url('${card.dataset.avatar}')` : "";
    nameEl.textContent = card.dataset.name || "";
    tagEl.textContent = card.dataset.tag || "";
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }

  function close() {
    modal.classList.remove("is-open");
    document.body.style.overflow = "";
  }

  document.querySelectorAll(".home-review-card__open-btn").forEach(btn => {
    btn.addEventListener("click", function(e) {
      e.preventDefault();
      const card = this.closest(".home-review-card");
      if (card) open(card);
    });
  });

  backdrop?.addEventListener("click", close);
  closeBtn?.addEventListener("click", close);
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape" && modal.classList.contains("is-open")) close();
  });
}
