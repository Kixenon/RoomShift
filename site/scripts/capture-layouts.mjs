// Captures the same room under two furniture arrangements, solved by the real editor.
// Usage: node site/scripts/capture-layouts.mjs <editor-root> <out-dir>
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [root = '.', outDir = 'site/public/shots'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });

const server = await createServer({ configFile: false, logLevel: 'error', root: path.resolve(root), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  executablePath: process.env.ROOMSHIFT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });

async function place(name, values) {
  await page.locator('.object-row', { hasText: name }).click();
  for (const [selector, value] of Object.entries(values)) {
    const input = page.locator(`#object-properties ${selector}`);
    await input.fill(String(value));
    await input.dispatchEvent('change');
    await page.waitForTimeout(80);
  }
}
async function deselect() {
  await page.keyboard.press('Escape');
  await page.mouse.click(260, 960);
  await page.waitForTimeout(300);
}
async function waitSolved() {
  await page.waitForFunction(() => !/Solving|Preparing/.test(document.querySelector('#field-status')?.textContent ?? ''), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
}
async function captureAll(prefix) {
  const shot = async (name) => {
    await page.locator('#viewport').screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
    console.log(prefix, name, await page.evaluate(() => ['#field-legend-title', '#field-legend-min', '#field-legend-max'].map((s) => document.querySelector(s)?.textContent).join(' | ')));
  };
  await page.click('#view-top'); await page.waitForTimeout(1000);
  await shot('top');
  await page.click('#show-airflow'); await waitSolved(); await shot('top-air');
  await page.click('#show-temperature'); await waitSolved(); await shot('top-heat');
  await page.click('#show-temperature');
  await page.click('#view-3d'); await page.waitForTimeout(1000);
  await page.click('#show-airflow'); await waitSolved(); await shot('air');
  await page.click('#show-light'); await page.waitForTimeout(2000); await shot('light');
  await page.click('#show-light');
  console.log('captured', prefix);
}

// Layout A: the editor's default living room.
await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('#viewport canvas').first().waitFor();
await page.addStyleTag({ content: '.viewport-topline, .field-legend { opacity: 0 !important; }' });
await captureAll('layout-a');

// Layout B: fan aimed across the desk, heater moved beside the sofa, lamp over the desk.
await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('#viewport canvas').first().waitFor();
await page.addStyleTag({ content: '.viewport-topline, .field-legend { opacity: 0 !important; }' });
await place('Pedestal fan', { '[data-position="x"]': 2.2, '[data-position="z"]': 0.7, '[data-rotation="y"]': process.env.FAN_RY ?? 90 });
await place('Panel heater', { '[data-position="x"]': 2.9, '[data-position="z"]': 3.7 });
await place('Floor lamp', { '[data-position="x"]': 4.95, '[data-position="z"]': 1.6 });
await place('Coffee table', { '[data-position="x"]': 4.18, '[data-position="z"]': 2.2 });
await deselect();
await captureAll('layout-b');

await browser.close();
await server.close();
