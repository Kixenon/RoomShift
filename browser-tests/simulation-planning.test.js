import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

let server, browser, url;
test.before(async () => {
  server = await createServer({ configFile: false, logLevel: 'error', root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: `/tmp/roomshift-vite-${process.pid}`, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.ROOMSHIFT_BROWSER, headless: true, args: ['--enable-unsafe-webgpu', ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])] });
});
test.after(async () => { await browser?.close(); await server?.close(); });

const settled = (page, seconds) => page.waitForFunction((seconds) => {
  const canvas = document.querySelector('#room-canvas');
  return Number(canvas?.dataset.fieldDuration) === seconds && document.querySelector('#field-loading').hidden;
}, seconds);
const setTime = (page, seconds) => page.locator('#simulation-time').evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, String(seconds));

test('elapsed time, mode reuse, baseline comparison, and saved scenarios work together', async () => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await page.locator('#show-airflow').click();
    await settled(page, 3);
    assert.equal(await page.locator('#field-display-label').textContent(), 'Volume');
    await page.locator('#scenario-storage summary').click();
    await page.locator('#capture-baseline').click();
    await settled(page, 3);
    assert.match(await page.locator('#comparison-reading').textContent(), /\+0\.000 m\/s/);
    await page.locator('[data-select-object="fan-1"]').click();
    await page.locator('[data-device-enabled]').uncheck();
    await settled(page, 3);
    await page.locator('#show-temperature').click();
    await page.locator('#probe-control summary').click();
    await settled(page, 3);
    assert.match(await page.locator('#probe-reading').textContent(), /°C/);
    assert.equal(await page.locator('#field-legend-min').textContent(), '10.0 °C');
    await setTime(page, 1);
    await settled(page, 1);
    await setTime(page, 3);
    await settled(page, 3);
    assert.match(await page.locator('#simulation-status').textContent(), /Showing 3\.0 s/);
    await page.locator('#scenario-storage summary').click();
    await page.locator('#scenario-name').fill('Fan off');
    await page.locator('#save-scenario').click();
    await page.reload();
    assert.match(await page.locator('#saved-scenarios').textContent(), /Fan off/);
    await page.locator('[data-select-object="fan-1"]').click();
    assert.equal(await page.locator('[data-device-enabled]').isChecked(), false);
    await page.locator('#scenario-storage summary').click();
    await page.locator('#restore-baseline').click();
    await page.locator('[data-select-object="fan-1"]').click();
    assert.equal(await page.locator('[data-device-enabled]').isChecked(), true);
    await page.locator('#scenario-storage summary').click();
    await page.locator('#saved-scenarios').selectOption('0');
    await page.locator('#load-scenario').click();
    await page.locator('[data-select-object="fan-1"]').click();
    assert.equal(await page.locator('[data-device-enabled]').isChecked(), false);
    await page.locator('#scenario-storage summary').click();
    await page.locator('#delete-scenario').click();
    assert.doesNotMatch(await page.locator('#saved-scenarios').textContent(), /Fan off/);
    await page.locator('#scenario-storage summary').click();
    await page.locator('#reset-room').click();
    await page.locator('[data-select-object="fan-1"]').click();
    assert.equal(await page.locator('[data-device-enabled]').isChecked(), true);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('CPU and WebGPU match for driven air and subzero window inflow', async (t) => {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    if (!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()))) { t.skip('WebGPU adapter unavailable'); return; }
    const cases = await page.evaluate(async () => {
      const { createRoomScene, addWindow } = await import('/src/model/room-scene.js');
      const { simulateRoomFields } = await import('/src/simulation/room-fields-3d.js');
      const { simulateRoomFieldsWebGpu } = await import('/src/simulation/room-fields-webgpu.js');
      const template = createRoomScene();
      const cold = addWindow({ ...template, room: { ...template.room, outdoorTemperature: -10 }, objects: [] }, 'front').scene;
      const results = [];
      for (const scene of [template, cold]) {
        const options = { steps: 20 };
        const cpu = simulateRoomFields(scene, options), gpu = await simulateRoomFieldsWebGpu(scene, options);
        const maximum = {};
        for (const key of ['u', 'v', 'w', 'temperature']) {
          maximum[key] = 0;
          for (let id = 0; id < cpu.fields[key].length; id += 1) maximum[key] = Math.max(maximum[key], Math.abs(cpu.fields[key][id] - gpu.fields[key][id]));
        }
        results.push({ maximum, cpuMin: cpu.stats.minTemperature, gpuMin: gpu.stats.minTemperature, gridMatch: JSON.stringify(cpu.grid) === JSON.stringify(gpu.grid) });
      }
      return results;
    });
    for (const result of cases) {
      assert.equal(result.gridMatch, true);
      for (const [field, difference] of Object.entries(result.maximum)) assert.ok(difference < 0.001, `${field}: ${difference}`);
    }
    assert.equal(cases[1].cpuMin, -10);
    assert.equal(cases[1].gpuMin, -10);
  } finally { await page.close(); }
});


test('compact controls support keyboard detail selection, buffered playback, and Wi-Fi', async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await page.locator('#show-temperature').click();
    await settled(page, 3);
    assert.equal(await page.locator('#simulation-status').isVisible(), false);
    assert.equal(await page.locator('#initial-temperature').isVisible(), false);
    await page.locator('#resolution-control summary').focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('[data-resolution="0.25"]').evaluate((button) => button === document.activeElement), true);
    await page.keyboard.press('Enter');
    await settled(page, 3);
    assert.equal(await page.locator('[data-resolution="0.25"]').getAttribute('aria-checked'), 'true');
    await page.locator('#simulation-play').click();
    await page.waitForFunction(() => Number(document.querySelector('#room-canvas').dataset.fieldDuration) >= 4);
    await page.locator('#simulation-play').click();
    const stoppedAt = await page.locator('#simulation-time').inputValue();
    await page.waitForTimeout(700);
    assert.equal(await page.locator('#simulation-time').inputValue(), stoppedAt);
    assert.equal(await page.locator('#simulation-play').getAttribute('aria-pressed'), 'false');
    await page.locator('#simulation-restart').click();
    await settled(page, 0);
    await page.locator('#probe-control summary').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#probe-control').evaluate((menu) => menu.open), false);
    await page.locator('#show-wifi').click();
    await page.waitForFunction(() => document.querySelector('#room-canvas').dataset.fieldMode === 'wifi' && document.querySelector('#field-loading').hidden);
    assert.equal(await page.locator('#field-display-label').textContent(), 'Volume');
    assert.equal(await page.locator('#simulation-settings').isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
