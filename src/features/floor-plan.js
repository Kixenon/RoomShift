import { resizeRoom } from '../model/room-scene.js';
import { createProject, saveProject } from '../model/projects.js';

// Floor plan → rooms. Calibrate the plan's scale from one known length, then
// click two opposite corners of a room: the room takes that size and the plan
// sits under it (top of the image = the room's front wall, as in Top view).
// One plan can seed several rooms, each its own project sharing the plan.

const STEPS = [
  'Click both ends of a wall whose length you know.',
  'Click the room’s top-left corner on the plan, then its bottom-right corner.',
];

async function downscale(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { url: canvas.toDataURL('image/jpeg', 0.82), width: canvas.width, height: canvas.height };
}

export function underlayFor(plan, corners) {
  const [a, b] = corners;
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const metres = plan.metresPerPixel;
  return {
    image: plan.url,
    widthMeters: plan.width * metres,
    depthMeters: plan.height * metres,
    // Plan centre, in room coordinates (room origin = the clicked top-left corner).
    centerX: (plan.width / 2 - left) * metres,
    centerZ: (plan.height / 2 - top) * metres,
    room: { width: Math.abs(b.x - a.x) * metres, depth: Math.abs(b.y - a.y) * metres },
    opacity: 0.6,
  };
}

export function installFloorPlan(app) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog wide';
  dialog.innerHTML = `<div class="dialog-body">
    <h2>Rooms from a floor plan</h2>
    <p class="muted">Use a listing plan, an architect's drawing or a photo of one. Three clicks set the scale and the room.</p>
    <label class="drop-zone" id="plan-drop"><input id="plan-file" type="file" accept="image/*" hidden /><span>Drop a floor plan or <u>choose a file</u></span></label>
    <p id="plan-step" class="note"></p>
    <div class="plan-stage"><canvas id="plan-canvas"></canvas></div>
    <div class="field-row two" id="plan-length-row" hidden>
      <label class="field"><span>That length is</span><input id="plan-length" class="mono" type="number" step="0.01" min="0.3" placeholder="3.20" /></label>
      <span class="note">metres</span>
    </div>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn ghost" type="button" id="plan-new-room" disabled>Another room from this plan</button><button class="btn primary" type="button" id="plan-apply" disabled>Use for this room</button></div>
  </div>`;
  document.body.append(dialog);
  const canvas = dialog.querySelector('#plan-canvas');
  const context = canvas.getContext('2d');
  const stepText = dialog.querySelector('#plan-step');
  let plan = null;
  let image = null;
  let calibration = [];
  let corners = [];
  let roomCounter = 1;

  function draw() {
    if (!image) return;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dot = (point, color) => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(point.x, point.y, Math.max(4, canvas.width / 200), 0, Math.PI * 2);
      context.fill();
    };
    context.lineWidth = Math.max(2, canvas.width / 400);
    if (calibration.length) {
      context.strokeStyle = '#d4513f';
      calibration.forEach((point) => dot(point, '#d4513f'));
      if (calibration.length === 2) {
        context.beginPath();
        context.moveTo(calibration[0].x, calibration[0].y);
        context.lineTo(calibration[1].x, calibration[1].y);
        context.stroke();
      }
    }
    if (corners.length) {
      corners.forEach((point) => dot(point, '#3d63dd'));
      if (corners.length === 2) {
        context.strokeStyle = '#3d63dd';
        context.fillStyle = 'rgb(61 99 221 / 15%)';
        const [a, b] = corners;
        context.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        context.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        if (plan.metresPerPixel) {
          context.fillStyle = '#3d63dd';
          context.font = `600 ${Math.max(14, canvas.width / 60)}px Geist, sans-serif`;
          context.fillText(`${(Math.abs(b.x - a.x) * plan.metresPerPixel).toFixed(2)} × ${(Math.abs(b.y - a.y) * plan.metresPerPixel).toFixed(2)} m`, Math.min(a.x, b.x) + 8, Math.min(a.y, b.y) + 24);
        }
      }
    }
  }

  function update() {
    const lengthRow = dialog.querySelector('#plan-length-row');
    lengthRow.hidden = calibration.length < 2;
    const length = Number(dialog.querySelector('#plan-length').value);
    plan && (plan.metresPerPixel = calibration.length === 2 && length > 0
      ? length / Math.hypot(calibration[1].x - calibration[0].x, calibration[1].y - calibration[0].y) : null);
    stepText.textContent = !plan ? '' : calibration.length < 2 ? STEPS[0] : !plan.metresPerPixel ? 'Type the real length of that wall.' : corners.length < 2 ? STEPS[1] : 'Looks right? Apply it, or add another room from the same plan.';
    const ready = Boolean(plan?.metresPerPixel && corners.length === 2);
    dialog.querySelector('#plan-apply').disabled = !ready;
    dialog.querySelector('#plan-new-room').disabled = !ready;
    draw();
  }

  async function load(file) {
    if (!file?.type.startsWith('image/')) return;
    plan = await downscale(file);
    image = new Image();
    image.src = plan.url;
    await image.decode();
    canvas.width = plan.width;
    canvas.height = plan.height;
    calibration = [];
    corners = [];
    update();
  }

  canvas.addEventListener('click', (event) => {
    if (!plan) return;
    const bounds = canvas.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
    if (calibration.length < 2) calibration.push(point);
    else if (plan.metresPerPixel) corners = corners.length === 2 ? [point] : [...corners, point];
    update();
    if (calibration.length === 2 && !plan.metresPerPixel) dialog.querySelector('#plan-length').focus();
  });
  dialog.querySelector('#plan-length').addEventListener('input', update);
  dialog.querySelector('#plan-file').addEventListener('change', (event) => load(event.target.files[0]));
  const drop = dialog.querySelector('#plan-drop');
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('over'); load(event.dataTransfer.files[0]); });
  dialog.addEventListener('click', (event) => { if (event.target.closest('[data-close]') || event.target === dialog) dialog.close(); });

  const clampRoom = (room) => ({ width: Math.min(20, Math.max(2, room.width)), depth: Math.min(20, Math.max(2, room.depth)) });
  dialog.querySelector('#plan-apply').addEventListener('click', () => {
    const underlay = underlayFor(plan, corners);
    app.apply(resizeRoom(app.scene, clampRoom(underlay.room)));
    app.setProject({ underlay });
    app.viewport.setUnderlay(underlay);
    dialog.close();
    app.toast('Plan placed under the room — press T for top view to trace it', { action: 'Undo', onAction: app.undo, timeout: 6000 });
  });
  dialog.querySelector('#plan-new-room').addEventListener('click', () => {
    const underlay = underlayFor(plan, corners);
    const name = `Room ${++roomCounter} from plan`;
    const created = createProject({ name, templateId: 'empty' });
    saveProject({ ...created, scene: resizeRoom(created.scene, clampRoom(underlay.room)), underlay, environment: app.project.environment });
    corners = [];
    update();
    app.toast(`Created “${name}” — find it in All rooms. Click two more corners for the next room.`, { timeout: 6000 });
  });

  const open = () => dialog.showModal();
  app.onOpen.push((project) => app.viewport.setUnderlay(project.underlay ?? null));
  app.dockActions = { ...(app.dockActions ?? {}), 'floor-plan': open };
  app.addDockItems(() => '<button class="dock-item photo" type="button" data-dock-action="floor-plan"><span class="glyph">⊞</span>Floor plan</button>');
  app.addPaletteCommands(() => [
    { label: 'Rooms from a floor plan…', group: 'Photo', icon: '⊞', run: open },
    { label: 'Hide floor-plan underlay', group: 'View', run: () => { app.viewport.setUnderlay(null); app.setProject({ underlay: null }); } },
  ]);
}
