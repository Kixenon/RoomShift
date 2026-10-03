import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Covers the time-of-day controls end to end on the lenses UI: the sun dock,
// the lamp switch and the daylight dataset are driven through the real DOM, so
// this catches wiring that the unit tests cannot see. The default project is
// Hong Kong on 15 July, where 20:00 is safely past sunset.

const root = fileURLToPath(new URL('..', import.meta.url));
const browserExecutable = process.env.ROOMSHIFT_BROWSER || undefined;

let server;
let browser;
let page;
let browserErrors = [];

test.before(async () => {
  server = await createServer({
    configFile: false,
    logLevel: 'error',
    root,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await server.listen();
  const baseUrl = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: browserExecutable, headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(`${message.text()} @ ${message.location().url}`);
  });
  await page.goto(`${baseUrl}#/p/demo`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#viewport canvas');
});

test.after(async () => {
  await browser?.close();
  await server?.close();
});

test.afterEach(() => {
  assert.deepEqual(browserErrors, [], `browser console errors: ${browserErrors.join('; ')}`);
});

const canvasState = () => page.evaluate(() => {
  const data = document.querySelector('#viewport canvas').dataset;
  return {
    preview: data.lightingPreview,
    clock: data.clockTime,
    altitude: data.sunAltitude === undefined ? undefined : Number(data.sunAltitude),
    lampsOn: data.lampsOn,
    shafts: data.sunShafts === undefined ? undefined : Number(data.sunShafts),
  };
});

// Lens buttons toggle, so opening the light lens must be conditional: a click
// while it is already up would close it again.
const openLightLens = async () => {
  if (await page.evaluate(() => document.body.dataset.lens) !== 'light') {
    await page.locator('#show-light').click();
    await page.waitForTimeout(400);
  }
};

// Range inputs do not respond to locator.fill(), so the slider is driven the way
// a drag would: set the value and dispatch the event.
const setHour = async (hour) => {
  await page.evaluate((value) => {
    const slider = document.querySelector('#sun-hour');
    slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, hour);
  await page.waitForTimeout(250);
};

test('the sun dock only appears while the light lens is up', async () => {
  assert.equal(await page.evaluate(() => document.querySelector('#sun-dock').hidden), true);
  assert.equal((await canvasState()).preview, undefined);

  await page.locator('#show-light').click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.querySelector('#sun-dock').hidden), false);
  assert.equal((await canvasState()).preview, 'true');

  await page.locator('#lens-clear').click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.querySelector('#sun-dock').hidden), true);
});

test('the clock and the sun info follow the slider', async () => {
  await openLightLens();

  await setHour(12);
  assert.equal(await page.locator('#sun-time').textContent(), '12:00');
  assert.equal((await canvasState()).clock, '12:00');
  assert.match(await page.locator('#sun-info').textContent(), /Sun \d+°/);

  await setHour(20);
  assert.equal(await page.locator('#sun-time').textContent(), '20:00');
  assert.equal(await page.locator('#sun-info').textContent(), 'Night');
});

test('the lamps follow dusk until the switch is touched', async () => {
  await openLightLens();

  await setHour(12);
  assert.equal((await canvasState()).lampsOn, 'false', 'lamps rest at noon');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'false');
  assert.match(await page.locator('#lamps-toggle').getAttribute('title'), /following dusk/);

  await setHour(20);
  assert.equal((await canvasState()).lampsOn, 'true', 'lamps take over after sunset');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'true');
});

test('the lamps switch is a plain on and off switch', async () => {
  await openLightLens();

  // At night the lamps are already on; the switch can turn them off.
  await setHour(20);
  await page.locator('#lamps-toggle').click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal((await canvasState()).lampsOn, 'false');
  assert.match(await page.locator('#lamps-toggle').getAttribute('title'), /set by hand/);

  await page.locator('#lamps-toggle').click();
  await page.waitForTimeout(200);
  assert.equal((await canvasState()).lampsOn, 'true');

  // The hand-set state holds across the clock, even back into daylight.
  await setHour(12);
  assert.equal((await canvasState()).lampsOn, 'true', 'the override outlives dusk');

  await page.locator('#lamps-toggle').click();
  await page.waitForTimeout(200);
  assert.equal((await canvasState()).lampsOn, 'false', 'and it can force a dark room at noon');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-label'), 'Switch the lamps on');
});

test('the daylight dataset is cleared when the lens closes', async () => {
  await openLightLens();
  const lit = await canvasState();
  assert.ok(Number.isFinite(lit.altitude), 'altitude is published while the lens is up');
  assert.ok(lit.shafts >= 0, 'the shaft count is published');

  await page.locator('#show-airflow').click();
  await page.waitForTimeout(400);
  const cleared = await canvasState();
  assert.deepEqual(
    { clock: cleared.clock, altitude: cleared.altitude, lampsOn: cleared.lampsOn, shafts: cleared.shafts },
    { clock: undefined, altitude: undefined, lampsOn: undefined, shafts: undefined },
  );
  await page.locator('#lens-clear').click();
});
