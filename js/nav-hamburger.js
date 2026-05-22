// Shared mobile hamburger nav toggle
(function () {
  var navToggle = document.getElementById("navToggle");
  var navLinks  = document.getElementById("navLinks");
  if (!navToggle || !navLinks) return;

  navToggle.addEventListener("click", function () {
    var isOpen = navLinks.classList.toggle("is-open");
    navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  // Close when clicking any link inside the dropdown
  navLinks.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      navLinks.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    });
  });

  // Close when clicking outside the nav
  document.addEventListener("click", function (e) {
    if (!navLinks.classList.contains("is-open")) return;
    if (e.target.closest("#navLinks") || e.target.closest("#navToggle")) return;
    navLinks.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
  });

  // Close on Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && navLinks.classList.contains("is-open")) {
      navLinks.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  });
})();
