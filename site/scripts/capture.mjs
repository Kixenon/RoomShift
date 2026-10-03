// Captures real editor screenshots for the launch site.
// Usage: node site/scripts/capture.mjs <editor-root> <out-dir> [prefix]
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [root = '.', outDir = 'site/public/shots', prefix = 'main'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });

const server = await createServer({ configFile: false, logLevel: 'error', root: path.resolve(root), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}`;

const browser = await chromium.launch({
  executablePath: process.env.ROOMSHIFT_BROWSER || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: process.env.HEADED ? false : true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPU', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });

async function fresh() {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('#viewport canvas').first().waitFor();
  await page.waitForTimeout(800);
}
async function waitSolved() {
  await page.waitForFunction(() => !/Solving|Preparing/.test(document.querySelector('#field-status')?.textContent ?? ''), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
}
async function legendText() {
  return page.evaluate(() => ['#field-legend-title', '#field-legend-min', '#field-legend-max'].map((s) => document.querySelector(s)?.textContent).join(' | '));
}
async function shot(name, { viewportOnly = true } = {}) {
  const target = viewportOnly ? page.locator('#viewport') : page;
  await target.screenshot({ path: path.join(outDir, `${prefix}-${name}.png`) });
  console.log('saved', name, await legendText());
}

await fresh();
console.log('webgpu:', await page.evaluate(() => Boolean(navigator.gpu)));
await shot('app', { viewportOnly: false });
await page.addStyleTag({ content: '.viewport-topline, .field-legend { opacity: 0 !important; }' });
await shot('room');
await page.click('#show-airflow'); await waitSolved();
console.log('status:', await page.locator('#field-status').textContent(), await page.locator('#field-legend-title').textContent().catch(() => ''));
await shot('air');
await page.click('#show-temperature'); await waitSolved(); await shot('heat');
await page.click('#show-light'); await page.waitForTimeout(2000); await shot('light');
await page.click('#show-light'); await page.waitForTimeout(400);
await page.click('#view-top'); await page.waitForTimeout(1200); await shot('top');
await page.click('#show-airflow'); await waitSolved(); await shot('top-air');
await page.click('#show-temperature'); await waitSolved(); await shot('top-heat');

await browser.close();
await server.close();
