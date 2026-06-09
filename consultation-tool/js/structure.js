import { personas, stages, getPersona } from "./data.js";

const switchEl = document.getElementById("personaSwitch");
const headEl = document.getElementById("structHead");
const listEl = document.getElementById("stageList");
const mentorCta = document.getElementById("mentorCta");

let currentId = new URLSearchParams(location.search).get("p") || personas[0].id;

// Persona switcher tabs so Fidel can flip live during a call.
switchEl.innerHTML = personas
  .map((p) => `<button class="persona-switch__btn" data-id="${p.id}" type="button">${p.name}</button>`)
  .join("");

function render(id) {
  const p = getPersona(id);
  currentId = p.id;

  switchEl.querySelectorAll(".persona-switch__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.id === p.id)
  );

  headEl.innerHTML = `
    <span class="struct-head__name">${p.name}</span>
    <span class="struct-head__count">Typically <strong>${p.sessions}</strong> to a successful outcome</span>`;

  listEl.innerHTML = p.stages
    .map((n) => {
      const s = stages[n];
      const items = s.sessions.map((t) => `<li>${t}</li>`).join("");
      return `
        <div class="stage">
          <div class="stage__num">${n}</div>
          <div>
            <div class="stage__head">
              <span class="stage__name">${s.name}</span>
              <span class="stage__count">${s.sessionLabel}</span>
            </div>
            <ul class="stage__sessions">${items}</ul>
          </div>
        </div>`;
    })
    .join("");

  mentorCta.href = `mentors.html?p=${p.id}`;
  history.replaceState(null, "", `structure.html?p=${p.id}`);
}

switchEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".persona-switch__btn");
  if (btn) render(btn.dataset.id);
});

render(currentId);
