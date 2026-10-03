import { MODEL_PRESETS, isWallItem, objectMaterial } from '../model/room-scene.js';
import { MATERIALS } from '../model/materials.js';
import { CATALOG } from '../model/catalog.js';
import { CITIES, environmentOf } from '../model/environment.js';
import { METRIC_ROWS, roomMetrics } from './metrics.js';

// A printable room report (Save as PDF from the print dialog): a render, the
// livability check, every lens's headline numbers, the furniture schedule with
// sizes and a shopping list for catalogue pieces.

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function reportHtml({ project, scene, image, metrics }) {
  const environment = environmentOf(project);
  const city = CITIES.find((item) => item.id === environment.city)?.label ?? '';
  const { width, depth, height } = scene.room;
  const furniture = scene.objects.filter((object) => !isWallItem(object));
  const catalogNames = new Set(CATALOG.map((item) => item.name.replace(/^IKEA /, '')));
  const shopping = furniture.filter((object) => catalogNames.has(object.name));
  const recommendations = [
    ...metrics.issues.filter((issue) => issue.severity !== 'low').map((issue) => issue.text),
    metrics.deskLux !== null && metrics.deskLux < 300 ? `Add a desk lamp: the desk gets ${Math.round(metrics.deskLux)} lux, 300–500 is comfortable for work.` : null,
    metrics.rt60 > 0.8 ? `Soften the room: echo is ${metrics.rt60.toFixed(2)} s. A rug, curtains or a fabric sofa bring it toward 0.5 s.` : null,
    metrics.ach < 2 ? `Open windows on two walls for cross-ventilation: fresh air is only ${metrics.ach.toFixed(1)} changes per hour.` : null,
    metrics.indoor > 27 && !scene.objects.some((object) => object.model === 'ac') ? `Expect ${metrics.indoor.toFixed(1)} °C without cooling. Shade sunny windows or add an AC unit.` : null,
    metrics.deskWifi !== null && metrics.deskWifi < -67 ? `Move the router closer to the desk or keep metal out of the way (desk signal ${Math.round(metrics.deskWifi)} dBm).` : null,
  ].filter(Boolean);
  const tone = metrics.score >= 85 ? '#2f9e6e' : metrics.score >= 60 ? '#d08a2c' : '#d4513f';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(project.name)} — RoomShift report</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" />
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; font: 13px/1.5 Geist, system-ui, sans-serif; color: #15181e; background: #fff; }
    .page { max-width: 820px; margin: 0 auto; }
    header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #15181e; padding-bottom: 12px; }
    h1 { margin: 0; font-size: 26px; letter-spacing: -.02em; }
    h2 { margin: 28px 0 10px; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; }
    .mono { font-family: 'Geist Mono', monospace; }
    .muted { color: #6b7280; }
    .hero { display: grid; grid-template-columns: 1.6fr 1fr; gap: 20px; margin-top: 20px; align-items: center; }
    .hero img { width: 100%; border-radius: 12px; border: 1px solid #e5e7eb; }
    .score { font: 600 64px/1 'Geist Mono', monospace; color: ${tone}; }
    table { width: 100%; border-collapse: collapse; }
    td, th { padding: 7px 6px; border-bottom: 1px solid #eceef1; text-align: left; }
    th { font-size: 11px; color: #6b7280; font-weight: 500; }
    td.num { text-align: right; font-family: 'Geist Mono', monospace; }
    ul { margin: 0; padding-left: 18px; }
    li { margin: 4px 0; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .print { position: fixed; top: 16px; right: 16px; padding: 10px 16px; border: 0; border-radius: 10px; background: #15181e; color: #fff; font: 600 13px Geist, sans-serif; cursor: pointer; }
    footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #eceef1; color: #9ca3af; font-size: 11px; }
    @media print { .print { display: none; } body { padding: 0; } }
  </style></head><body><button class="print" onclick="print()">Save as PDF</button><div class="page">
  <header><div><div class="muted">RoomShift room report</div><h1>${escapeHtml(project.name)}</h1></div>
    <div class="muted" style="text-align:right">${new Date().toLocaleDateString(undefined, { dateStyle: 'long' })}<br>${escapeHtml(city)} · <span class="mono">${width.toFixed(2)} × ${depth.toFixed(2)} × ${height.toFixed(2)} m</span></div></header>
  <div class="hero"><img src="${image}" alt="3D view of the room" />
    <div><div class="muted">Livability</div><div class="score">${metrics.score}</div>
    <p>${metrics.score >= 85 ? 'Easy to live in.' : metrics.score >= 60 ? 'Workable, with a few snags.' : 'Hard to live in as arranged.'} ${Math.round(metrics.walkable * 100)}% of the floor is walkable at 60 cm.</p>
    ${metrics.wins.length ? `<ul>${metrics.wins.slice(0, 4).map((win) => `<li>${escapeHtml(win)}</li>`).join('')}</ul>` : ''}</div></div>
  <h2>What to change</h2>
  ${recommendations.length ? `<ul>${recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Nothing urgent — this arrangement works.</p>'}
  <div class="grid2"><div><h2>Comfort numbers</h2><table>${METRIC_ROWS.map(([label, get, format]) => {
    const value = get(metrics);
    return `<tr><td>${label}</td><td class="num">${value === null || value === undefined ? '—' : format(value, metrics)}</td></tr>`;
  }).join('')}</table></div>
  <div><h2>Heat balance</h2><table>
    <tr><td>Sun through glass</td><td class="num">${Math.round(metrics.heat.gains.solar)} W</td></tr>
    <tr><td>Heaters</td><td class="num">${Math.round(metrics.heat.gains.heaters)} W</td></tr>
    <tr><td>Appliances &amp; lights</td><td class="num">${Math.round(metrics.heat.gains.appliances)} W</td></tr>
    <tr><td>People</td><td class="num">${Math.round(metrics.heat.gains.people)} W</td></tr>
    <tr><td>AC cooling</td><td class="num">${metrics.heat.cooling > 0.5 ? `−${Math.round(metrics.heat.cooling)}` : '0'} W</td></tr>
    <tr><td>Without cooling it would settle at</td><td class="num">${metrics.freeRunning.toFixed(1)} °C</td></tr>
  </table></div></div>
  <h2>Furniture schedule</h2>
  <table><tr><th>Item</th><th>Type</th><th>Material</th><th>W × D × H (m)</th><th>Position x, z (m)</th></tr>
  ${furniture.map((object) => `<tr><td>${escapeHtml(object.name)}</td><td>${MODEL_PRESETS[object.model]?.label ?? object.model}</td><td>${MATERIALS[objectMaterial(object)]?.label ?? ''}</td>
    <td class="mono">${object.dimensions.width.toFixed(2)} × ${object.dimensions.depth.toFixed(2)} × ${object.dimensions.height.toFixed(2)}</td><td class="mono">${object.position.x.toFixed(2)}, ${object.position.z.toFixed(2)}</td></tr>`).join('')}</table>
  ${shopping.length ? `<h2>Shopping list</h2><ul>${shopping.map((object) => `<li>${escapeHtml(object.name)}</li>`).join('')}</ul>` : ''}
  <footer>Estimates from RoomShift's models: 3D Navier–Stokes airflow, ITU-R P.1238 WiFi, Eyring reverberation, lumen-method lighting with sun position, BS 5925 ventilation and a steady-state heat balance. They are planning estimates, not certified measurements.</footer>
  </div></body></html>`;
}

export function installReport(app) {
  function open() {
    const metrics = roomMetrics(app.scene, app.project, app.weather);
    let image = '';
    try { image = app.viewport.captureThumbnail(1200); } catch { /* optional */ }
    const html = reportHtml({ project: app.project, scene: app.scene, image, metrics });
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const tab = window.open(url, '_blank');
    if (!tab) app.downloadBlob(new Blob([html], { type: 'text/html' }), `${app.fileSlug(app.project.name)}-report.html`);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  app.openReport = open;
  app.addPaletteCommands(() => [{ label: 'Room report (print / PDF)', group: 'Share', icon: '▤', run: open }]);
}
