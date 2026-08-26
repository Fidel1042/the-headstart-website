// ROI calculator — pure arithmetic on the mentee's own numbers.
// Investment uses live pricing: $55 a session. The five-session prepay was
// retired in August 2026, so there is only one rate.

const SINGLE_RATE = 55;
// Gains are counted on take-home pay, not gross, so the return is defensible.
const TAX_RATE = 0.18;

const money = (n) => "$" + Math.round(n).toLocaleString("en-AU");

function fillRange(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--fill", pct + "%");
}

function payback(investment, perMonth) {
  const days = investment / (perMonth / 30);
  if (days < 1) return "Covered in under a day of earning.";
  const d = Math.round(days);
  return `Covered after about ${d} day${d === 1 ? "" : "s"} of earning.`;
}

function render(els) {
  const salary = +els.salary.value;
  const months = +els.months.value;
  const sessions = +els.sessions.value;

  const rate = SINGLE_RATE;
  const investment = sessions * rate;
  const perMonth = (salary * (1 - TAX_RATE)) / 12;
  const gained = perMonth * months;
  const net = gained - investment;
  const roi = investment > 0 ? gained / investment : 0;

  els.salaryVal.textContent = money(salary);
  els.monthsVal.textContent = months + (months === 1 ? " month" : " months");
  els.sessionsVal.textContent = sessions + (sessions === 1 ? " session" : " sessions");

  els.investVal.textContent = "-" + money(investment);
  els.investSub.textContent = `${sessions} x ${money(rate)}`;
  els.gainedLabel.textContent = `Take-home gained (${months} ${months === 1 ? "month" : "months"})`;
  els.gainedVal.textContent = "+" + money(gained);
  els.netVal.textContent = money(net);
  els.returnVal.textContent = Math.round(roi) + "x";
  els.note.textContent = payback(investment, perMonth);

  [els.salary, els.months, els.sessions].forEach(fillRange);
}

function init() {
  const $ = (id) => document.getElementById(id);
  const els = {
    salary: $("roiSalary"), months: $("roiMonths"), sessions: $("roiSessions"),
    salaryVal: $("roiSalaryVal"), monthsVal: $("roiMonthsVal"), sessionsVal: $("roiSessionsVal"),
    investVal: $("roiInvestVal"), investSub: $("roiInvestSub"),
    gainedLabel: $("roiGainedLabel"), gainedVal: $("roiGainedVal"),
    netVal: $("roiNetVal"), returnVal: $("roiReturnVal"), note: $("roiNote"),
  };
  if (!els.salary) return;
  ["salary", "months", "sessions"].forEach((k) =>
    els[k].addEventListener("input", () => render(els))
  );
  render(els);
}

document.addEventListener("DOMContentLoaded", init);
