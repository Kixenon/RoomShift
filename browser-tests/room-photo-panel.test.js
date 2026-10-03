import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { renderSyntheticRoom } from './png-fixture.js';

// Drives the real panel in a real browser with a real image file. No WebGL is
// involved, so unlike the interaction suite this runs anywhere Chromium does.

const root = fileURLToPath(new URL('..', import.meta.url));
const browserExecutable = process.env.ROOMSHIFT_BROWSER || undefined;

let server;
let browser;
let page;
let baseUrl;
let browserErrors = [];

test.before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'error',
    root,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: browserExecutable, headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${message.text()} @ ${message.location().url}`);
  });
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.locator('#from-photo').click();
  await page.locator('.photo-panel').waitFor({ state: 'visible' });
});

test.after(async () => {
  await browser?.close();
  await server?.close();
  assert.deepEqual(browserErrors, [], `browser reported errors: ${browserErrors.join('; ')}`);
});

const fixture = renderSyntheticRoom();

const panel = () => page.evaluate(() => {
  const root = document.querySelector('.photo-panel');
  return {
    open: !root.hidden,
    readoutVisible: !root.querySelector('[data-photo-readout]').hidden,
    width: root.querySelector('[data-photo-width]').textContent,
    depth: root.querySelector('[data-photo-depth]').textContent,
    height: root.querySelector('[data-photo-height]').textContent,
    warnings: [...root.querySelector('[data-photo-warnings]').children].map((li) => li.textContent),
    wallOptions: [...root.querySelector('[data-photo-wall]').options].map((o) => o.value),
    error: root.querySelector('[data-photo-error]').hidden
      ? null
      : root.querySelector('[data-photo-error]').textContent,
    horizonNote: root.querySelector('[data-photo-horizon]').textContent,
  };
});

// Drive the panel's own state through the hooks it exposes for tests, using the
// exact pixel positions a user would click in the fixture image.
async function placePoints({
  corners = fixture.floorCorners,
  ceilingPoint = fixture.ceilingPoint,
  preferredWall = 'a-far',
  horizonRow = fixture.horizonRow,
} = {}) {
  await page.evaluate(async (input) => {
    // Same module URL the editor imports, so this is the same panel instance.
    const module = await import('/src/scene/room-photo-panel.js');
    const panel = module.getActivePhotoPanel();
    // The panel asks the user to confirm the horizon before trusting the
    // numbers, so the fixture's true horizon is supplied here as the drag would.
    panel.setHorizonForTest(input.horizonRow);
    panel.setPointsForTest(input);
  }, { corners, ceilingPoint, preferredWall, horizonRow });
}

test('the panel opens from the asset rail with no photo loaded', async () => {
  const state = await panel();
  assert.equal(state.open, true);
  assert.equal(state.readoutVisible, false);
  assert.match(state.horizonNote, /^$/);
});

test('loading a photo estimates a horizon near the true one', async () => {
  await page.locator('[data-photo-file]').setInputFiles({
    name: 'room.png',
    mimeType: 'image/png',
    buffer: fixture.png,
  });
  await page.waitForFunction(
    () => /Estimated horizon/.test(document.querySelector('[data-photo-horizon]')?.textContent ?? ''),
  );

  const state = await panel();
  assert.match(state.horizonNote, /Estimated horizon at row/);
  const row = Number(state.horizonNote.match(/row (\d+)/)[1]);
  assert.ok(Math.abs(row - fixture.horizonRow) < 12,
    `horizon row was ${row}, expected about ${fixture.horizonRow}`);
  assert.equal(state.readoutVisible, false, 'no estimate before the corners are placed');
});

test('five clicks and a camera height produce the room dimensions', async () => {
  await placePoints();
  const state = await panel();
  assert.equal(state.readoutVisible, true);
  assert.equal(state.error, null);

  const metres = (text) => Number.parseFloat(text);
  // The longer footprint side lands on width, as in the model.
  assert.ok(Math.abs(metres(state.width) - fixture.room.depth) < 0.1, `width was ${state.width}`);
  assert.ok(Math.abs(metres(state.depth) - fixture.room.width) < 0.1, `depth was ${state.depth}`);
  assert.ok(Math.abs(metres(state.height) - fixture.room.height) < 0.1, `height was ${state.height}`);
});

test('the wall can be chosen explicitly instead of trusting the prior', async () => {
  await page.locator('[data-photo-wall]').selectOption('a-far');
  await page.waitForTimeout(120);
  const state = await panel();
  assert.ok(state.wallOptions.includes('a-far'));
  assert.ok(state.wallOptions.length >= 2, 'rival wall readings must be offered');
  assert.ok(Math.abs(Number.parseFloat(state.height) - fixture.room.height) < 0.1, `height was ${state.height}`);
});

test('changing the camera-height reference rescales the estimate', async () => {
  await page.locator('[data-photo-camera-height]').fill('0.8');
  await page.waitForTimeout(120);
  const halved = await panel();
  const halvedWidth = Number.parseFloat(halved.width);
  assert.ok(Math.abs(halvedWidth - fixture.room.depth * 0.5) < 0.12, `width was ${halvedWidth}`);

  await page.locator('[data-photo-camera-height]').fill('1.6');
  await page.waitForTimeout(120);
  const restored = await panel();
  assert.ok(Math.abs(Number.parseFloat(restored.width) - fixture.room.depth) < 0.1);
});

test('applying writes the dimensions into the room and closes the panel', async () => {
  const before = await page.locator('#room-summary').textContent();
  await page.locator('[data-photo-apply]').click();
  await page.waitForFunction(() => document.querySelector('.photo-panel').hidden);
  const after = await page.locator('#room-summary').textContent();

  assert.notEqual(after, before);
  assert.match(after, /4\.4|5\.5/, `summary was ${after}`);
  assert.equal(Number(await page.locator('#room-width').inputValue()), 5.5);
  assert.equal(Number(await page.locator('#room-depth').inputValue()), 4.4);
  assert.equal(Number(await page.locator('#room-height').inputValue()), 2.6);
});

test('applying is a single undo step', async () => {
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#room-width').inputValue(), '5.2');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(200);
  assert.equal(Number(await page.locator('#room-width').inputValue()), 5.5);
});

test('the panel can be closed again', async () => {
  await page.locator('#from-photo').click();
  await page.waitForFunction(() => !document.querySelector('.photo-panel').hidden);
  await page.locator('[data-photo-close]').click();
  assert.equal(await page.evaluate(() => document.querySelector('.photo-panel').hidden), true);
});
