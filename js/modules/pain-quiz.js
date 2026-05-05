// "Pain points" quiz on the home page. Six prompts, yes/no answers, animated
// progress + results bar, then an archetype reveal at the end.

import { routeHref } from "../utils/route-resolver.js";

const prompts = [
  "Re-recording digital interviews again and again because they still don't feel right.",
  "Auto-rejected because of visa status even though the grad role is clearly in reach.",
  "Being told multiple internships are needed to stand out but you can't even land the first one.",
  "Feeling like being an introvert means you'll never stand out in assessment centres.",
  "You have no clue how to impress the professionals even after finally landing a coffee chat.",
  "Applying for part-time jobs with 600+ applicants and wondering how you're supposed to gain ANY experience for an internship.",
];
const peerPct = [82, 74, 78, 65, 58, 71];
const liveCounts = [2143, 1742, 1517, 1204, 938, 876];
const yesLines = [
  "Imagine having someone who has done those exact interviews and landed the role, teaching you how to do the same.",
  "We understand the system is unfair to international students. Our mentors were once one of them.",
  "1 warm opportunity beats 20 cold applications. We teach you how to actually build those connections.",
  "Most introverts who landed roles stopped trying to act extroverted and leaned into their strengths.",
  "We help you go into coffee chats with the right questions and leave with an actual follow-up plan.",
  "We help you find one real opportunity that can actually be used to build your experience.",
];
const noLines = [
  "You're ahead of most. A lot of students waste weeks on this before realising what's actually being assessed.",
  "You've already removed one barrier that stops 40% of candidates before they even apply.",
  "If you've already landed one, you're in the top 20% of applicants. The question now is how to convert it into a better internship or grad role.",
  "That's a real advantage. A lot of people mistake confidence for preparation, and lose for it.",
  "Nice. Most people leave coffee chats with nothing concrete to follow up on.",
  "Smart move skipping that queue. Most students lose months there before finding a better path.",
];
const archetypes = [
  { type: "The Early Mover",            desc: "None of these hit you, which puts you ahead of most. The students who land early aren't always better prepared. They just act on strategy before the competition heats up." },
  { type: "The 95% Candidate",          desc: "One thing is quietly costing you. That is often all it takes to miss a role that would have been yours. One focused session usually finds it fast." },
  { type: "The Quiet Grinder",          desc: "You're putting in the work. But effort without the right feedback doesn't compound. A session with someone who cracked it recently redirects that energy." },
  { type: "The Overthinking Applicant", desc: "You can see the gap but you're not sure what to fix first. That loop is expensive. One session with someone who has been there recently ends it." },
  { type: "The System Fighter",         desc: "The deck is stacked against you in more than one way. There is a path through it, but it is not the one advertised on university career pages." },
  { type: "The Invisible Candidate",    desc: "Everything looks right from the outside but nothing is landing. The gap is usually invisible until someone who has done the same interviews recently points it out." },
  { type: "The Deep End",               desc: "You are navigating the full weight of what international students face. This is not a tips list problem. It is exactly what 1-on-1 mentoring was built for." },
];

const burst = (originEl) => {
  if (typeof gsap === "undefined") return;
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  for (let i = 0; i < 18; i++) {
    const p = document.createElement("div");
    const size = 6 + Math.random() * 8;
    p.style.cssText = `position:fixed;width:${size}px;height:${size}px;border-radius:50%;background:#c9a84c;left:${cx}px;top:${cy}px;pointer-events:none;z-index:9999;transform:translate(-50%,-50%);`;
    document.body.appendChild(p);
    const angle = (Math.PI * 2 / 18) * i + Math.random() * 0.3;
    const dist = 60 + Math.random() * 100;
    gsap.fromTo(p,
      { x: 0, y: 0, opacity: 1, scale: 1 },
      { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, opacity: 0, scale: 0.1,
        duration: 0.6 + Math.random() * 0.25, ease: "power2.out", onComplete: () => p.remove() }
    );
  }
};

const bounceBtn = (btn) => {
  if (typeof gsap === "undefined") return;
  gsap.timeline()
    .to(btn, { scale: 0.88, duration: 0.09, ease: "power2.in" })
    .to(btn, { scale: 1, duration: 0.4, ease: "back.out(3.5)" });
};

const countUp = (el, target) => {
  if (!el || typeof gsap === "undefined") return;
  const obj = { val: 0 };
  gsap.to(obj, { val: target, duration: 0.95, ease: "power2.out",
    onUpdate: () => { el.textContent = Math.round(obj.val) + "%"; }
  });
};

export const init = () => {
  const section = document.getElementById("pain-points-quiz");
  if (!section) return;
  const module = section.querySelector(".pain-quiz__module");
  if (!module) return;

  const card      = module.querySelector("[data-quiz-card]");
  const cardText  = module.querySelector("[data-quiz-card-text]");
  const qNum      = module.querySelector("[data-quiz-num]");
  const liveCount = module.querySelector("[data-quiz-live-count]");
  const yesBtn    = module.querySelector("[data-quiz-yes]");
  const noBtn     = module.querySelector("[data-quiz-no]");
  const actions   = module.querySelector("[data-quiz-actions]");
  const barsEl    = module.querySelector("[data-quiz-bars]");
  const yesPct    = module.querySelector("[data-quiz-yes-pct]");
  const noPct     = module.querySelector("[data-quiz-no-pct]");
  const yesBar    = module.querySelector("[data-quiz-yes-bar]");
  const noBar     = module.querySelector("[data-quiz-no-bar]");
  const peerLine  = module.querySelector("[data-quiz-peer-line]");
  const nextBtn   = module.querySelector("[data-quiz-next]");
  const pipsWrap  = module.querySelector("[data-quiz-pips]");
  if (!card || !cardText || !yesBtn || !noBtn) return;

  let cur = 0, yesCount = 0;
  const navCta = document.querySelector(".nav-cta--gold");
  const freeCallHref = navCta?.getAttribute("href") || routeHref("/discovery-call");

  const pipFills = prompts.map(() => {
    const pip = document.createElement("div");
    pip.className = "pain-quiz__pip";
    const fill = document.createElement("div");
    fill.className = "pain-quiz__pip-fill";
    pip.appendChild(fill);
    pipsWrap?.appendChild(pip);
    return fill;
  });

  const pulsePip = (index) => {
    const fill = pipFills[index];
    if (!fill || typeof gsap === "undefined") return;
    gsap.timeline()
      .to(fill, { width: "100%", duration: 0.4, ease: "power2.inOut" })
      .to(fill, { boxShadow: "0 0 10px #c9a84c, 0 0 22px rgba(201,168,76,0.45)", duration: 0.18 })
      .to(fill, { boxShadow: "none", duration: 0.4 });
  };

  const load = () => {
    if (qNum)      qNum.textContent      = `Question ${cur + 1} of ${prompts.length}`;
    if (cardText)  cardText.textContent  = prompts[cur];
    if (liveCount) liveCount.textContent = `${liveCounts[cur].toLocaleString()} students have answered this`;
    if (actions) actions.style.display = "";
    if (barsEl)  barsEl.style.display  = "none";
    if (yesBar)  yesBar.style.width    = "0%";
    if (noBar)   noBar.style.width     = "0%";
    if (yesPct)  yesPct.textContent    = "0%";
    if (noPct)   noPct.textContent     = "0%";
  };

  const vote = (isYes) => {
    const btn = isYes ? yesBtn : noBtn;
    bounceBtn(btn);
    if (isYes) { yesCount++; setTimeout(() => burst(btn), 90); }
    pulsePip(cur);

    setTimeout(() => {
      if (actions) actions.style.display = "none";
      if (barsEl)  barsEl.style.display  = "";
      if (typeof gsap !== "undefined") {
        gsap.fromTo(barsEl, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3 });
      }
      const yp = peerPct[cur], np = 100 - yp;
      setTimeout(() => {
        if (yesBar) yesBar.style.width = yp + "%";
        if (noBar)  noBar.style.width  = np + "%";
        countUp(yesPct, yp);
        countUp(noPct,  np);
      }, 80);
      if (peerLine) {
        peerLine.innerHTML = isYes
          ? `<strong>${yp}% felt the same.</strong> ${yesLines[cur]}`
          : `<strong>You're in the ${np}% who don't.</strong> ${noLines[cur]}`;
      }
    }, 300);
  };

  const advance = () => {
    if (typeof gsap !== "undefined") {
      gsap.to(card, { opacity: 0, y: -14, duration: 0.25, ease: "power2.in", onComplete: () => {
        cur++;
        if (cur >= prompts.length) showResult();
        else { load(); gsap.fromTo(card, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.32, ease: "power2.out" }); }
      }});
    } else {
      cur++;
      if (cur >= prompts.length) showResult(); else load();
    }
  };

  const showResult = () => {
    module.classList.add("pain-quiz__module--complete");
    if (actions)  actions.style.display  = "none";
    if (barsEl)   barsEl.style.display   = "none";
    if (pipsWrap) pipsWrap.style.display = "none";
    card.classList.add("pain-quiz__card--result");
    const a = archetypes[Math.min(yesCount, archetypes.length - 1)];
    const callLink = `<a class="gradient-link gold-link" href="${freeCallHref}">book a free call</a>`;
    cardText.innerHTML = `<strong class="pain-quiz__archetype-type">${a.type}</strong><span class="pain-quiz__archetype-desc">${a.desc}</span><span class="pain-quiz__archetype-cta">Ready to change that? ${callLink}.</span>`;
    if (typeof gsap !== "undefined") {
      gsap.fromTo(card,
        { scale: 0.9, opacity: 0 },
        { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(1.6)", clearProps: "transform,opacity" }
      );
    }
  };

  yesBtn.addEventListener("click", () => vote(true));
  noBtn.addEventListener("click",  () => vote(false));
  nextBtn?.addEventListener("click", advance);

  load();
};
