// Mentor directory: type filter buttons + free-text search + result count.

export const init = () => {
  const filterBtns = document.querySelectorAll("[data-filter]");
  const mentorCards = document.querySelectorAll("[data-mentor-type]");
  const searchInput = document.querySelector("[data-mentor-search]");
  const resetFilters = document.querySelector("[data-mentor-reset]");
  const resultCount = document.querySelector("[data-mentor-count]");
  if (!mentorCards.length) return;

  let activeType = "all";

  const applyMentorFilters = () => {
    const query = (searchInput?.value || "").trim().toLowerCase();
    let visible = 0;

    mentorCards.forEach((card) => {
      const matchesType =
        activeType === "all" || card.dataset.mentorType === activeType;
      const haystack = (
        card.dataset.mentorFocus || card.textContent || ""
      ).toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const show = matchesType && matchesQuery;
      card.style.display = show ? "" : "none";
      if (show) visible += 1;
    });

    if (resultCount) {
      resultCount.textContent = `${visible} result${visible === 1 ? "" : "s"}`;
    }
  };

  filterBtns.forEach((btn) =>
    btn.addEventListener("click", () => {
      activeType = btn.dataset.filter || "all";
      filterBtns.forEach((b) => b.classList.toggle("active", b === btn));
      applyMentorFilters();
    })
  );

  searchInput?.addEventListener("input", () => applyMentorFilters());

  resetFilters?.addEventListener("click", () => {
    activeType = "all";
    filterBtns.forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));
    if (searchInput) searchInput.value = "";
    applyMentorFilters();
  });

  applyMentorFilters();
};
