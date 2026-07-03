const v = new URLSearchParams(location.search).get("v") || "0";
const { mentors } = await import(`./mentors-data.js?v=${v}`);

const input = document.getElementById("mentorSearch");
const results = document.getElementById("mentorResults");

const pinned = mentors.find((m) => m.pinned);
const others = mentors.filter((m) => !m.pinned);

const STORAGE_KEY = "hs_ct_shortlist";
const shortlist = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));

function initials(name) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function searchText(m) {
  return [m.tags.join(" "), m.industry, m.degree, m.role, m.company].join(" ").toLowerCase();
}
function photo(m) {
  if (m.photo) {
    return `<div class="mentor-new-card__photo">
      <img src="${m.photo}" alt="${m.name}"
        onerror="this.parentNode.innerHTML='<span>${initials(m.name)}</span>';this.parentNode.classList.add('mentor-new-card__photo--initials')" />
    </div>`;
  }
  return `<div class="mentor-new-card__photo mentor-new-card__photo--initials"><span>${initials(m.name)}</span></div>`;
}
function ctaLink(m) {
  return m.detailed
    ? `<a class="mentor-new-card__cta" href="mentor-profile.html?m=${m.id}&v=${v}">View full profile &rarr;</a>`
    : `<a class="mentor-new-card__cta mentor-new-card__cta--muted" href="#" data-soon="${m.name}">Profile coming soon</a>`;
}
function card(m) {
  const isAdded = shortlist.has(m.id);
  const atMax = shortlist.size >= 2;
  const addBtn = m.pinned ? "" : `
    <button class="mentor-add-btn${isAdded ? " is-added" : ""}${!isAdded && atMax ? " is-disabled" : ""}"
      data-id="${m.id}" title="${isAdded ? "Remove" : atMax ? "Max 2 reached" : "Add"}">
      ${isAdded ? "✓" : "+"}
    </button>`;
  const logos = m.logos && m.logos.length
    ? `<div class="mentor-new-card__logos">${m.logos.slice(0, 3).map((l) => `<img src="${l.src}" alt="${l.alt}" onerror="this.style.display='none'" />`).join("")}</div>`
    : `<div class="mentor-new-card__logos"></div>`;
  const specItems = (m.specialiseIn && m.specialiseIn.length) ? m.specialiseIn : (m.industry ? [m.industry] : []);
  const expertise = specItems.length
    ? `<div class="mentor-new-card__expertise">${specItems.map((s) => `<span class="mentor-spec-tag">${s}</span>`).join("")}</div>`
    : `<div class="mentor-new-card__expertise"></div>`;
  return `
    <article class="mentor-new-card${m.pinned ? " mentor-new-card--pinned" : ""}">
      <div class="mentor-new-card__inner">
        ${photo(m)}
        <div class="mentor-new-card__info">
          <h3 class="mentor-new-card__name">${m.name}</h3>
          <p class="mentor-new-card__role">${m.role}</p>
        </div>
        ${logos}
        ${expertise}
        ${ctaLink(m)}
      </div>
      ${addBtn}
    </article>`;
}

function render(query) {
  const q = query.trim().toLowerCase();
  const shortlisted = [...shortlist].map((id) => mentors.find((m) => m.id === id)).filter(Boolean);
  const recommended = [pinned, ...shortlisted];
  const remaining = others.filter((m) => !shortlist.has(m.id));

  let html = `<div class="mentor-recommend-grid">${recommended.map(card).join("")}</div>`;

  if (!q) {
    html += `<div class="mentor-new-grid mentor-all-grid">${remaining.map(card).join("")}</div>`;
  } else {
    const matches = remaining.filter((m) => searchText(m).includes(q));
    html += `<p class="mentor-group-label">Matches for "${query.trim()}"</p>`;
    html += matches.length
      ? `<div class="mentor-new-grid">${matches.map(card).join("")}</div>`
      : `<div class="mentor-empty">No other mentors tagged "${query.trim()}" yet.</div>`;
  }

  results.innerHTML = html;
}

function saveShortlist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...shortlist]));
}

function toggleShortlist(id) {
  if (shortlist.has(id)) {
    shortlist.delete(id);
  } else {
    if (shortlist.size >= 2) return;
    shortlist.add(id);
  }
  saveShortlist();
  render(input.value);
}

input.addEventListener("input", (e) => render(e.target.value));

results.addEventListener("click", (e) => {
  const addBtn = e.target.closest(".mentor-add-btn");
  if (addBtn && !addBtn.classList.contains("is-disabled")) { toggleShortlist(addBtn.dataset.id); return; }
  const soon = e.target.closest("[data-soon]");
  if (soon) { e.preventDefault(); alert(`${soon.dataset.soon}'s full profile is coming soon.`); }
});

render("");
