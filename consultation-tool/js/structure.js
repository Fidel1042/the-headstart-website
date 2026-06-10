const v = new URLSearchParams(location.search).get("v") || "0";
const { stages, getPersona, personas } = await import(`./data.js?v=${v}`);

const headEl = document.getElementById("structHead");
const listEl = document.getElementById("stageList");
const mentorCta = document.getElementById("mentorCta");

const currentId = new URLSearchParams(location.search).get("p") || personas[0].id;
const p = getPersona(currentId);

headEl.innerHTML = `
  <span class="struct-head__name">${p.name}</span>
  <span class="struct-head__count">Typically <strong>${p.sessions}</strong> to a successful outcome</span>`;

const stageBlocks = p.stages.map((n, i) => {
  const s = stages[n];
  const ov = p.sessionOverrides?.[n] || {};
  const items = (ov.sessions || s.sessions).map((t) => `<li>${t}</li>`).join("");
  return `
    <div class="stage">
      <div class="stage__num">${i + 1}</div>
      <div>
        <div class="stage__head">
          <span class="stage__name">${ov.name || s.name}</span>
          <span class="stage__count">${ov.sessionLabel || s.sessionLabel}</span>
        </div>
        <ul class="stage__sessions">${items}</ul>
      </div>
    </div>`;
});

listEl.innerHTML = stageBlocks.join(`<div class="stage-arrow">&#8595;</div>`);
if (mentorCta) mentorCta.href = `mentors.html?p=${p.id}&v=${v}`;
