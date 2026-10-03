import { METRIC_ROWS, bestIndex, roomMetrics } from './metrics.js';

// Layout variants: keep several arrangements of the same room (A, B, C…) and
// compare them side by side on every lens. Stored on the project.

const LETTERS = 'ABCDEFGH';
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function installVariants(app) {
  const chip = document.createElement('div');
  chip.className = 'menu-wrap variant-wrap';
  chip.innerHTML = `<button class="chip variant-chip" type="button" id="variant-chip" title="Layout variants"><span class="chip-k">Layout</span><span id="variant-name">A</span><span class="caret">▾</span></button>
    <div id="variant-menu" class="menu" hidden></div>`;
  document.querySelector('.chips').append(chip);
  const menu = chip.querySelector('#variant-menu');

  const dialog = document.createElement('dialog');
  dialog.className = 'dialog wide';
  dialog.innerHTML = '<div class="dialog-body"><h2>Compare layouts</h2><div id="compare-body"></div><div class="dialog-actions"><button class="btn primary" type="button" data-close>Done</button></div></div>';
  document.body.append(dialog);
  dialog.addEventListener('click', (event) => { if (event.target.closest('[data-close]') || event.target === dialog) dialog.close(); });

  const variants = () => app.project?.variants ?? [];
  const activeId = () => app.project?.activeVariant ?? variants()[0]?.id;

  // Make sure the current arrangement is stored in the active variant.
  function syncActive() {
    const list = variants();
    if (!list.length) return [{ id: 'v1', name: 'Layout A', scene: app.scene, thumbnail: null }];
    return list.map((variant) => (variant.id === activeId() ? { ...variant, scene: app.scene } : variant));
  }

  function render() {
    const list = syncActive();
    const active = list.find((variant) => variant.id === activeId()) ?? list[0];
    chip.querySelector('#variant-name').textContent = active.name.replace(/^Layout /, '');
    menu.innerHTML = `<div class="menu-label">Layouts of this room</div>
      ${list.map((variant) => `<button type="button" data-variant-id="${variant.id}"><span>${variant.id === active.id ? '● ' : ''}${escapeHtml(variant.name)}</span><span class="muted">${roomMetrics(variant.scene, app.project, app.weather).score}</span></button>`).join('')}
      <hr /><button type="button" data-variant-action="new">Save as new layout <kbd>⇧N</kbd></button>
      ${list.length > 1 ? '<button type="button" data-variant-action="compare">Compare side by side…</button>' : ''}
      ${list.length > 1 ? '<button type="button" class="danger" data-variant-action="delete">Delete this layout</button>' : ''}`;
  }

  function store(list, active) {
    app.setProject({ variants: list, activeVariant: active });
    render();
  }

  function newVariant() {
    const list = syncActive();
    const id = `v${Date.now().toString(36)}`;
    const name = `Layout ${LETTERS[list.length] ?? list.length + 1}`;
    let thumbnail = null;
    try { thumbnail = app.viewport.captureThumbnail(240); } catch { /* optional */ }
    const stored = list.map((variant) => (variant.id === (activeId() ?? 'v1') ? { ...variant, thumbnail } : variant));
    store([...stored, { id, name, scene: structuredClone(app.scene), thumbnail: null }], id);
    app.toast(`${name} created from the current arrangement — move things freely, then compare`, { timeout: 5000 });
  }

  function switchTo(id) {
    const list = syncActive();
    const target = list.find((variant) => variant.id === id);
    if (!target || id === activeId()) return;
    let thumbnail = null;
    try { thumbnail = app.viewport.captureThumbnail(240); } catch { /* optional */ }
    store(list.map((variant) => (variant.id === activeId() ? { ...variant, thumbnail } : variant)), id);
    app.apply(structuredClone(target.scene), { select: null });
    app.toast(`Switched to ${target.name}`);
  }

  function deleteActive() {
    const list = syncActive();
    if (list.length < 2) return;
    const remaining = list.filter((variant) => variant.id !== activeId());
    store(remaining, remaining[0].id);
    app.apply(structuredClone(remaining[0].scene), { select: null });
  }

  function compare() {
    app.track?.('compare');
    const list = syncActive();
    const metrics = list.map((variant) => roomMetrics(variant.scene, app.project, app.weather));
    dialog.querySelector('#compare-body').innerHTML = `<div class="compare-scroll"><table class="compare-table">
      <thead><tr><th></th>${list.map((variant) => `<th><div class="compare-thumb" style="${variant.thumbnail ? `background-image:url(${variant.thumbnail})` : ''}"></div>${escapeHtml(variant.name)}${variant.id === activeId() ? ' <span class="badge">current</span>' : ''}</th>`).join('')}</tr></thead>
      <tbody>${METRIC_ROWS.map(([label, get, format, direction, range]) => {
        const values = metrics.map((metric) => get(metric));
        const best = bestIndex(values, direction, range ?? [0, 0]);
        return `<tr><td>${label}</td>${values.map((value, index) => `<td class="${index === best ? 'best' : ''}">${value === null || value === undefined ? '—' : format(value, metrics[index])}</td>`).join('')}</tr>`;
      }).join('')}
      <tr><td></td>${list.map((variant) => `<td><button class="btn ghost" type="button" data-compare-use="${variant.id}">${variant.id === activeId() ? 'Editing' : 'Use this'}</button></td>`).join('')}</tr>
      </tbody></table></div>
      <p class="note">Highlighted = best of the set. Light uses the current site time; temperatures and cost come from the steady-state heat balance.</p>`;
    dialog.showModal();
  }
  dialog.addEventListener('click', (event) => {
    const use = event.target.closest('[data-compare-use]');
    if (use) { switchTo(use.dataset.compareUse); dialog.close(); }
  });

  chip.querySelector('#variant-chip').addEventListener('click', () => {
    render();
    const open = menu.hidden;
    document.querySelectorAll('.menu').forEach((item) => { item.hidden = true; });
    menu.hidden = !open;
  });
  menu.addEventListener('click', (event) => {
    const item = event.target.closest('button');
    if (!item) return;
    menu.hidden = true;
    if (item.dataset.variantId) switchTo(item.dataset.variantId);
    else if (item.dataset.variantAction === 'new') newVariant();
    else if (item.dataset.variantAction === 'compare') compare();
    else if (item.dataset.variantAction === 'delete') deleteActive();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'N' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.target.matches('input, textarea, select') && !document.querySelector('#editor').hidden) newVariant();
  });

  // Keep the active variant's stored scene current whenever the project saves.
  app.beforeSave = (next) => (next.variants?.length ? { ...next, variants: next.variants.map((variant) => (variant.id === next.activeVariant ? { ...variant, scene: next.scene } : variant)) } : next);
  app.onOpen.push(render);
  app.addPaletteCommands(() => [
    { label: 'Save as a new layout (A/B)', group: 'Layout', icon: '⧉', keys: '⇧N', run: newVariant },
    { label: 'Compare layouts side by side', group: 'Layout', icon: '⇆', run: compare },
    ...variants().map((variant) => ({ label: `Switch to ${variant.name}`, group: 'Layout', run: () => switchTo(variant.id) })),
  ]);
  app.compareLayouts = compare;
}
