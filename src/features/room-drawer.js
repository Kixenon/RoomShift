import { PARTITION_MATERIALS, floorOutline, moveObject, resizeRoom, roomShape, setPartitions, setRoomShape } from '../model/room-scene.js';

// A 2D plan editor for the room outline and its interior walls. Corners snap to
// 5 cm and to the neighbouring corners (so right angles come naturally); edge
// lengths can be typed; interior walls carry doorways. Coordinates are metres in
// room space; the result replaces the room shape and partitions in one step.

const SNAP = 0.05;
const ALIGN = 0.18;
const round = (value) => Math.round(value / SNAP) * SNAP;
const fmt = (value) => `${value.toFixed(2)} m`;

const PRESETS = {
  rect: { label: 'Rectangle', points: [[0, 0], [4, 0], [4, 3.5], [0, 3.5]], walls: [] },
  L: { label: 'L-shape', points: [[0, 0], [2.6, 0], [2.6, 1.6], [4.4, 1.6], [4.4, 4], [0, 4]], walls: [] },
  closet: { label: 'Room + closet', points: [[0, 0], [4, 0], [4, 3.6], [0, 3.6]], walls: [{ a: { x: 2.9, z: 0 }, b: { x: 2.9, z: 1.2 }, door: { at: 0.5, width: 0.7 } }, { a: { x: 2.9, z: 1.2 }, b: { x: 4, z: 1.2 } }] },
  hallway: { label: 'Room + hallway', points: [[0, 0], [5, 0], [5, 4], [0, 4]], walls: [{ a: { x: 0, z: 1.1 }, b: { x: 5, z: 1.1 }, door: { at: 0.3, width: 0.85 } }] },
  studio: { label: 'Studio + bathroom', points: [[0, 0], [6, 0], [6, 4.5], [0, 4.5]], walls: [{ a: { x: 4.2, z: 0 }, b: { x: 4.2, z: 2.2 }, door: { at: 0.75, width: 0.8 } }, { a: { x: 4.2, z: 2.2 }, b: { x: 6, z: 2.2 } }] },
};

export function polygonArea(points) {
  return Math.abs(points.reduce((sum, [x1, z1], index) => {
    const [x2, z2] = points[(index + 1) % points.length];
    return sum + (x1 * z2 - x2 * z1);
  }, 0)) / 2;
}

// Normalise a drawn plan so its bounding box starts at the origin.
export function normalisePlan(points, walls) {
  const minX = Math.min(...points.map(([x]) => x));
  const minZ = Math.min(...points.map(([, z]) => z));
  return {
    offset: { x: minX, z: minZ },
    points: points.map(([x, z]) => [+(x - minX).toFixed(3), +(z - minZ).toFixed(3)]),
    walls: walls.map((wall) => ({ ...wall, a: { x: +(wall.a.x - minX).toFixed(3), z: +(wall.a.z - minZ).toFixed(3) }, b: { x: +(wall.b.x - minX).toFixed(3), z: +(wall.b.z - minZ).toFixed(3) } })),
    width: Math.max(...points.map(([x]) => x)) - minX,
    depth: Math.max(...points.map(([, z]) => z)) - minZ,
  };
}

// Apply a drawn plan to a scene: shape, interior walls, room size, and objects
// shifted with the origin so they stay where they were.
export function applyPlan(scene, points, walls) {
  const plan = normalisePlan(points, walls);
  const isBox = plan.points.length === 4 && plan.points.every(([x, z]) => (Math.abs(x) < 1e-3 || Math.abs(x - plan.width) < 1e-3) && (Math.abs(z) < 1e-3 || Math.abs(z - plan.depth) < 1e-3));
  let next = { ...scene, objects: scene.objects.map((object) => ({ ...object, position: { ...object.position, x: object.position.x - plan.offset.x, z: object.position.z - plan.offset.z } })) };
  next = resizeRoom({ ...next, room: { ...next.room, shape: undefined } }, { width: Math.min(20, Math.max(2, plan.width)), depth: Math.min(20, Math.max(2, plan.depth)) });
  next = setRoomShape(next, isBox ? { type: 'rect' } : { type: 'poly', points: plan.points });
  next = setPartitions(next, plan.walls);
  for (const object of next.objects) {
    try { next = moveObject(next, object.id, object.position).scene; } catch { /* stays where it is */ }
  }
  return next;
}

export function installRoomDrawer(app) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog drawer-dialog';
  dialog.innerHTML = `<div class="drawer">
    <header class="drawer-head">
      <h2>Draw the room</h2>
      <div class="segmented drawer-tools" role="tablist">
        <button type="button" class="active" data-tool="outline">Outline</button>
        <button type="button" data-tool="wall">Interior walls</button>
      </div>
      <div class="drawer-presets"></div>
    </header>
    <div class="drawer-body">
      <svg class="drawer-canvas" id="drawer-svg" aria-label="Room plan editor"></svg>
      <aside class="drawer-side">
        <div class="drawer-stats" id="drawer-stats"></div>
        <div id="drawer-selection"></div>
        <div class="drawer-help" id="drawer-help"></div>
      </aside>
    </div>
    <footer class="dialog-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="drawer-apply">Use this plan</button></footer>
  </div>`;
  document.body.append(dialog);
  const svg = dialog.querySelector('#drawer-svg');
  let points = [];
  let walls = [];
  let tool = 'outline';
  let view = { x: -1, z: -1, size: 8 };
  let drag = null;
  let selectedWall = -1;
  let editingEdge = -1;

  const help = {
    outline: 'Drag a corner to move it (it snaps to 5 cm and lines up with its neighbours; hold Shift to place it freely). Click + on an edge to add a corner, double-click a corner to remove it, and click a length to type it. Scroll to zoom.',
    wall: 'Drag across the plan to draw a wall; it snaps straight. Click a wall to give it a doorway or change what it’s made of. Delete removes it.',
  };

  const svgPoint = (event) => {
    const bounds = svg.getBoundingClientRect();
    return {
      x: view.x + ((event.clientX - bounds.left) / bounds.width) * view.size,
      z: view.z + ((event.clientY - bounds.top) / bounds.height) * view.size * (bounds.height / bounds.width),
    };
  };

  // Snap to the grid and line up with the neighbouring corners.
  function snapCorner(index, point, free) {
    if (free) return { x: point.x, z: point.z };
    let { x, z } = { x: round(point.x), z: round(point.z) };
    for (const neighbour of [points[(index - 1 + points.length) % points.length], points[(index + 1) % points.length]]) {
      if (!neighbour) continue;
      if (Math.abs(neighbour[0] - point.x) < ALIGN) x = neighbour[0];
      if (Math.abs(neighbour[1] - point.z) < ALIGN) z = neighbour[1];
    }
    return { x, z };
  }
  // Walls snap straight and onto the outline's corners.
  function snapWallEnd(start, point, free) {
    let x = round(point.x);
    let z = round(point.z);
    for (const [px, pz] of points) {
      if (Math.hypot(px - x, pz - z) < ALIGN) { x = px; z = pz; }
    }
    if (!free && start) {
      if (Math.abs(x - start.x) < Math.abs(z - start.z)) x = start.x;
      else z = start.z;
    }
    return { x, z };
  }

  function fit() {
    const xs = [...points.map(([x]) => x), ...walls.flatMap((wall) => [wall.a.x, wall.b.x])];
    const zs = [...points.map(([, z]) => z), ...walls.flatMap((wall) => [wall.a.z, wall.b.z])];
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 3);
    view = { x: Math.min(...xs) - span * 0.18, z: Math.min(...zs) - span * 0.18, size: span * 1.36 };
  }

  function render() {
    const bounds = svg.getBoundingClientRect();
    const aspect = bounds.height / Math.max(1, bounds.width);
    const height = view.size * aspect;
    svg.setAttribute('viewBox', `${view.x} ${view.z} ${view.size} ${height}`);
    const px = view.size / Math.max(1, bounds.width); // metres per screen pixel
    const grid = [];
    for (let x = Math.floor(view.x); x <= view.x + view.size; x += 0.5) grid.push(`<line x1="${x}" y1="${view.z}" x2="${x}" y2="${view.z + height}" class="${Number.isInteger(x) ? 'major' : 'minor'}" />`);
    for (let z = Math.floor(view.z); z <= view.z + height; z += 0.5) grid.push(`<line x1="${view.x}" y1="${z}" x2="${view.x + view.size}" y2="${z}" class="${Number.isInteger(z) ? 'major' : 'minor'}" />`);
    const underlay = app.project?.underlay;
    const underlayImage = underlay ? `<image href="${underlay.image}" x="${underlay.centerX - underlay.widthMeters / 2 + drawOffset.x}" y="${underlay.centerZ - underlay.depthMeters / 2 + drawOffset.z}" width="${underlay.widthMeters}" height="${underlay.depthMeters}" opacity="0.4" preserveAspectRatio="none" />` : '';
    const outline = points.map(([x, z]) => `${x},${z}`).join(' ');
    const edges = points.map(([x1, z1], index) => {
      const [x2, z2] = points[(index + 1) % points.length];
      const length = Math.hypot(x2 - x1, z2 - z1);
      const mx = (x1 + x2) / 2;
      const mz = (z1 + z2) / 2;
      const nx = -(z2 - z1) / (length || 1);
      const nz = (x2 - x1) / (length || 1);
      return `<g class="edge" data-edge="${index}">
        <text x="${mx - nx * 22 * px}" y="${mz - nz * 22 * px}" font-size="${12 * px}" class="edge-label" data-edge-label="${index}">${length.toFixed(2)}</text>
        ${tool === 'outline' ? `<circle cx="${mx}" cy="${mz}" r="${7 * px}" class="edge-add" data-edge-add="${index}" /><text x="${mx}" y="${mz + 4 * px}" font-size="${12 * px}" class="edge-add-plus">+</text>` : ''}
      </g>`;
    }).join('');
    const wallMarkup = walls.map((wall, index) => {
      const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
      const thickness = PARTITION_MATERIALS[wall.material]?.thickness ?? 0.1;
      const ux = (wall.b.x - wall.a.x) / (length || 1);
      const uz = (wall.b.z - wall.a.z) / (length || 1);
      let segments = [[0, length]];
      if (wall.door) {
        const width = Math.min(wall.door.width ?? 0.85, length - 0.1);
        const start = Math.max(0.05, Math.min(length - width - 0.05, (wall.door.at ?? 0.5) * length - width / 2));
        segments = [[0, start], [start + width, length]];
      }
      const lines = segments.filter(([a, b]) => b - a > 0.01).map(([a, b]) => `<line x1="${wall.a.x + ux * a}" y1="${wall.a.z + uz * a}" x2="${wall.a.x + ux * b}" y2="${wall.a.z + uz * b}" stroke-width="${thickness}" />`).join('');
      const doorArc = wall.door ? (() => {
        const width = Math.min(wall.door.width ?? 0.85, length - 0.1);
        const start = Math.max(0.05, Math.min(length - width - 0.05, (wall.door.at ?? 0.5) * length - width / 2));
        const hx = wall.a.x + ux * start;
        const hz = wall.a.z + uz * start;
        return `<path d="M ${hx} ${hz} L ${hx - uz * width} ${hz + ux * width} A ${width} ${width} 0 0 1 ${hx + ux * width} ${hz + uz * width}" class="door-arc" />`;
      })() : '';
      return `<g class="wall ${index === selectedWall ? 'selected' : ''}" data-wall="${index}">${lines}${doorArc}<line x1="${wall.a.x}" y1="${wall.a.z}" x2="${wall.b.x}" y2="${wall.b.z}" class="wall-hit" stroke-width="${Math.max(0.25, 14 * px)}" /></g>`;
    }).join('');
    const corners = tool === 'outline' ? points.map(([x, z], index) => `<circle cx="${x}" cy="${z}" r="${7 * px}" class="corner" data-corner="${index}" />`).join('') : '';
    const preview = drag?.type === 'new-wall' && drag.end ? `<line x1="${drag.start.x}" y1="${drag.start.z}" x2="${drag.end.x}" y2="${drag.end.z}" class="wall-preview" stroke-width="0.1" /><text x="${drag.end.x + 10 * px}" y="${drag.end.z - 10 * px}" font-size="${12 * px}" class="edge-label">${Math.hypot(drag.end.x - drag.start.x, drag.end.z - drag.start.z).toFixed(2)} m</text>` : '';
    svg.innerHTML = `<g class="grid" stroke-width="${px}">${grid.join('')}</g>${underlayImage}
      <polygon points="${outline}" class="floor" stroke-width="${3 * px}" />
      <g class="walls">${wallMarkup}</g>${edges}${corners}${preview}`;
    const area = polygonArea(points);
    const usable = area - walls.reduce((sum, wall) => sum + Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z) * (PARTITION_MATERIALS[wall.material]?.thickness ?? 0.1), 0);
    dialog.querySelector('#drawer-stats').innerHTML = `<div class="metric"><span class="metric-value">${area.toFixed(1)} m²</span><span class="metric-label">Floor area</span></div>
      <div class="metric"><span class="metric-value">${points.length}</span><span class="metric-label">Corners</span></div>
      <div class="metric"><span class="metric-value">${walls.length}</span><span class="metric-label">Interior walls</span></div>
      <div class="metric"><span class="metric-value">${usable.toFixed(1)} m²</span><span class="metric-label">Usable floor</span></div>`;
    dialog.querySelector('#drawer-help').textContent = help[tool];
    renderSelection();
    dialog.querySelector('#drawer-apply').disabled = points.length < 3 || area < 3;
  }

  function renderSelection() {
    const box = dialog.querySelector('#drawer-selection');
    const wall = walls[selectedWall];
    if (editingEdge >= 0) {
      const [x1, z1] = points[editingEdge];
      const [x2, z2] = points[(editingEdge + 1) % points.length];
      box.innerHTML = `<h3 class="sheet-h">Edge length</h3><div class="field-row two"><label class="field"><span>m</span><input id="edge-length" class="mono" type="number" step="0.05" min="0.3" value="${Math.hypot(x2 - x1, z2 - z1).toFixed(2)}" /></label><button class="btn" type="button" id="edge-apply">Set</button></div><p class="note">Moves the edge’s end corner along the edge.</p>`;
      const input = box.querySelector('#edge-length');
      input.focus();
      input.select();
      const commit = () => {
        const length = Number(input.value);
        if (!(length > 0.2)) return;
        const current = Math.hypot(x2 - x1, z2 - z1) || 1;
        points[(editingEdge + 1) % points.length] = [+(x1 + (x2 - x1) * length / current).toFixed(3), +(z1 + (z2 - z1) * length / current).toFixed(3)];
        editingEdge = -1;
        render();
      };
      box.querySelector('#edge-apply').addEventListener('click', commit);
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } });
      return;
    }
    if (!wall) {
      box.innerHTML = '';
      return;
    }
    const length = Math.hypot(wall.b.x - wall.a.x, wall.b.z - wall.a.z);
    box.innerHTML = `<h3 class="sheet-h">Interior wall · ${fmt(length)}</h3>
      <div class="chip-row">${Object.entries(PARTITION_MATERIALS).map(([key, item]) => `<button type="button" class="chip-option ${(wall.material ?? 'drywall') === key ? 'active' : ''}" data-wall-material="${key}">${item.label}</button>`).join('')}</div>
      <button class="toggle" type="button" data-wall-door style="margin-top:10px"><span>Doorway</span><span class="switch ${wall.door ? 'on' : ''}"></span></button>
      ${wall.door ? `<div class="xyz" style="grid-template-columns: 70px 1fr 1fr"><span>Width · at</span><input type="number" step="0.05" min="0.5" max="${(length - 0.1).toFixed(2)}" value="${(wall.door.width ?? 0.85).toFixed(2)}" data-door-width /><input type="number" step="5" min="0" max="100" value="${Math.round((wall.door.at ?? 0.5) * 100)}" data-door-at title="Position along the wall, %" /></div>` : ''}
      <button class="btn ghost" type="button" data-wall-delete style="margin-top:10px;color:var(--bad)">Delete wall</button>`;
  }

  dialog.querySelector('#drawer-selection').addEventListener('click', (event) => {
    const wall = walls[selectedWall];
    if (!wall) return;
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.wallMaterial) wall.material = target.dataset.wallMaterial;
    else if (target.matches('[data-wall-door]')) wall.door = wall.door ? null : { at: 0.5, width: 0.85 };
    else if (target.matches('[data-wall-delete]')) { walls.splice(selectedWall, 1); selectedWall = -1; }
    render();
  });
  dialog.querySelector('#drawer-selection').addEventListener('change', (event) => {
    const wall = walls[selectedWall];
    if (!wall?.door) return;
    if (event.target.matches('[data-door-width]')) wall.door.width = Math.max(0.5, Number(event.target.value) || 0.85);
    if (event.target.matches('[data-door-at]')) wall.door.at = Math.min(1, Math.max(0, (Number(event.target.value) || 50) / 100));
    render();
  });

  svg.addEventListener('pointerdown', (event) => {
    const point = svgPoint(event);
    const corner = event.target.closest('[data-corner]');
    const add = event.target.closest('[data-edge-add]');
    const label = event.target.closest('[data-edge-label]');
    const wall = event.target.closest('[data-wall]');
    editingEdge = -1;
    if (label) { editingEdge = Number(label.dataset.edgeLabel); render(); return; }
    if (tool === 'outline') {
      if (add) {
        const index = Number(add.dataset.edgeAdd);
        const [x1, z1] = points[index];
        const [x2, z2] = points[(index + 1) % points.length];
        points.splice(index + 1, 0, [round((x1 + x2) / 2), round((z1 + z2) / 2)]);
        drag = { type: 'corner', index: index + 1 };
      } else if (corner) drag = { type: 'corner', index: Number(corner.dataset.corner) };
      else drag = { type: 'pan', start: { x: event.clientX, y: event.clientY }, view: { ...view } };
    } else if (wall) {
      selectedWall = Number(wall.dataset.wall);
      render();
      return;
    } else {
      selectedWall = -1;
      drag = { type: 'new-wall', start: snapWallEnd(null, point, true) };
    }
    svg.setPointerCapture(event.pointerId);
    render();
  });
  svg.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const point = svgPoint(event);
    if (drag.type === 'corner') {
      const snapped = snapCorner(drag.index, point, event.shiftKey);
      points[drag.index] = [+snapped.x.toFixed(3), +snapped.z.toFixed(3)];
    } else if (drag.type === 'new-wall') {
      drag.end = snapWallEnd(drag.start, point, event.shiftKey);
    } else if (drag.type === 'pan') {
      const bounds = svg.getBoundingClientRect();
      view.x = drag.view.x - (event.clientX - drag.start.x) / bounds.width * view.size;
      view.z = drag.view.z - (event.clientY - drag.start.y) / bounds.width * view.size;
    }
    render();
  });
  svg.addEventListener('pointerup', () => {
    if (drag?.type === 'new-wall' && drag.end && Math.hypot(drag.end.x - drag.start.x, drag.end.z - drag.start.z) > 0.3) {
      walls.push({ a: drag.start, b: drag.end, material: 'drywall', door: null });
      selectedWall = walls.length - 1;
    }
    drag = null;
    render();
  });
  svg.addEventListener('dblclick', (event) => {
    const corner = event.target.closest('[data-corner]');
    if (!corner || points.length <= 3) return;
    points.splice(Number(corner.dataset.corner), 1);
    render();
  });
  svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const point = svgPoint(event);
    const factor = Math.exp(event.deltaY * 0.0015);
    const size = Math.min(40, Math.max(2, view.size * factor));
    view.x = point.x - (point.x - view.x) * size / view.size;
    view.z = point.z - (point.z - view.z) * size / view.size;
    view.size = size;
    render();
  }, { passive: false });
  dialog.addEventListener('keydown', (event) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedWall >= 0 && !event.target.matches('input')) {
      walls.splice(selectedWall, 1);
      selectedWall = -1;
      render();
    }
  });
  dialog.querySelector('.drawer-tools').addEventListener('click', (event) => {
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    tool = button.dataset.tool;
    for (const item of dialog.querySelectorAll('[data-tool]')) item.classList.toggle('active', item === button);
    selectedWall = -1;
    render();
  });
  dialog.querySelector('.drawer-presets').innerHTML = Object.entries(PRESETS).map(([key, preset]) => `<button type="button" class="chip-option" data-preset="${key}">${preset.label}</button>`).join('');
  dialog.querySelector('.drawer-presets').addEventListener('click', (event) => {
    const preset = PRESETS[event.target.closest('[data-preset]')?.dataset.preset];
    if (!preset) return;
    points = preset.points.map(([x, z]) => [x, z]);
    walls = preset.walls.map((wall) => ({ material: 'drywall', door: null, ...structuredClone(wall) }));
    selectedWall = -1;
    fit();
    render();
  });
  dialog.addEventListener('click', (event) => { if (event.target.closest('[data-close]') || event.target === dialog) dialog.close(); });
  dialog.querySelector('#drawer-apply').addEventListener('click', () => {
    app.track?.('room-size');
    app.apply(applyPlan(app.scene, points, walls), { select: null });
    app.viewport.fitRoom(true);
    dialog.close();
    app.toast(`Room set to ${polygonArea(points).toFixed(1)} m²${walls.length ? ` with ${walls.length} interior wall${walls.length > 1 ? 's' : ''}` : ''}`, { action: 'Undo', onAction: app.undo, timeout: 6000 });
  });

  // The plan's origin offset for the underlay (applyPlan re-zeroes the origin).
  let drawOffset = { x: 0, z: 0 };
  function open() {
    const room = app.scene.room;
    const shape = roomShape(room);
    points = (shape.type === 'rect' ? [[0, 0], [room.width, 0], [room.width, room.depth], [0, room.depth]] : floorOutline(room, 6)).map(([x, z]) => [+x.toFixed(3), +z.toFixed(3)]);
    walls = structuredClone(app.scene.partitions ?? []);
    drawOffset = { x: 0, z: 0 };
    tool = 'outline';
    selectedWall = -1;
    editingEdge = -1;
    for (const item of dialog.querySelectorAll('[data-tool]')) item.classList.toggle('active', item.dataset.tool === 'outline');
    dialog.showModal();
    fit();
    requestAnimationFrame(render);
  }
  app.openRoomDrawer = open;
  app.addPaletteCommands(() => [
    { label: 'Draw the room outline…', group: 'Room', icon: '✎', run: open },
    { label: 'Add interior walls (closet, hallway)…', group: 'Room', icon: '▥', run: () => { open(); dialog.querySelector('[data-tool="wall"]').click(); } },
  ]);
}
