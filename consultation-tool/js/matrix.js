import { personas } from "./data.js";

const grid = document.getElementById("matrix");

function boxMarkup(p, index) {
  return `
    <button class="persona-box" data-id="${p.id}" type="button">
      <span class="persona-box__num">Persona ${index + 1}</span>
      <span class="persona-box__title">${p.name}</span>
      <span class="persona-box__tag">${p.tag}</span>
      <div class="persona-box__detail">
        <p class="persona-box__desc">${p.desc}</p>
        <div class="persona-box__stat">
          <span class="persona-box__stat-num">${p.sessions}</span>
          <span class="persona-box__stat-label">average to a successful outcome</span>
        </div>
        <div class="persona-box__ctas">
          <a class="btn btn--gold" href="structure.html?p=${p.id}">See how sessions are structured &rarr;</a>
          <a class="btn" href="mentors.html?p=${p.id}">Recommended tutor</a>
        </div>
      </div>
    </button>`;
}

grid.innerHTML = personas.map(boxMarkup).join("");

grid.addEventListener("click", (e) => {
  const box = e.target.closest(".persona-box");
  if (!box) return;
  // Clicking a CTA link inside a selected box should navigate, not re-toggle.
  if (e.target.closest("a")) return;

  const alreadySelected = box.classList.contains("is-selected");
  grid.querySelectorAll(".persona-box").forEach((b) => b.classList.remove("is-selected"));
  if (!alreadySelected) box.classList.add("is-selected");
});

// If arriving with ?p=, pre-select that persona (e.g. coming back from another screen).
const preselect = new URLSearchParams(location.search).get("p");
if (preselect) {
  const target = grid.querySelector(`.persona-box[data-id="${preselect}"]`);
  if (target) target.classList.add("is-selected");
}
