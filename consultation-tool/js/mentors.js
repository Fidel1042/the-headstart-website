import { mentors } from "./mentors-data.js";

const input = document.getElementById("mentorSearch");
const results = document.getElementById("mentorResults");
const hint = document.getElementById("searchHint");

const pinned = mentors.find((m) => m.pinned);
const others = mentors.filter((m) => !m.pinned);

function initials(name) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

function searchText(m) {
  return [m.tags.join(" "), m.industry, m.degree, m.role, m.company].join(" ").toLowerCase();
}

function avatar(m) {
  if (m.photo) {
    return `<div class="mentor-card__avatar mentor-card__avatar--photo">
      <img src="${m.photo}" alt="${m.name}" onerror="this.parentNode.textContent='${initials(m.name)}';this.parentNode.classList.remove('mentor-card__avatar--photo')" />
    </div>`;
  }
  return `<div class="mentor-card__avatar">${initials(m.name)}</div>`;
}

function cta(m) {
  if (m.detailed) {
    return `<a class="btn btn--ghost mentor-card__cta" href="mentor-profile.html?m=${m.id}">View full profile &rarr;</a>`;
  }
  return `<a class="btn btn--ghost mentor-card__cta" href="#" data-soon="${m.name}">Profile coming soon</a>`;
}

function card(m) {
  const tags = m.tags.slice(0, 4).map((t) => `<span class="mentor-card__tag">${t}</span>`).join("");
  const meta = [m.uni, m.degree].filter(Boolean).join(" · ");
  return `
    <article class="mentor-card${m.pinned ? " mentor-card--pinned" : ""}">
      <div class="mentor-card__top">
        ${avatar(m)}
        <div>
          <div class="mentor-card__name">${m.name}</div>
          ${m.pinned ? '<span class="mentor-card__pin">★ Default recommendation</span>' : `<span class="mentor-card__pin mentor-card__pin--muted">${m.intl}</span>`}
        </div>
      </div>
      <p class="mentor-card__role">${m.role}${m.company ? ` — ${m.company}` : ""}</p>
      <p class="mentor-card__meta">${meta || "&nbsp;"}</p>
      <div class="mentor-card__tags">${tags}</div>
      <p class="mentor-card__best">${m.bestFor}</p>
      ${cta(m)}
    </article>`;
}

function grid(list) {
  return `<div class="mentor-grid">${list.map(card).join("")}</div>`;
}

function render(query) {
  const q = query.trim().toLowerCase();

  if (!q) {
    hint.textContent = "Showing all mentors. Start typing to narrow by major.";
    results.innerHTML =
      `<p class="mentor-group-label">Default recommendation</p>${grid([pinned])}` +
      `<p class="mentor-group-label">All mentors</p>${grid(others)}`;
    return;
  }

  const matches = others.filter((m) => searchText(m).includes(q));
  hint.textContent = `${matches.length} mentor${matches.length === 1 ? "" : "s"} match "${query.trim()}". Fidel stays pinned as the default.`;

  let html = `<p class="mentor-group-label">Default recommendation</p>${grid([pinned])}`;
  html += `<p class="mentor-group-label">Matches for "${query.trim()}"</p>`;
  html += matches.length
    ? grid(matches)
    : `<div class="mentor-empty">No other mentors tagged "${query.trim()}" yet. Fidel above is still a great fit, and more mentors are being added.</div>`;
  results.innerHTML = html;
}

input.addEventListener("input", (e) => render(e.target.value));

results.addEventListener("click", (e) => {
  const soon = e.target.closest("[data-soon]");
  if (soon) {
    e.preventDefault();
    alert(`${soon.dataset.soon}'s full profile is coming soon.`);
  }
});

render("");
