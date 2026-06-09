import { getMentor, mentors } from "./mentors-data.js";

const id = new URLSearchParams(location.search).get("m");
const m = getMentor(id) || mentors.find((x) => x.detailed);

const cardEl = document.getElementById("idCard");
const bodyEl = document.getElementById("profileBody");

document.title = `${m.name} — Headstart`;

const logos = m.logos
  .map((l) => `<img src="${l.src}" alt="${l.alt}" onerror="this.style.display='none'" />`)
  .join("");

const field = (label, value) =>
  value ? `<li><strong>${label}:</strong> ${value}</li>` : "";

cardEl.innerHTML = `
  ${logos ? `<div class="id-card__logos">${logos}</div>` : ""}
  <div class="id-card__photo">
    <img src="${m.photo}" alt="${m.name}" />
  </div>
  <p class="id-card__spec-label">SPECIALISE IN:</p>
  <p class="id-card__spec">${m.specialiseIn.join(" &nbsp;|&nbsp; ")}</p>
  <ul class="id-card__fields">
    ${field("Name", m.name)}
    ${field("Current Role", m.role)}
    ${field("University", m.uni)}
    ${field("Degree", m.degree)}
    ${field("Major", m.major)}
    ${field("Visa", m.visa)}
    ${field("Graduated year", m.gradYear)}
  </ul>`;

const block = (label, text) =>
  text ? `<div class="profile-block"><p class="profile-block__label">${label}</p><p class="profile-block__text">${text}</p></div>` : "";

bodyEl.innerHTML = `
  <span class="profile-intl">${m.intl} mentor</span>
  <p class="profile-lead">${m.lead || ""}</p>
  ${block("Why I mentor", m.why)}
  ${block("What makes my mentoring different", m.different)}
  ${block("Best fit for", m.bestFor)}
  <div class="profile-ctas">
    <a class="btn btn--gold" href="pricing.html">Book with ${m.name.split(" ")[0]} &rarr;</a>
    <a class="btn" href="mentors.html">Back to all mentors</a>
  </div>`;
