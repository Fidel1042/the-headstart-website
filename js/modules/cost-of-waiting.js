// Cost of Waiting calculator — live cost-of-inaction estimate.
// No visa/financial advice: pure arithmetic on forgone salary + user's own timeline.

const money = (n) => '$' + Math.round(n).toLocaleString('en-AU');

function fillRange(el) {
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--fill', pct + '%');
}

function render(els) {
  const salary = +els.salary.value;
  const searched = +els.searched.value;
  const left = +els.left.value;
  const perMonth = salary / 12;

  // Labels
  els.salaryVal.textContent = money(salary);
  els.searchedVal.textContent = searched + (searched === 1 ? ' month' : ' months');
  els.leftVal.textContent = left + (left === 1 ? ' month' : ' months');

  // Card A: salary already forgone while searching
  els.gone.textContent = money(perMonth * searched);
  // Card B: cost of one more month
  els.perMonth.textContent = money(perMonth);
  // Card C: runway used
  const totalWindow = searched + left;
  const usedPct = totalWindow > 0 ? Math.min(100, (searched / totalWindow) * 100) : 0;
  els.barFill.style.width = usedPct + '%';
  els.runway.textContent = searched + ' of ' + totalWindow;

  // Projection: 6 more months (or whatever runway allows) alone
  const moreMonths = Math.min(6, left);
  els.projMonths.textContent = moreMonths + (moreMonths === 1 ? ' more month' : ' more months');
  els.projAmount.textContent = money(perMonth * moreMonths);

  [els.salary, els.searched, els.left].forEach(fillRange);
}

export function init() {
  const $ = (id) => document.getElementById(id);
  const els = {
    salary: $('cwSalary'), searched: $('cwSearched'), left: $('cwLeft'),
    salaryVal: $('cwSalaryVal'), searchedVal: $('cwSearchedVal'), leftVal: $('cwLeftVal'),
    gone: $('cwGone'), perMonth: $('cwPerMonth'), runway: $('cwRunway'), barFill: $('cwBarFill'),
    projMonths: $('cwProjMonths'), projAmount: $('cwProjAmount'),
  };
  if (!els.salary) return;
  ['salary', 'searched', 'left'].forEach((k) => {
    els[k].addEventListener('input', () => render(els));
  });
  render(els);
}

document.addEventListener('DOMContentLoaded', init);
