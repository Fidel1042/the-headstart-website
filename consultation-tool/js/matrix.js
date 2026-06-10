const v = new URLSearchParams(location.search).get("v") || "0";
const { personas } = await import(`./data.js?v=${v}`);

const grid = document.getElementById("matrix");
const hint = document.getElementById("matrixHint");

function boxMarkup(p, _index) {
  return `
    <button class="persona-box" data-id="${p.id}" type="button">
      <span class="persona-box__title">${p.name}</span>
      <span class="persona-box__tag">${p.tag}</span>
      <div class="persona-box__detail">
        <p class="persona-box__desc">${p.desc}</p>
        <div class="persona-box__stat">
          <span class="persona-box__stat-num">${p.sessions}</span>
          <span class="persona-box__stat-label">avg. sessions to an offer</span>
        </div>
        <div class="persona-box__ctas">
          <a class="btn btn--gold" href="structure.html?p=${p.id}&v=${v}">See session structure &rarr;</a>
          <a class="btn" href="mentors.html?p=${p.id}&v=${v}">Recommended mentor</a>
        </div>
      </div>
    </button>`;
}

grid.innerHTML = personas.map(boxMarkup).join("");

grid.addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const box = e.target.closest(".persona-box");
  if (!box) return;
  const alreadySelected = box.classList.contains("is-selected");
  grid.querySelectorAll(".persona-box").forEach((b) => b.classList.remove("is-selected"));
  if (alreadySelected) {
    grid.classList.remove("has-selection");
    if (hint) hint.style.opacity = "";
  } else {
    box.classList.add("is-selected");
    grid.classList.add("has-selection");
    if (hint) hint.style.opacity = "0";
  }
});

const preselect = new URLSearchParams(location.search).get("p");
if (preselect) {
  const target = grid.querySelector(`.persona-box[data-id="${preselect}"]`);
  if (target) {
    target.classList.add("is-selected");
    grid.classList.add("has-selection");
    if (hint) hint.style.opacity = "0";
  }
}
