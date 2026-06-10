const v = new URLSearchParams(location.search).get("v") || "0";
const { getMentor, mentors } = await import(`./mentors-data.js?v=${v}`);

const id = new URLSearchParams(location.search).get("m");
const m = getMentor(id) || mentors.find((x) => x.detailed);

document.title = `${m.name} — Headstart`;

const cardImg = document.getElementById("profileCardImg");
const bodyEl = document.getElementById("profileBody");

cardImg.src = m.detailPhoto || m.photo;
cardImg.alt = m.name;

const block = (label, text) =>
  text ? `<div class="profile-block"><p class="profile-block__label">${label}</p><p class="profile-block__text">${text}</p></div>` : "";

bodyEl.innerHTML = `
  <h2 class="profile-who">Who is ${m.name.split(" ")[0]}?</h2>
  <p class="profile-lead">${m.lead || ""}</p>
  ${block("Why I mentor", m.why)}
  ${block("What makes my mentoring different", m.different)}
  ${block("Best fit for", m.bestFor)}
  <div class="profile-ctas">
    <a class="btn btn--gold" href="pricing.html?v=${v}">Book with ${m.name.split(" ")[0]} &rarr;</a>
    <a class="btn" href="mentors.html?v=${v}">Back to all mentors</a>
  </div>`;
