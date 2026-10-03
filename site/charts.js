// SVG charts drawn from RoomShift's own solver output (site/data/*.json).
import experiment from './data/experiment.json';
import jetCheck from './data/jet-check.json';
import benchData from './data/bench.json';
import { gsap, prefersReducedMotion } from './motion.js';

const SVG = 'http://www.w3.org/2000/svg';
const el = (name, attributes = {}, parent) => {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  parent?.append(node);
  return node;
};
const text = (parent, x, y, content, attributes = {}) => {
  const node = el('text', { x, y, ...attributes }, parent);
  node.textContent = content;
  return node;
};

export const SETTING_BUDGET = 4.5;
export const CONFIGS = {
  close: { distance: 0.6, strength: 6, label: 'A', name: 'Close and strong' },
  back: { distance: 1.0, strength: 4.5, label: 'B', name: 'Set back, gentler' },
};
export const runs = experiment.runs;
export const runAt = (distance, strength) => runs.find((run) => run.distance === distance && run.strength === strength);

// Shared hover tooltip, positioned inside the chart's wrapper.
function tooltip(wrapper) {
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  wrapper.append(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.hidden = false;
      const bounds = wrapper.getBoundingClientRect();
      const left = Math.min(Math.max(8, x - bounds.left + 14), bounds.width - tip.offsetWidth - 8);
      tip.style.transform = `translate(${left}px, ${y - bounds.top - tip.offsetHeight - 12}px)`;
    },
    hide() { tip.hidden = true; },
  };
}

// Experiment heatmap: fan distance (columns) × fan setting (rows) → breeze at the desk.
export function renderHeatmap(wrapper, { animate = true, onSelect } = {}) {
  const distances = [...new Set(runs.map((run) => run.distance))];
  const strengths = [...new Set(runs.map((run) => run.strength))].filter((value) => value > 0);
  const maxAir = Math.max(...runs.map((run) => run.deskAir));
  const cell = { w: 92, h: 52, gap: 2 };
  const margin = { top: 34, right: 16, bottom: 58, left: 92 };
  const width = margin.left + distances.length * (cell.w + cell.gap) + margin.right;
  const height = margin.top + strengths.length * (cell.h + cell.gap) + margin.bottom;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Heatmap of breeze at the desk for five fan distances and five fan settings. Breeze rises with every increase in setting; for a given setting it peaks with the fan one to one and a half metres back.' });
  wrapper.prepend(svg);
  const tip = tooltip(wrapper);

  const defs = el('defs', {}, svg);
  const hatch = el('pattern', { id: `hatch-${Math.random().toString(36).slice(2)}`, width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
  el('line', { x1: 0, y1: 0, x2: 0, y2: 6, class: 'hatch-line' }, hatch);

  const rowY = (index) => margin.top + (strengths.length - 1 - index) * (cell.h + cell.gap);
  const colX = (index) => margin.left + index * (cell.w + cell.gap);

  text(svg, margin.left - 12, margin.top - 14, 'Fan setting', { class: 'axis-title', 'text-anchor': 'end' });
  strengths.forEach((strength, index) => {
    text(svg, margin.left - 12, rowY(index) + cell.h / 2 + 5, strength.toFixed(1), { class: 'axis-label', 'text-anchor': 'end' });
  });
  distances.forEach((distance, index) => {
    text(svg, colX(index) + cell.w / 2, height - margin.bottom + 22, `${distance.toFixed(1)} m`, { class: 'axis-label', 'text-anchor': 'middle' });
  });
  text(svg, margin.left + (distances.length * (cell.w + cell.gap)) / 2, height - 10, 'Fan distance back from the desk edge', { class: 'axis-title', 'text-anchor': 'middle' });

  const cells = [];
  strengths.forEach((strength, row) => {
    distances.forEach((distance, col) => {
      const run = runAt(distance, strength);
      const share = run.deskAir / maxAir;
      const overBudget = strength > SETTING_BUDGET;
      const group = el('g', { class: `heat-cell${overBudget ? ' is-over' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${distance} metres back, setting ${strength}: ${run.deskAir.toFixed(2)} metres per second at the desk${overBudget ? ', over the setting budget' : ''}` }, svg);
      const rect = el('rect', { x: colX(col), y: rowY(row), width: cell.w, height: cell.h, rx: 4, fill: `color-mix(in oklab, var(--seq-high) ${Math.round(share * 100)}%, var(--seq-low))` }, group);
      if (overBudget) el('rect', { x: colX(col), y: rowY(row), width: cell.w, height: cell.h, rx: 4, fill: `url(#${hatch.id})`, class: 'hatch' }, group);
      text(group, colX(col) + cell.w / 2, rowY(row) + cell.h / 2 + 5, run.deskAir.toFixed(2), { class: `cell-value${share > 0.55 ? ' on-dark' : ''}`, 'text-anchor': 'middle' });
      const show = (event) => {
        const box = rect.getBoundingClientRect();
        tip.show(`<strong>${run.deskAir.toFixed(2)} m/s</strong> at the desk<br>${distance.toFixed(1)} m back, setting ${strength.toFixed(1)}${overBudget ? '<br><em>Over the 4.5 budget</em>' : ''}`, event?.clientX ?? box.left + box.width / 2, box.top);
      };
      group.addEventListener('pointerenter', show);
      group.addEventListener('pointermove', show);
      group.addEventListener('pointerleave', tip.hide);
      group.addEventListener('focus', () => show());
      group.addEventListener('blur', tip.hide);
      group.addEventListener('click', () => onSelect?.(run));
      group.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect?.(run); } });
      cells.push({ group, row, col, run });
    });
  });

  // Budget line between setting 4.5 and 6.0.
  const budgetRow = strengths.indexOf(SETTING_BUDGET);
  const budgetY = rowY(budgetRow) - cell.gap / 2;
  el('line', { x1: margin.left - 6, x2: margin.left + distances.length * (cell.w + cell.gap), y1: budgetY, y2: budgetY, class: 'budget-line' }, svg);
  text(svg, margin.left + distances.length * (cell.w + cell.gap) - 2, budgetY - 6, 'Setting budget 4.5', { class: 'budget-label', 'text-anchor': 'end' });

  // Mark the two configurations compared in the evidence.
  for (const config of Object.values(CONFIGS)) {
    const row = strengths.indexOf(config.strength);
    const col = distances.indexOf(config.distance);
    const marker = el('g', { class: 'config-marker' }, svg);
    el('rect', { x: colX(col) + 1.5, y: rowY(row) + 1.5, width: cell.w - 3, height: cell.h - 3, rx: 3 }, marker);
    el('circle', { cx: colX(col) + 12, cy: rowY(row) + 12, r: 9 }, marker);
    text(marker, colX(col) + 12, rowY(row) + 16, config.label, { 'text-anchor': 'middle' });
  }

  if (animate && !prefersReducedMotion()) {
    gsap.set(cells.map((item) => item.group), { opacity: 0 });
    gsap.set(svg.querySelectorAll('.config-marker, .budget-line, .budget-label'), { opacity: 0 });
    const play = () => gsap.timeline()
      .to(cells.map((item) => item.group), { opacity: 1, duration: 0.5, ease: 'power2.out', stagger: { each: 0.025, grid: [strengths.length, distances.length], from: 'start' } })
      .to(svg.querySelectorAll('.budget-line, .budget-label'), { opacity: 1, duration: 0.4 }, '-=0.2')
      .to(svg.querySelectorAll('.config-marker'), { opacity: 1, duration: 0.4, stagger: 0.2 });
    return { svg, play };
  }
  return { svg, play: () => {} };
}

// Model check: simulated centreline speed against a free round jet's 1/x decay.
export const benchDefaults = benchData.points;

export function renderJetCheck(wrapper, { animate = true, bench = benchData.points } = {}) {
  const samples = jetCheck.samples;
  const anchor = samples.reduce((best, sample) => (sample.speed > best.speed ? sample : best));
  const reference = samples.filter((sample) => sample.distance >= anchor.distance).map((sample) => ({ distance: sample.distance, speed: (anchor.speed * anchor.distance) / sample.distance }));
  const width = 720;
  const height = 360;
  const m = { top: 24, right: 24, bottom: 52, left: 56 };
  const xMax = 5.4;
  const yMax = 2.4;
  const x = (value) => m.left + (value / xMax) * (width - m.left - m.right);
  const y = (value) => height - m.bottom - (Math.min(value, yMax) / yMax) * (height - m.top - m.bottom);
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Centreline air speed against distance from the fan. The simulated jet rises to ${anchor.speed.toFixed(2)} metres per second at ${anchor.distance.toFixed(1)} metres, then falls faster than the one-over-distance decay of a free jet.` });
  wrapper.prepend(svg);
  const tip = tooltip(wrapper);

  // Push zone: where the model applies the fan force.
  el('rect', { x: x(0), y: m.top, width: x(1.8) - x(0), height: height - m.top - m.bottom, class: 'push-zone' }, svg);
  text(svg, x(0.9), m.top + 18, 'Fan push zone in the model', { class: 'zone-label', 'text-anchor': 'middle' });

  for (let tick = 0; tick <= yMax + 0.001; tick += 0.6) {
    el('line', { x1: m.left, x2: width - m.right, y1: y(tick), y2: y(tick), class: 'grid-line' }, svg);
    text(svg, m.left - 10, y(tick) + 4, tick.toFixed(1), { class: 'axis-label', 'text-anchor': 'end' });
  }
  for (let tick = 0; tick <= 5; tick += 1) text(svg, x(tick), height - m.bottom + 20, `${tick} m`, { class: 'axis-label', 'text-anchor': 'middle' });
  text(svg, m.left - 44, m.top - 8, 'm/s', { class: 'axis-title' });
  text(svg, (m.left + width - m.right) / 2, height - 8, 'Distance in front of the fan', { class: 'axis-title', 'text-anchor': 'middle' });

  const path = (points) => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.distance).toFixed(1)},${y(point.speed).toFixed(1)}`).join('');
  const referencePath = el('path', { d: path(reference), class: 'line-reference' }, svg);
  const simulatedPath = el('path', { d: path(samples), class: 'line-simulated' }, svg);
  const last = reference.at(-1);
  text(svg, x(last.distance) - 4, y(last.speed) - 10, 'Free jet, 1/x', { class: 'direct-label muted', 'text-anchor': 'end' });
  text(svg, x(2.75) + 10, y(1.1), 'RoomShift', { class: 'direct-label' });

  // Bench: measured points from a real fan, when the team has them.
  const benchLayer = el('g', { class: 'bench-layer' }, svg);
  const setBench = (points) => {
    benchLayer.replaceChildren();
    const measured = points.filter((point) => Number.isFinite(point.speed));
    for (const point of measured) {
      const marker = el('g', { class: 'bench-point' }, benchLayer);
      el('rect', { x: x(point.distance) - 7, y: y(point.speed) - 7, width: 14, height: 14, rx: 2, transform: `rotate(45 ${x(point.distance)} ${y(point.speed)})` }, marker);
      const title = el('title', {}, marker);
      title.textContent = `Measured ${point.speed.toFixed(2)} m/s at ${point.distance} m`;
    }
    if (measured.length) {
      const lastPoint = measured.at(-1);
      text(benchLayer, x(lastPoint.distance) + 14, y(lastPoint.speed) + 5, 'Measured', { class: 'direct-label bench-label' });
    }
    wrapper.classList.toggle('has-bench', measured.length > 0);
  };
  setBench(bench);

  // Crosshair hover.
  const cross = el('line', { y1: m.top, y2: height - m.bottom, class: 'crosshair', opacity: 0 }, svg);
  const dot = el('circle', { r: 5, class: 'cross-dot', opacity: 0 }, svg);
  const hit = el('rect', { x: m.left, y: m.top, width: width - m.left - m.right, height: height - m.top - m.bottom, fill: 'transparent' }, svg);
  hit.addEventListener('pointermove', (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * width;
    const distance = ((px - m.left) / (width - m.left - m.right)) * xMax;
    const sample = samples.reduce((best, item) => (Math.abs(item.distance - distance) < Math.abs(best.distance - distance) ? item : best));
    const ref = reference.find((item) => item.distance === sample.distance);
    cross.setAttribute('x1', x(sample.distance)); cross.setAttribute('x2', x(sample.distance)); cross.setAttribute('opacity', 1);
    dot.setAttribute('cx', x(sample.distance)); dot.setAttribute('cy', y(sample.speed)); dot.setAttribute('opacity', 1);
    tip.show(`<strong>${sample.distance.toFixed(2)} m</strong><br>RoomShift ${sample.speed.toFixed(2)} m/s${ref ? `<br>Free jet ${ref.speed.toFixed(2)} m/s` : ''}`, event.clientX, box.top + (y(sample.speed) / height) * box.height);
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dot.setAttribute('opacity', 0); tip.hide(); });

  if (animate && !prefersReducedMotion()) {
    for (const line of [simulatedPath, referencePath]) {
      const length = line.getTotalLength();
      gsap.set(line, { strokeDasharray: length, strokeDashoffset: length });
    }
    const play = () => gsap.timeline()
      .to(referencePath, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.inOut' })
      .to(simulatedPath, { strokeDashoffset: 0, duration: 1.8, ease: 'power2.inOut' }, '-=0.6');
    return { svg, play, setBench };
  }
  return { svg, play: () => {}, setBench };
}

export const jet = {
  peak: jetCheck.samples.reduce((best, sample) => (sample.speed > best.speed ? sample : best)),
  samples: jetCheck.samples,
};
