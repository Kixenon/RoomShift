import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Covers the time-of-day controls end to end. The clock, the lamp override and
// the sun patches are driven through the real DOM, so this catches wiring that
// the unit tests cannot see.

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
  await page.goto(baseUrl, { waitUntil: 'load' });
  await page.waitForSelector('#room-canvas');
});

test.after(async () => {
  await browser?.close();
  await server?.close();
  assert.deepEqual(browserErrors, [], `browser reported errors: ${browserErrors.join('; ')}`);
});

const canvasState = () => page.evaluate(() => {
  const data = document.querySelector('#room-canvas').dataset;
  return {
    mode: data.fieldMode,
    clock: data.clockTime,
    altitude: Number(data.sunAltitude),
    azimuth: Number(data.sunAzimuth),
    lampsOn: data.lampsOn,
    patches: Number(data.sunPatches),
  };
});

const setClock = async (minutes) => {
  await page.evaluate((value) => {
    const slider = document.querySelector('#time-of-day');
    slider.value = String(value);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, minutes);
  await page.waitForTimeout(220);
};

// Range inputs do not respond to locator.fill(), so the slider is driven the way
// a drag would: set the value and dispatch the event.
test('the time controls only appear while the light preview is up', async () => {
  assert.equal(await page.evaluate(() => document.querySelector('#time-controls').hidden), true);

  await page.locator('#show-airflow').click();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.querySelector('#time-controls').hidden), true,
    'airflow has no time of day');

  await page.locator('#show-light').click();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.querySelector('#time-controls').hidden), false);

  await page.locator('#show-airflow').click();
  await page.waitForTimeout(600);
  assert.equal(await page.evaluate(() => document.querySelector('#time-controls').hidden), true);
});

test('the clock reads a plausible solar altitude for Hong Kong', async () => {
  await page.locator('#show-light').click();
  await page.waitForTimeout(800);

  // Solar noon in Hong Kong is around 12:31 local, not 12:00, because the clock
  // zone meridian sits east of the site. Compare against that, not clock noon.
  await setClock(12 * 60 + 30);
  const midday = await canvasState();
  assert.equal(midday.clock, '12:30');
  assert.equal(midday.mode, 'light');
  assert.ok(midday.altitude > 60, `midday altitude was ${midday.altitude}`);
  assert.ok(Math.abs(midday.azimuth - 180) < 6, `midday azimuth was ${midday.azimuth}`);

  // An hour later the sun has swung well past south.
  await setClock(13 * 60 + 30);
  const later = await canvasState();
  assert.equal(later.clock, '13:30');
  assert.ok(later.azimuth > 200, `13:30 azimuth was ${later.azimuth}`);

  await setClock(6 * 60 + 30);
  const dawn = await canvasState();
  assert.ok(dawn.altitude < 5, `pre-dawn altitude was ${dawn.altitude}`);
  assert.ok(dawn.altitude > -12, `pre-dawn altitude was ${dawn.altitude}`);
});

test('the clock label follows the slider', async () => {
  for (const [minutes, label] of [[0, '00:00'], [9 * 60 + 5, '09:05'], [23 * 60 + 55, '23:55']]) {
    await setClock(minutes);
    assert.equal(await page.locator('#clock-label').textContent(), label);
  }
});

test('the sun sweeps across the compass through the day', async () => {
  await setClock(9 * 60);
  const morning = await canvasState();
  await setClock(16 * 60);
  const afternoon = await canvasState();

  assert.ok(morning.azimuth > 60 && morning.azimuth < 130, `morning azimuth was ${morning.azimuth}`);
  assert.ok(afternoon.azimuth > 240, `afternoon azimuth was ${afternoon.azimuth}`);
  assert.ok(morning.altitude > 0 && afternoon.altitude > 0);
});

test('the lamp button is a plain on and off switch', async () => {
  await setClock(13 * 60);
  assert.equal((await canvasState()).lampsOn, 'false');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'false');

  // Switch them on during the day.
  await page.locator('#lamps-toggle').click();
  await page.waitForTimeout(220);
  assert.equal((await canvasState()).lampsOn, 'true');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'true');

  // A manual choice survives a change of time in either direction.
  await setClock(22 * 60);
  assert.equal((await canvasState()).lampsOn, 'true');

  // And now the important half: at night, with the lamps lit, the switch turns
  // them off rather than only ever being able to force them on.
  await page.locator('#lamps-toggle').click();
  await page.waitForTimeout(220);
  assert.equal((await canvasState()).lampsOn, 'false');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'false');

  await setClock(13 * 60);
  assert.equal((await canvasState()).lampsOn, 'false', 'the switch stays off through the day');

  await page.locator('#lamps-toggle').click();
  await page.waitForTimeout(220);
  assert.equal((await canvasState()).lampsOn, 'true');
});

test('the lamp button follows dusk until it is touched', async () => {
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#room-canvas');
  await page.locator('#show-light').click();
  await page.waitForTimeout(800);

  await setClock(13 * 60);
  assert.equal((await canvasState()).lampsOn, 'false');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'false');

  // Crossing dusk lights the lamps and the button reflects it with no click.
  await setClock(22 * 60);
  assert.equal((await canvasState()).lampsOn, 'true');
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-pressed'), 'true');

  // The button explains whether the state came from dusk or from the user.
  assert.match(await page.locator('#lamps-toggle').getAttribute('title'), /following dusk/);
  assert.equal(await page.locator('#lamps-toggle').getAttribute('aria-label'), 'Switch the lamps off');
});

test('a closed window casts no sun patch but an open sunward one does', async () => {
  await setClock(10 * 60);
  assert.equal((await canvasState()).patches, 0, 'the default scene has no windows');

  await page.locator('#add-window').click();
  await page.locator('[data-window-wall]').selectOption('back');
  await page.locator('[data-window-open]').check();
  await page.waitForTimeout(500);
  assert.equal((await canvasState()).patches, 1, 'an open sunward window should throw a patch');

  await page.locator('[data-window-open]').uncheck();
  await page.waitForTimeout(500);
  assert.equal((await canvasState()).patches, 0, 'a closed window should not');
});

test('a shaded wall casts no patch at the same moment', async () => {
  // 10:00 puts the sun in the east-south-east, so the north wall is in shade.
  await setClock(10 * 60);
  await page.locator('[data-window-wall]').selectOption('front');
  await page.locator('[data-window-open]').check();
  await page.waitForTimeout(500);
  assert.equal((await canvasState()).patches, 0);
});

test('the daylight dataset is cleared when the preview closes', async () => {
  await page.locator('#show-airflow').click();
  await page.waitForTimeout(700);
  const data = await page.evaluate(() => {
    const canvas = document.querySelector('#room-canvas');
    return {
      clock: canvas.dataset.clockTime,
      altitude: canvas.dataset.sunAltitude,
      patches: canvas.dataset.sunPatches,
    };
  });
  assert.deepEqual(data, { clock: undefined, altitude: undefined, patches: undefined });
});

test('the time controls sit clear of their neighbours', async () => {
  await page.locator('#show-light').click();
  await page.waitForTimeout(700);
  const boxes = await page.evaluate(() => {
    const box = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    };
    return {
      controls: box('#time-controls'),
      lightButton: box('#show-light'),
      statusText: document.querySelector('#field-status').textContent,
      statusVisible: getComputedStyle(document.querySelector('#field-status')).display !== 'none',
    };
  });

  // Idle light mode has nothing to say, so the status collapses out of the way.
  assert.equal(boxes.statusText, '', `idle status was "${boxes.statusText}"`);
  assert.equal(boxes.statusVisible, false, 'an empty status should not take up room');

  // The clock group follows the Light button without colliding with it.
  assert.ok(boxes.controls.left >= boxes.lightButton.right,
    `controls start at ${boxes.controls.left} but the Light button ends at ${boxes.lightButton.right}`);
  assert.ok(boxes.controls.right > boxes.controls.left, 'the controls have width');
});

test('the clock label is legible against the toolbar', async () => {
  const contrast = await page.evaluate(() => {
    const clock = document.querySelector('#clock-label');
    const style = getComputedStyle(clock);
    return { colour: style.color, opacity: style.opacity, size: parseFloat(style.fontSize) };
  });
  const channels = contrast.colour.match(/\d+/g)?.map(Number) ?? [];
  assert.equal(contrast.opacity, '1', 'the clock must not be faded out');
  assert.ok(contrast.size >= 9, `clock font was ${contrast.size}px`);
  // Relative luminance, to catch a colour that is technically set but invisible.
  const [r, g, b] = channels.slice(0, 3).map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(luminance < 0.5, `clock colour ${contrast.colour} is too light on a light toolbar`);
});