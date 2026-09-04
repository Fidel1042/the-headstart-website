// ROI calculator: pure arithmetic on the mentee's own numbers.
// Investment uses live pricing: a $55 trial session, then $70 for every
// session after it. The five-session prepay was retired in August 2026.
//
// The gain is the difference between what they'd take home in the graduate
// role and what they take home in their current part-time job, so the number
// survives a prospect asking "but I'm already earning something".

const TRIAL_RATE = 55;
const ONGOING_RATE = 70;
const WEEKS_PER_YEAR = 52;

// Australian resident income tax, 2025-26 rates. No Medicare levy, no offsets.
// Re-check these each 1 July.
function taxOn(income) {
  if (income <= 18200) return 0;
  if (income <= 45000) return (income - 18200) * 0.16;
  if (income <= 135000) return 4288 + (income - 45000) * 0.30;
  if (income <= 190000) return 31288 + (income - 135000) * 0.37;
  return 51638 + (income - 190000) * 0.45;
}

const takeHome = (income) => income - taxOn(income);
const money = (n) => "$" + Math.round(n).toLocaleString("en-AU");

// Trial is charged once, on the first session only.
function investmentFor(sessions) {
  if (sessions <= 0) return 0;
  return TRIAL_RATE + (sessions - 1) * ONGOING_RATE;
}

function investmentBreakdown(sessions) {
  if (sessions <= 0) return "";
  if (sessions === 1) return `${money(TRIAL_RATE)} trial`;
  return `${money(TRIAL_RATE)} trial + ${sessions - 1} x ${money(ONGOING_RATE)}`;
}

function fillRange(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--fill", pct + "%");
}

function payback(investment, perMonth) {
  if (perMonth <= 0) return "No uplift at these numbers.";
  const days = investment / (perMonth / 30);
  if (days < 1) return "Covered in under a day of earning.";
  const d = Math.round(days);
  return `Covered after about ${d} day${d === 1 ? "" : "s"} of earning.`;
}

function render(els) {
  const salary = +els.salary.value;
  const months = +els.months.value;
  const sessions = +els.sessions.value;
  const ptHours = +els.ptHours.value;
  const ptRate = +els.ptRate.value;

  const ptSalary = ptHours * ptRate * WEEKS_PER_YEAR;
  const investment = investmentFor(sessions);

  // What they actually gain is the uplift over the job they already have.
  const upliftPerMonth = Math.max(0, (takeHome(salary) - takeHome(ptSalary)) / 12);
  const gained = upliftPerMonth * months;
  const net = gained - investment;
  const roi = investment > 0 ? gained / investment : 0;

  els.salaryVal.textContent = money(salary);
  els.monthsVal.textContent = months + (months === 1 ? " month" : " months");
  els.sessionsVal.textContent = sessions + (sessions === 1 ? " session" : " sessions");
  els.ptHoursVal.textContent = ptHours + (ptHours === 1 ? " hour" : " hours");
  els.ptRateVal.textContent = money(ptRate) + " / hr";

  els.investVal.textContent = "-" + money(investment);
  els.investSub.textContent = investmentBreakdown(sessions);
  els.gainedLabel.textContent = `Take-home gained (${months} ${months === 1 ? "month" : "months"})`;
  els.gainedVal.textContent = "+" + money(gained);
  els.netVal.textContent = money(net);
  els.returnVal.textContent = Math.round(roi) + "x";
  els.note.textContent = payback(investment, upliftPerMonth);

  [els.salary, els.months, els.sessions, els.ptHours, els.ptRate].forEach(fillRange);
}

function init() {
  const $ = (id) => document.getElementById(id);
  const els = {
    salary: $("roiSalary"), months: $("roiMonths"), sessions: $("roiSessions"),
    ptHours: $("roiPtHours"), ptRate: $("roiPtRate"),
    salaryVal: $("roiSalaryVal"), monthsVal: $("roiMonthsVal"), sessionsVal: $("roiSessionsVal"),
    ptHoursVal: $("roiPtHoursVal"), ptRateVal: $("roiPtRateVal"),
    investVal: $("roiInvestVal"), investSub: $("roiInvestSub"),
    gainedLabel: $("roiGainedLabel"), gainedVal: $("roiGainedVal"),
    netVal: $("roiNetVal"), returnVal: $("roiReturnVal"), note: $("roiNote"),
  };
  if (!els.salary) return;
  ["salary", "months", "sessions", "ptHours", "ptRate"].forEach((k) =>
    els[k].addEventListener("input", () => render(els))
  );
  render(els);
}

document.addEventListener("DOMContentLoaded", init);
