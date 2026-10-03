import { MODEL_PRESETS, addObject, addWindow, moveObject, resizeRoom, rotateObject } from '../model/room-scene.js';

// AI room scan: one photo → room size, furniture, doors and windows, using
// Claude's vision with structured JSON output. The user brings their own API key,
// which stays in this browser (localStorage) and goes only to api.anthropic.com.
// The SDK and zod load on first use so the editor bundle stays small.

const KEY_STORAGE = 'roomshift.anthropicKey';
const FURNITURE_TYPES = Object.entries(MODEL_PRESETS).filter(([, preset]) => !preset.wall).map(([key]) => key);

const PROMPT = `You are measuring a room from one photograph so it can be rebuilt in a 3D planner.

Coordinate system (metres):
- The camera stands near the FRONT wall looking toward the BACK wall.
- x runs from the LEFT wall (x = 0) to the RIGHT wall (x = width).
- z runs from the FRONT wall (z = 0, behind the camera) to the BACK wall (z = depth).
- Object x/z are the centre of its footprint. rotation_deg is the turn about the vertical axis; 0 means the object's front faces the camera (toward the front wall), 180 means it faces the back wall, 90 faces the left wall.

Use standard sizes to set scale: doors are about 2.0–2.1 m tall and 0.8–0.9 m wide, ceilings 2.4–2.8 m, kitchen/desk tops 0.72–0.75 m, single beds 0.9 × 2.0 m, double 1.4 × 1.9 m. Estimate the parts of the room you cannot see from the visible proportions.

List every piece of furniture or appliance you can see, choosing the closest type from the allowed list. Use "box" only when nothing fits. List visible doors and windows with the wall they are on and their centre position along that wall (measured from the left end of the wall as seen from inside the room, facing it).`;

let sdk = null;
async function loadSdk() {
  sdk ??= Promise.all([import('@anthropic-ai/sdk'), import('zod'), import('@anthropic-ai/sdk/helpers/zod')]).then(([anthropic, zod, helper]) => ({
    Anthropic: anthropic.default, z: zod.z, zodOutputFormat: helper.zodOutputFormat,
  }));
  return sdk;
}

function schema(z) {
  return z.object({
    room: z.object({
      width: z.number().describe('Left wall to right wall, metres'),
      depth: z.number().describe('Front wall to back wall, metres'),
      height: z.number().describe('Floor to ceiling, metres'),
    }),
    objects: z.array(z.object({
      type: z.enum(FURNITURE_TYPES),
      name: z.string().describe('Short human name, e.g. "Grey sofa"'),
      width: z.number(),
      depth: z.number(),
      height: z.number(),
      x: z.number(),
      z: z.number(),
      rotation_deg: z.number(),
      color_hex: z.string().describe('Dominant colour as #rrggbb'),
    })),
    openings: z.array(z.object({
      type: z.enum(['window', 'door']),
      wall: z.enum(['back', 'front', 'left', 'right']),
      along: z.number().describe('Centre position along the wall, metres'),
      width: z.number(),
      height: z.number(),
      sill: z.number().describe('Height of the bottom edge above the floor; 0 for doors'),
    })),
    notes: z.string().describe('One or two sentences on what was uncertain'),
  });
}

async function fileToBase64(file) {
  // Downscale so the request stays small; 1568 px on the long edge is plenty.
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1568 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return { data: canvas.toDataURL('image/jpeg', 0.88).split(',')[1], url: canvas.toDataURL('image/jpeg', 0.6) };
}

function productSchema(z) {
  return z.object({
    name: z.string().describe('Product name as sold, short'),
    type: z.enum(FURNITURE_TYPES),
    width: z.number().describe('Metres, left-right when facing its front'),
    depth: z.number().describe('Metres, front-back'),
    height: z.number().describe('Metres'),
    color_hex: z.string().describe('Main visible colour as #rrggbb'),
    material: z.enum(['wood', 'fabric', 'metal', 'glass', 'plastic', 'stone', 'plant']),
    image_url: z.string().describe('Absolute URL of the main product photo, or empty'),
    price: z.string().describe('Price with currency as shown, or empty'),
    notes: z.string().describe('What was measured vs estimated'),
  });
}

const PRODUCT_PROMPT = 'Identify this piece of furniture or equipment so it can be placed at true size in a room planner. Use the published dimensions when available; otherwise estimate from typical sizes and say so in notes. Choose the closest type from the allowed list.';

// A product page (IKEA or any shop) or a product photo → one object at true size.
export async function productWithClaude({ url, file }, apiKey) {
  const { Anthropic, z, zodOutputFormat } = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const content = file
    ? [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: (await fileToBase64(file)).data } }, { type: 'text', text: PRODUCT_PROMPT }]
    : [{ type: 'text', text: `${PRODUCT_PROMPT}\n\nRead the product page with the web_fetch tool: ${url}` }];
  const messages = [{ role: 'user', content }];
  // web_fetch runs on Anthropic's side; a long fetch can pause the turn, so continue it.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await client.messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { format: zodOutputFormat(productSchema(z)) },
      ...(url ? { tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 3 }] } : {}),
      messages,
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined this request.');
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    if (!response.parsed_output) throw new Error('Couldn’t read a product from that. Try the product’s own page or a clearer photo.');
    return response.parsed_output;
  }
  throw new Error('The product page took too long to read.');
}

export async function scanRoomWithClaude(file, apiKey) {
  const { Anthropic, z, zodOutputFormat } = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const image = await fileToBase64(file);
  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    output_config: { effort: 'high', format: zodOutputFormat(schema(z)) },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.data } },
        { type: 'text', text: PROMPT },
      ],
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to analyse this photo.');
  if (!response.parsed_output) throw new Error('Claude did not return a usable layout. Try a wider, brighter photo.');
  return { layout: response.parsed_output, preview: image.url };
}

// Build a RoomShift scene from the structured layout.
export function sceneFromLayout(base, layout) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  let scene = resizeRoom({ ...base, objects: [], nextObjectId: 1, nextWindowId: 1 }, {
    width: clamp(layout.room.width, 2, 20), depth: clamp(layout.room.depth, 2, 20), height: clamp(layout.room.height, 2, 6),
  });
  for (const opening of layout.openings) {
    try {
      const added = addWindow(scene, opening.wall, opening.type);
      const alongX = opening.wall === 'back' || opening.wall === 'front';
      // "along" is measured left-to-right facing the wall from inside.
      const span = alongX ? scene.room.width : scene.room.depth;
      const along = opening.wall === 'back' || opening.wall === 'left' ? opening.along : span - opening.along;
      scene = moveObject(added.scene, added.object.id, alongX ? { x: opening.wall === 'back' ? along : span - along, y: opening.sill } : { z: along, y: opening.sill }).scene;
      scene = { ...scene, objects: scene.objects.map((object) => (object.id === added.object.id ? { ...object, dimensions: { ...object.dimensions, width: clamp(opening.width, 0.4, span - 0.2), height: clamp(opening.height, 0.4, scene.room.height - 0.2) } } : object)) };
    } catch { /* skip an opening that cannot fit */ }
  }
  for (const item of layout.objects) {
    try {
      const dimensions = {
        width: clamp(item.width, 0.1, scene.room.width), depth: clamp(item.depth, 0.1, scene.room.depth), height: clamp(item.height, 0.1, scene.room.height),
      };
      let result = addObject(scene, { model: item.type, name: item.name.slice(0, 80) || MODEL_PRESETS[item.type].label, dimensions });
      if (item.rotation_deg) result = rotateObject(result.scene, result.object.id, { y: item.rotation_deg });
      result = moveObject(result.scene, result.object.id, { x: item.x, z: item.z });
      scene = /^#[0-9a-f]{6}$/i.test(item.color_hex)
        ? { ...result.scene, objects: result.scene.objects.map((object) => (object.id === result.object.id ? { ...object, color: item.color_hex } : object)) }
        : result.scene;
    } catch { /* skip an object that cannot fit */ }
  }
  return scene;
}

export function installAiScan(app) {
  const dialog = document.createElement('dialog');
  dialog.className = 'dialog wide';
  dialog.id = 'ai-scan-dialog';
  dialog.innerHTML = `<div class="dialog-body">
    <h2>AI scan <span class="badge">Claude</span></h2>
    <p class="muted">One photo becomes the whole room: size, furniture, doors and windows. Stand in a corner and capture as much as you can. This sends the photo to Anthropic's API with your key. No key? Use <b>Furniture</b> or <b>3D scan</b> under Photo &amp; scan; they run on your device.</p>
    <label class="field-v"><span>Anthropic API key <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">get one</a></span>
      <input id="ai-key" class="input mono" type="password" placeholder="sk-ant-…" autocomplete="off" /></label>
    <div class="segmented ai-tabs" role="tablist"><button type="button" class="active" data-ai-tab="room">Whole room from a photo</button><button type="button" data-ai-tab="product">One product (link or photo)</button></div>
    <div data-ai-panel="room"><label class="drop-zone" id="ai-drop"><input id="ai-file" type="file" accept="image/*" hidden /><span>Drop a room photo or <u>choose a file</u></span></label></div>
    <div data-ai-panel="product" hidden>
      <div class="field-row ai-link-row"><input id="ai-url" class="input" type="url" placeholder="Paste a product link, e.g. an IKEA page" /><button class="btn" type="button" id="ai-url-go">Read page</button></div>
      <label class="drop-zone small" id="ai-product-drop"><input id="ai-product-file" type="file" accept="image/*" hidden /><span>…or drop a product photo</span></label>
    </div>
    <div id="ai-status"></div>
    <div class="dialog-actions"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="button" id="ai-apply" disabled>Replace room with scan</button></div>
  </div>`;
  document.body.append(dialog);
  const keyInput = dialog.querySelector('#ai-key');
  const status = dialog.querySelector('#ai-status');
  let pending = null;
  dialog.addEventListener('click', (event) => { if (event.target.closest('[data-close]') || event.target === dialog) dialog.close(); });

  async function run(file) {
    if (!file?.type.startsWith('image/')) return;
    const key = keyInput.value.trim();
    if (!key) { status.innerHTML = '<p class="warn-text">Paste your API key first.</p>'; keyInput.focus(); return; }
    try { localStorage.setItem(KEY_STORAGE, key); } catch { /* private mode */ }
    status.innerHTML = '<p class="muted"><span class="spinner"></span> Claude is measuring the room… (20–60 s)</p>';
    dialog.querySelector('#ai-apply').disabled = true;
    try {
      const { layout, preview } = await scanRoomWithClaude(file, key);
      pending = layout;
      status.innerHTML = `<div class="ai-result"><img src="${preview}" alt="" />
        <div><strong class="mono">${layout.room.width.toFixed(2)} × ${layout.room.depth.toFixed(2)} × ${layout.room.height.toFixed(2)} m</strong>
        <ul>${layout.objects.map((item) => `<li><span class="swatch-dot" style="background:${item.color_hex}"></span>${item.name} <span class="muted">${MODEL_PRESETS[item.type].label} · ${item.width.toFixed(2)}×${item.depth.toFixed(2)} m</span></li>`).join('')}
        ${layout.openings.map((item) => `<li>${item.type === 'door' ? '⌸' : '▣'} ${item.type} on the ${item.wall} wall <span class="muted">${item.width.toFixed(2)} m wide</span></li>`).join('')}</ul>
        <p class="note">${layout.notes}</p></div></div>`;
      dialog.querySelector('#ai-apply').disabled = false;
    } catch (error) {
      status.innerHTML = `<p class="warn-text">${error.status === 401 ? 'That API key was rejected.' : error.message}</p>`;
    }
  }
  dialog.querySelector('#ai-file').addEventListener('change', (event) => run(event.target.files[0]));
  dialog.querySelector('.ai-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-ai-tab]');
    if (!tab) return;
    for (const item of dialog.querySelectorAll('[data-ai-tab]')) item.classList.toggle('active', item === tab);
    for (const panel of dialog.querySelectorAll('[data-ai-panel]')) panel.hidden = panel.dataset.aiPanel !== tab.dataset.aiTab;
    dialog.querySelector('#ai-apply').hidden = tab.dataset.aiTab !== 'room';
    status.innerHTML = '';
  });
  async function runProduct(source) {
    const key = keyInput.value.trim();
    if (!key) { status.innerHTML = '<p class="warn-text">Paste your API key first.</p>'; keyInput.focus(); return; }
    try { localStorage.setItem(KEY_STORAGE, key); } catch { /* private mode */ }
    status.innerHTML = `<p class="muted"><span class="spinner"></span> ${source.url ? 'Reading the product page…' : 'Identifying the product…'}</p>`;
    try {
      const product = await productWithClaude(source, key);
      const dimensions = { width: Math.max(0.05, product.width), depth: Math.max(0.05, product.depth), height: Math.max(0.05, product.height) };
      const object = app.placeModel(product.type, {
        catalog: { name: product.name, dimensions, color: /^#[0-9a-f]{6}$/i.test(product.color_hex) ? product.color_hex : undefined },
      });
      if (object) {
        const scene = app.scene;
        app.apply({ ...scene, objects: scene.objects.map((item) => (item.id === object.id ? { ...item, material: product.material, product: { url: source.url ?? '', image: product.image_url, price: product.price } } : item)) }, { select: object.id });
      }
      status.innerHTML = `<div class="ai-result">${product.image_url ? `<img src="${product.image_url}" alt="" referrerpolicy="no-referrer" />` : '<span></span>'}<div><strong>${product.name}</strong>
        <p class="mono">${product.width.toFixed(2)} × ${product.depth.toFixed(2)} × ${product.height.toFixed(2)} m ${product.price ? `· ${product.price}` : ''}</p><p class="note">${product.notes}</p><p class="note">Added to the room — drag it into place.</p></div></div>`;
    } catch (error) {
      status.innerHTML = `<p class="warn-text">${error.status === 401 ? 'That API key was rejected.' : error.message}</p>`;
    }
  }
  dialog.querySelector('#ai-url-go').addEventListener('click', () => {
    const url = dialog.querySelector('#ai-url').value.trim();
    if (/^https?:\/\//.test(url)) runProduct({ url });
    else status.innerHTML = '<p class="warn-text">Paste a full link starting with https://</p>';
  });
  dialog.querySelector('#ai-product-file').addEventListener('change', (event) => event.target.files[0] && runProduct({ file: event.target.files[0] }));
  const drop = dialog.querySelector('#ai-drop');
  drop.addEventListener('dragover', (event) => { event.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (event) => { event.preventDefault(); drop.classList.remove('over'); run(event.dataTransfer.files[0]); });
  dialog.querySelector('#ai-apply').addEventListener('click', () => {
    if (!pending) return;
    app.apply(sceneFromLayout(app.scene, pending), { select: null });
    app.viewport.fitRoom(true);
    dialog.close();
    app.toast('Room rebuilt from your photo — check sizes, then run Insights', { action: 'Undo', onAction: app.undo, timeout: 7000 });
  });

  const open = () => {
    try { keyInput.value = localStorage.getItem(KEY_STORAGE) ?? ''; } catch { /* ignore */ }
    status.innerHTML = '';
    dialog.showModal();
  };
  app.dockActions = { ...(app.dockActions ?? {}), 'ai-scan': open };
  app.addDockItems(() => '<button class="dock-item photo" type="button" data-dock-action="ai-scan"><span class="glyph">✦</span>AI scan</button>');
  app.addPaletteCommands(() => [
    { label: 'AI room scan from a photo (Claude)', group: 'Photo', icon: '✦', run: open },
    { label: 'Add a product from a shop link (Claude)', group: 'Add', icon: '✦', run: () => { open(); dialog.querySelector('[data-ai-tab="product"]').click(); } },
  ]);
  app.openProductImport = () => { open(); dialog.querySelector('[data-ai-tab="product"]').click(); };
}
