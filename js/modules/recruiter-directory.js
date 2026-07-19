// Renders the recruiter directory: sector tables, live filter, CSV export.
import { recruiterSectors } from '../data/recruiters.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function buildSections(mount) {
  recruiterSectors.forEach(({ sector, agencies }) => {
    const section = el('section', 'rd-section');
    const head = el('div', 'rd-section__head');
    head.appendChild(el('h2', 'rd-section__title', sector));
    head.appendChild(el('span', 'rd-section__chip', String(agencies.length)));
    section.appendChild(head);

    const wrap = el('div', 'rd-tablewrap');
    const table = el('table', 'rd-table');
    agencies.forEach(([name, url, desc]) => {
      const row = el('tr', 'rd-row');
      const nameCell = el('td', 'rd-row__agency');
      const link = el('a', null, name);
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener';
      nameCell.appendChild(link);
      row.appendChild(nameCell);
      row.appendChild(el('td', 'rd-row__desc', desc));
      table.appendChild(row);
    });
    wrap.appendChild(table);
    section.appendChild(wrap);
    mount.appendChild(section);
  });
}

function applyFilter(mount, countEl, emptyEl, query) {
  const q = query.trim().toLowerCase();
  let shown = 0;
  mount.querySelectorAll('.rd-section').forEach((section) => {
    const sectorName = section.querySelector('.rd-section__title').textContent.toLowerCase();
    let visible = 0;
    section.querySelectorAll('.rd-row').forEach((row) => {
      const hit = !q || sectorName.includes(q) || row.textContent.toLowerCase().includes(q);
      row.style.display = hit ? '' : 'none';
      if (hit) visible += 1;
    });
    section.style.display = visible ? '' : 'none';
    shown += visible;
  });
  countEl.textContent = shown + ' shown';
  emptyEl.style.display = shown ? 'none' : 'block';
}

function exportCsv(mount) {
  const esc = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lines = [['Sector', 'Agency', 'Website', 'Description'].map(esc).join(',')];
  mount.querySelectorAll('.rd-section').forEach((section) => {
    if (section.style.display === 'none') return;
    const sector = section.querySelector('.rd-section__title').textContent.trim();
    section.querySelectorAll('.rd-row').forEach((row) => {
      if (row.style.display === 'none') return;
      const link = row.querySelector('a');
      const desc = row.querySelector('.rd-row__desc');
      lines.push([sector, link.textContent.trim(), link.href, desc.textContent.trim()].map(esc).join(','));
    });
  });
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'australian-recruitment-agencies.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function init() {
  const mount = document.querySelector('[data-rd-mount]');
  if (!mount) return;
  const filterInput = document.querySelector('[data-rd-filter]');
  const countEl = document.querySelector('[data-rd-count]');
  const emptyEl = document.querySelector('[data-rd-empty]');
  const exportBtn = document.querySelector('[data-rd-export]');

  buildSections(mount);
  countEl.textContent = mount.querySelectorAll('.rd-row').length + ' shown';
  filterInput.addEventListener('input', () => applyFilter(mount, countEl, emptyEl, filterInput.value));
  exportBtn.addEventListener('click', () => exportCsv(mount));
}

document.addEventListener('DOMContentLoaded', init);
