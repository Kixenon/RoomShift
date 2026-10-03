// Records slow camera orbits of real solved rooms as frame sequences, then encodes MP4 + WebM.
// Usage: node site/scripts/record-orbits.mjs <editor-root> <name> <layer> [layout]
//   layer: air | heat | light | room    layout: a | b
import { mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const [root = '.', name = 'orbit-air', layer = 'air', layout = 'a'] = process.argv.slice(2);
const frames = Number(process.env.FRAMES ?? 150);
const frameDir = path.resolve('site/captures/frames', name);
await rm(frameDir, { recursive: true, force: true });
await mkdir(frameDir, { recursive: true });
await mkdir('site/media', { recursive: true });

const server = await createServer({ configFile: false, logLevel: 'error', root: path.resolve(root), server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const url = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('#viewport canvas').first().waitFor();
await page.addStyleTag({ content: '.viewport-topline, .field-legend { opacity: 0 !important; }' });

async function place(label, values) {
  await page.locator('.object-row', { hasText: label }).click();
  for (const [selector, value] of Object.entries(values)) {
    const input = page.locator(`#object-properties ${selector}`);
    await input.fill(String(value));
    await input.dispatchEvent('change');
    await page.waitForTimeout(80);
  }
}
if (layout === 'b') {
  await place('Pedestal fan', { '[data-position="x"]': 2.2, '[data-position="z"]': 0.7, '[data-rotation="y"]': 90 });
  await place('Panel heater', { '[data-position="x"]': 2.9, '[data-position="z"]': 3.7 });
  await place('Floor lamp', { '[data-position="x"]': 4.95, '[data-position="z"]': 1.6 });
  await place('Coffee table', { '[data-position="x"]': 4.18, '[data-position="z"]': 2.2 });
}
await page.mouse.click(260, 960);
await page.waitForTimeout(300);
const buttons = { air: '#show-airflow', heat: '#show-temperature', light: '#show-light' };
if (buttons[layer]) {
  await page.click(buttons[layer]);
  await page.waitForFunction(() => !/Solving|Preparing/.test(document.querySelector('#field-status')?.textContent ?? ''), null, { timeout: 120000 });
  await page.waitForTimeout(2500);
}

// Orbit: a slow horizontal drag across the canvas, one small step per frame.
const viewport = await page.locator('#viewport').boundingBox();
const startX = viewport.x + viewport.width * 0.3;
const y = viewport.y + viewport.height * 0.55;
const travel = Number(process.env.TRAVEL ?? 260);
await page.mouse.move(startX, y);
await page.mouse.down();
for (let frame = 0; frame < frames; frame += 1) {
  const t = frame / (frames - 1);
  const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  await page.mouse.move(startX + travel * eased, y);
  await page.waitForTimeout(16);
  await page.locator('#viewport').screenshot({ path: path.join(frameDir, `${String(frame).padStart(4, '0')}.png`) });
}
await page.mouse.up();
await browser.close();
await server.close();

// Crop to the room, encode both formats.
const crop = 'crop=iw*0.84:ih*0.86:iw*0.08:ih*0.1,scale=1600:-2';
const input = ['-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(frameDir, '%04d.png'), '-vf', crop];
execFileSync('ffmpeg', [...input, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', `site/media/${name}.mp4`]);
execFileSync('ffmpeg', [...input, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-row-mt', '1', `site/media/${name}.webm`]);
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(frameDir, '0000.png'), '-vf', crop, '-frames:v', '1', '-q:v', '4', `/tmp/${name}-poster.png`]);
execFileSync('cwebp', ['-quiet', '-q', '78', `/tmp/${name}-poster.png`, '-o', `site/media/${name}-poster.webp`]);
console.log('recorded', name);
