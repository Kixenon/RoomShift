import { initMotion, initHeader, stretchIn, ScrollTrigger } from './motion.js';
import { renderHeatmap, renderJetCheck, runs, jet, benchDefaults } from './charts.js';

initHeader();
document.querySelector('[data-nav-toggle]')?.addEventListener('click', () => document.querySelector('.site-nav').classList.toggle('is-open'));
stretchIn(document.querySelector('[data-stretch]'), { delay: 0.1 });

const heat = renderHeatmap(document.querySelector('[data-heatmap]'));
ScrollTrigger.create({ trigger: '[data-heatmap]', start: 'top 75%', once: true, onEnter: heat.play });

const jetChart = renderJetCheck(document.querySelector('[data-jet]'));
ScrollTrigger.create({ trigger: '[data-jet]', start: 'top 75%', once: true, onEnter: jetChart.play });
// Bench readings: committed values from bench.json, overridden by what's typed here.
const benchForm = document.querySelector('[data-bench]');
const benchInputs = [...benchForm.querySelectorAll('input')];
const distances = [0.5, 1, 2, 3];
const status = benchForm.querySelector('[data-bench-status]');
const readStored = () => {
  try { return JSON.parse(localStorage.getItem('roomshift-bench') ?? 'null'); } catch { return null; }
};
const initialBench = readStored() ?? benchDefaults.map((point) => point.speed);
benchInputs.forEach((input, i) => { if (Number.isFinite(initialBench[i])) input.value = initialBench[i]; });
const currentBench = () => benchInputs.map((input) => (input.value === '' ? null : Number(input.value)));
const applyBench = () => {
  const values = currentBench();
  jetChart.setBench(distances.map((distance, i) => ({ distance, speed: values[i] })));
  try { localStorage.setItem('roomshift-bench', JSON.stringify(values)); } catch {}
};
benchForm.addEventListener('input', applyBench);
benchForm.addEventListener('submit', (event) => event.preventDefault());
applyBench();
benchForm.querySelector('[data-bench-clear]').addEventListener('click', () => {
  benchInputs.forEach((input) => { input.value = ''; });
  applyBench();
  status.textContent = 'Cleared.';
});
benchForm.querySelector('[data-bench-copy]').addEventListener('click', async () => {
  const values = currentBench();
  const json = JSON.stringify({ points: distances.map((distance, i) => ({ distance, speed: values[i] })) }, null, 1);
  try {
    await navigator.clipboard.writeText(json);
    status.textContent = 'Copied. Paste the points into site/data/bench.json and commit.';
  } catch {
    status.textContent = json;
  }
});

document.querySelector('[data-jet-peak]').textContent = `${jet.peak.speed.toFixed(2)} m/s at ${jet.peak.distance.toFixed(1)} m`;

// Accessible table of all 30 runs.
const runDistances = [...new Set(runs.map((run) => run.distance))];
const strengths = [...new Set(runs.map((run) => run.strength))];
const table = document.createElement('table');
table.innerHTML = `<caption>Breeze at the desk (m/s) by fan setting and distance</caption>
  <thead><tr><th scope="col">Setting</th>${runDistances.map((d) => `<th scope="col">${d.toFixed(1)} m</th>`).join('')}</tr></thead>
  <tbody>${strengths.map((s) => `<tr><th scope="row">${s.toFixed(1)}</th>${runDistances.map((d) => `<td>${runs.find((r) => r.distance === d && r.strength === s).deskAir.toFixed(3)}</td>`).join('')}</tr>`).join('')}</tbody>`;
document.querySelector('[data-heatmap-table]').append(table);

initMotion();
