import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import * as THREE from 'three';
import { createRoomScene } from '../src/model/room-scene.js';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const browserExecutable = process.env.ROOMSHIFT_BROWSER || undefined;

let server;
let browser;
let page;
let baseUrl;
let browserErrors = [];

// Keep gizmo interactions independent of changes to the starter showcase.
const editorScene = createRoomScene();
const placements = { fan: [0.82, 3.15, 180], sofa: [4.18, 3.04, 0], desk: [4.18, 0.86, 0], table: [2.62, 2.12, 0], lamp: [1.2, 0.9, 0], heater: [0.55, 1.9, 0] };
editorScene.objects = editorScene.objects.filter((object) => placements[object.model]).map((object) => {
  const [x, z, yRotation] = placements[object.model];
  return { ...object, position: { x, y: 0, z }, rotation: { x: 0, y: yRotation, z: 0 } };
});
editorScene.nextObjectId = 5;
editorScene.nextWindowId = 1;
editorScene.nextDoorId = 1;


test.before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'error',
    root,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;

  browser = await chromium.launch({
    args: ['--no-sandbox', '--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])],
    executablePath: browserExecutable,
    headless: true,
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 577 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${message.text()} @ ${message.location().url}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) browserErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
});

test.beforeEach(async () => {
  browserErrors = [];
  await page.addInitScript((scene) => { localStorage.clear(); localStorage.setItem('roomshift.workspace', JSON.stringify({ version: 1, scene, baseline: null, scenarios: [] })); }, editorScene);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 577 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#viewport canvas').first().waitFor();
  await page.waitForTimeout(250);
});

test.afterEach(() => {
  assert.deepEqual(browserErrors, [], `browser console errors: ${browserErrors.join('; ')}`);
});

test.after(async () => {
  await browser?.close();
  await server?.close();
});

function roomScreenPoint(canvasBounds, worldPosition) {
  const room = { width: 5.2, depth: 4, height: 2.7 };
  const distance = Math.max(room.width, room.depth) * 1.35;
  const camera = new THREE.PerspectiveCamera(42, canvasBounds.width / canvasBounds.height, 0.05, 200);
  camera.position.set(distance * 0.88, distance * 0.7, distance * 0.96);
  camera.lookAt(0, room.height / 2, 0);
  camera.updateMatrixWorld(true);

  const projected = new THREE.Vector3(...worldPosition).project(camera);
  return {
    x: canvasBounds.x + ((projected.x + 1) * canvasBounds.width) / 2,
    y: canvasBounds.y + ((1 - projected.y) * canvasBounds.height) / 2,
  };
}

const fanCenterWorld = [-1.78, 0.675, 1.15];
const fanScreenPoint = (bounds) => roomScreenPoint(bounds, fanCenterWorld);

function rotationRingPoint(axis, angle, radius) {
  if (axis === 'x') {
    return [fanCenterWorld[0], fanCenterWorld[1] + Math.cos(angle) * radius, fanCenterWorld[2] + Math.sin(angle) * radius];
  }
  return [fanCenterWorld[0] + Math.cos(angle) * radius, fanCenterWorld[1] + Math.sin(angle) * radius, fanCenterWorld[2]];
}

test('clicking a visible object in the scene selects it', async () => {
  const canvases = page.locator('#viewport canvas#room-canvas');
  assert.equal(await canvases.count(), 1, 'the renderer canvas must be the only canvas in the viewport');

  const row = page.locator('[data-select-object="fan-1"]');
  assert.equal(await row.getAttribute('aria-pressed'), 'false');

  const bounds = await canvases.boundingBox();
  const point = fanScreenPoint(bounds);
  await page.mouse.click(point.x, point.y);

  await page.waitForFunction(
    () => document.querySelector('[data-select-object="fan-1"]')?.getAttribute('aria-pressed') === 'true',
    { timeout: 1200 },
  ).catch(() => {});
  assert.equal(await row.getAttribute('aria-pressed'), 'true');
});

test('dragging a selected object along its move handle changes its position', async () => {
  const canvas = page.locator('#room-canvas');
  const bounds = await canvas.boundingBox();
  const center = fanScreenPoint(bounds);
  await page.mouse.click(center.x, center.y);
  await page.waitForFunction(() => document.querySelector('[data-position="x"]')?.value === '0.82');

  const initialX = Number(await page.locator('[data-position="x"]').inputValue());
  const handle = roomScreenPoint(bounds, [fanCenterWorld[0] + 0.8, fanCenterWorld[1], fanCenterWorld[2]]);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 42, handle.y + 16, { steps: 16 });
  await page.mouse.up();

  await page.waitForFunction(
    (value) => Number(document.querySelector('[data-position="x"]')?.value) > value + 0.1,
    initialX,
    { timeout: 1500 },
  );
  assert.ok(Number(await page.locator('[data-position="x"]').inputValue()) > initialX + 0.1);
});

test('dragging the vertical rotation ring changes object rotation', async () => {
  const canvas = page.locator('#room-canvas');
  const bounds = await canvas.boundingBox();
  const center = fanScreenPoint(bounds);
  await page.mouse.click(center.x, center.y);
  await page.locator('#transform-mode-toggle').click();
  await page.waitForFunction(() => document.querySelector('[data-rotation="y"]') !== null);

  const start = roomScreenPoint(bounds, [fanCenterWorld[0] + 0.8, fanCenterWorld[1], fanCenterWorld[2]]);
  const end = roomScreenPoint(bounds, [fanCenterWorld[0] + 0.72, fanCenterWorld[1], fanCenterWorld[2] - 0.35]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();

  await page.waitForFunction(
    () => Math.abs(Number(document.querySelector('[data-rotation="y"]')?.value ?? 0)) > 1,
    { timeout: 1500 },
  );
  assert.ok(Math.abs(Number(await page.locator('[data-rotation="y"]').inputValue())) > 1);
});

test('dragging empty canvas orbits the room', async () => {
  const canvas = page.locator('#room-canvas');
  const bounds = await canvas.boundingBox();
  const before = await canvas.screenshot();
  const start = { x: bounds.x + 35, y: bounds.y + bounds.height * 0.55 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 110, start.y + 24, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(180);

  const after = await canvas.screenshot();
  assert.equal(before.equals(after), false, 'camera orbit should change the rendered room view');
});

test('an object can be named and assigned a furniture model without changing its geometry', async () => {
  await page.locator('#add-object').click();
  const row = page.locator('[data-select-object="object-5"]');
  await row.waitFor();
  assert.equal(await row.getAttribute('aria-pressed'), 'true');

  const sizeInputs = page.locator('[data-dimension]');
  const initialSizes = await sizeInputs.evaluateAll((inputs) => inputs.map((input) => input.value));
  const nameInput = page.locator('[data-object-name]');
  await nameInput.fill('Reading bed');
  await nameInput.blur();
  await page.locator('[data-object-model]').selectOption('bed');

  await page.waitForFunction(() => document.querySelector('[data-select-object="object-5"]')?.textContent.includes('Reading bed'));
  assert.match(await row.textContent(), /Reading bed/);
  assert.equal(await page.locator('[data-object-name]').inputValue(), 'Reading bed');
  assert.deepEqual(await sizeInputs.evaluateAll((inputs) => inputs.map((input) => input.value)), initialSizes);

  for (const model of ['box', 'sofa', 'bed', 'desk', 'table']) {
    await page.locator('[data-object-model]').selectOption(model);
    assert.equal(await page.locator('[data-object-model]').inputValue(), model);
    assert.match(await row.textContent(), /Reading bed/);
    assert.deepEqual(await sizeInputs.evaluateAll((inputs) => inputs.map((input) => input.value)), initialSizes);
  }
});

test('object names are rendered as text, not interpreted as markup', async () => {
  await page.locator('[data-select-object="fan-1"]').click();
  const nameInput = page.locator('[data-object-name]');
  await nameInput.fill('<img src=x> Fan');
  await nameInput.blur();

  const row = page.locator('[data-select-object="fan-1"]');
  assert.equal(await row.locator('img').count(), 0);
  assert.match(await row.textContent(), /<img src=x> Fan/);
});

test('air, heat, and light fields update automatically and after scene edits', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#viewport canvas').first().waitFor();
  await page.waitForTimeout(250);
  const canvas = page.locator('#room-canvas');
  const initialImage = await canvas.screenshot();

  assert.equal(await page.locator('#simulate-fields').count(), 0, 'field estimates should not require a Run button');
  await page.locator('#show-airflow').click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#room-canvas');
    return canvas?.dataset.fieldMode === 'airflow'
      && Number(canvas.dataset.fieldCells) > 0;
  }, { timeout: 30_000 });
  assert.ok(Number(await canvas.getAttribute('data-field-cell-size')) <= 0.151);
  assert.ok(Number(await canvas.getAttribute('data-field-max-speed')) > 0.01);
  assert.ok(Number.isFinite(Number(await canvas.getAttribute('data-field-rms-divergence'))));
  assert.match(await page.locator('#field-legend-title').textContent(), /Airflow/);
  assert.equal(await page.locator('#show-airflow').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#field-display-label').textContent(), 'Volume');
  assert.equal(await canvas.getAttribute('data-gas-density-max'), null);

  await page.locator('#field-display-button').click();
  await page.locator('[data-display-style="volume"]').click();
  assert.ok(Number(await canvas.getAttribute('data-field-volume-voxels')) > 0);

  await page.locator('#show-temperature').click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#room-canvas');
    return canvas?.dataset.fieldMode === 'temperature'
      && Number(canvas.dataset.fieldCells) > 0;
  }, { timeout: 30_000 });
  assert.ok(Number(await canvas.getAttribute('data-field-max-temperature')) > 20);
  assert.ok(Number.parseFloat(await page.locator('#field-legend-max').textContent())
    > Number.parseFloat(await page.locator('#field-legend-min').textContent()));

  await page.locator('#show-light').click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#room-canvas');
    return canvas?.dataset.fieldMode === 'light';
  }, { timeout: 30_000 });
  assert.equal(await page.locator('#field-legend-min').textContent(), 'shadow');
  assert.equal(await page.locator('#field-legend-max').textContent(), 'lit');
  const beforeResize = await canvas.screenshot();
  const roomWidth = page.locator('#room-width');
  await roomWidth.fill('5.5');
  await roomWidth.blur();
  await page.waitForFunction(() => document.querySelector('#room-width')?.value === '5.5');
  assert.equal(await canvas.getAttribute('data-field-mode'), 'light');
  assert.equal(await canvas.getAttribute('data-lighting-preview'), 'true');
  assert.equal(await page.locator('#show-light').getAttribute('aria-pressed'), 'true');
  assert.equal((await canvas.screenshot()).equals(beforeResize), false, 'the lighting preview should update with the resized room');
  assert.equal(initialImage.equals(await canvas.screenshot()), false, 'the field views should change the scene');
});

test('a fan close to a wall keeps a visible resolved airflow field', async () => {
  await page.locator('[data-select-object="fan-1"]').click();
  const positionZ = page.locator('[data-position="z"]');
  await positionZ.fill('3.75');
  await positionZ.blur();
  await page.locator('#show-airflow').click();

  await page.waitForFunction(() => {
    const canvas = document.querySelector('#room-canvas');
    return canvas?.dataset.fieldMode === 'airflow'
      && Number(canvas.dataset.fieldMaxSpeed) > 0.05
      && Number(canvas.dataset.fieldDuration) === 3;
  });
  assert.ok(Number(await page.locator('#room-canvas').getAttribute('data-field-cells')) > 0);
});

test('room edits, object properties, camera controls, and delete work end to end', async () => {
  const initialObjectCount = await page.locator('[data-select-object]').count();
  const width = page.locator('#room-width');
  const depth = page.locator('#room-depth');
  await width.fill('6.4');
  await width.blur();
  await depth.fill('4.6');
  await depth.blur();
  assert.equal(await width.inputValue(), '6.4');
  assert.equal(await depth.inputValue(), '4.6');

  await width.fill('1');
  await width.blur();
  assert.equal(await width.inputValue(), '6.4', 'invalid room dimensions should roll back');

  await page.locator('[data-select-object="sofa-2"]').click();
  const objectWidth = page.locator('[data-dimension="width"]');
  await objectWidth.fill('2');
  await objectWidth.blur();
  assert.equal(await page.locator('[data-dimension="width"]').inputValue(), '2.00');
  const rotation = page.locator('[data-rotation="y"]');
  await rotation.fill('45');
  await rotation.blur();
  assert.equal(await page.locator('[data-rotation="y"]').inputValue(), '45.00');

  await page.locator('#camera-view-picker-button').click();
  await page.locator('#camera-view-top').click();
  await page.locator('#toggle-projection').click();
  assert.equal(await page.locator('#room-canvas').getAttribute('data-projection'), 'orthographic');
  await page.locator('#toggle-projection').click();
  assert.equal(await page.locator('#room-canvas').getAttribute('data-projection'), 'perspective');
  await page.locator('#transform-mode-toggle').click();
  assert.equal(await page.locator('#transform-mode-toggle').getAttribute('aria-pressed'), 'true');
  await page.locator('#camera-view-picker-button').click();
  await page.locator('#camera-view-3d').click();

  await page.locator('#delete-object').click();
  assert.equal(await page.locator('[data-select-object]').count(), initialObjectCount - 1);
  assert.equal(await page.locator('#delete-object').isDisabled(), true);

});

test('asset and properties menus can be collapsed and expanded', async () => {
  const assetToggle = page.locator('#toggle-asset-rail');
  await assetToggle.click();
  assert.equal(await assetToggle.getAttribute('aria-expanded'), 'false');
  await assetToggle.click();
  assert.equal(await assetToggle.getAttribute('aria-expanded'), 'true');

  const inspectorToggle = page.locator('#toggle-inspector');
  await inspectorToggle.click();
  assert.equal(await inspectorToggle.getAttribute('aria-expanded'), 'false');
  await inspectorToggle.click();
  assert.equal(await inspectorToggle.getAttribute('aria-expanded'), 'true');
});

test('narrow screens keep the canvas and field controls usable', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    viewportWidth: document.querySelector('#viewport').getBoundingClientRect().width,
    viewportHeight: document.querySelector('#viewport').getBoundingClientRect().height,
    controls: document.querySelector('.field-controls').getBoundingClientRect().toJSON(),
  }));

  assert.ok(dimensions.documentWidth <= 390, `page overflows to ${dimensions.documentWidth}px`);
  assert.ok(dimensions.viewportWidth > 250);
  assert.ok(dimensions.viewportHeight >= 350);
  assert.ok(dimensions.controls.left >= 56 && dimensions.controls.right <= 390);
  await page.locator('[data-select-object="fan-1"]').click();
  await page.locator('#show-airflow').click();
  await page.waitForFunction(() => document.querySelector('#room-canvas')?.dataset.fieldMode === 'airflow');
  const legendWithinViewport = await page.evaluate(() => {
    const viewport = document.querySelector('#viewport').getBoundingClientRect();
    const legend = document.querySelector('#field-legend').getBoundingClientRect();
    return legend.left >= viewport.left && legend.right <= viewport.right
      && legend.top >= viewport.top && legend.bottom <= viewport.bottom;
  });
  assert.equal(legendWithinViewport, true, 'field legend must remain inside the mobile viewport');
});

test('hovering over a scene object highlights it without selecting it', async () => {
  const canvas = page.locator('#room-canvas');
  const bounds = await canvas.boundingBox();
  const point = fanScreenPoint(bounds);
  const row = page.locator('[data-select-object="fan-1"]');

  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => document.querySelector('#room-canvas')?.dataset.hoveredObject === 'fan-1');
  assert.equal(await row.getAttribute('aria-pressed'), 'false');
  await page.mouse.move(bounds.x + bounds.width - 12, bounds.y + bounds.height - 12);
  await page.waitForFunction(() => !document.querySelector('#room-canvas')?.dataset.hoveredObject);
});

test('top view can be orbited after selecting it from the camera menu', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#viewport canvas').first().waitFor();
  await page.waitForTimeout(250);
  await page.locator('#camera-view-picker-button').click();
  await page.locator('#camera-view-top').click();
  const canvas = page.locator('#room-canvas');
  const bounds = await canvas.boundingBox();
  const before = await canvas.screenshot();
  const start = { x: bounds.x + 34, y: bounds.y + bounds.height * 0.52 };

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 115, start.y + 32, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  assert.equal((await canvas.screenshot()).equals(before), false, 'top view should orbit from a drag');
});

test('rotation inspector edits all three Euler axes independently', async () => {
  await page.locator('[data-select-object="sofa-2"]').click();
  for (const [axis, degrees] of [['x', 20], ['y', 45], ['z', -30]]) {
    const input = page.locator(`[data-rotation="${axis}"]`);
    await input.fill(String(degrees));
    await input.blur();
    assert.equal(await page.locator(`[data-rotation="${axis}"]`).inputValue(), `${degrees}.00`);
  }
});

test('rotate gizmo exposes X and Z axes as well as Y', async () => {
  const canvas = page.locator('#room-canvas');
  const bounds = await canvas.boundingBox();
  const center = fanScreenPoint(bounds);
  const distance = Math.max(5.2, 4) * 1.35;
  const cameraPosition = [distance * 0.88, distance * 0.7, distance * 0.96];
  const cameraDistance = Math.hypot(...cameraPosition.map((value, axis) => value - fanCenterWorld[axis]));
  const ringRadius = cameraDistance * 1.9 * Math.tan(42 * Math.PI / 360) * 0.8 * 0.5 / 4;
  await page.mouse.click(center.x, center.y);
  await page.keyboard.press('r');
  assert.equal(await page.locator('#transform-mode-toggle').getAttribute('aria-pressed'), 'true');

  for (const [axis, startPoint, endPoint] of [
    ['x', rotationRingPoint('x', Math.PI / 4, ringRadius), rotationRingPoint('x', Math.PI * 4 / 9, ringRadius)],
    ['z', rotationRingPoint('z', Math.PI / 4, ringRadius), rotationRingPoint('z', Math.PI * 4 / 9, ringRadius)],
  ]) {
    const start = roomScreenPoint(bounds, startPoint);
    const end = roomScreenPoint(bounds, endPoint);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.up();
    try {
      await page.waitForFunction(
        (rotationAxis) => Math.abs(Number(document.querySelector(`[data-rotation="${rotationAxis}"]`)?.value ?? 0)) > 1,
        axis,
        { timeout: 1000 },
      );
    } catch {
      const values = await page.locator('[data-rotation]').evaluateAll((inputs) => Object.fromEntries(inputs.map((input) => [input.dataset.rotation, input.value])));
      assert.fail(`rotation around ${axis.toUpperCase()} did not change: ${JSON.stringify(values)}`);
    }
    assert.ok(Math.abs(Number(await page.locator(`[data-rotation="${axis}"]`).inputValue())) > 1);
  }
});
