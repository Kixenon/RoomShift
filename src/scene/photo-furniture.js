import { MODEL_PRESETS } from '../model/room-scene.js';

// On-device furniture detection with COCO-SSD (TensorFlow.js). No API key and the
// photo never leaves the browser. It recognises common furniture categories and
// roughly where they sit left-to-right; sizes come from typical dimensions, scaled
// by how wide the object appears relative to the room's width in the photo.

const SCRIPTS = [
  'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js',
  'https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js',
];

// ImageNet labels (whole-photo classifier) → RoomShift models. Used when the
// detector finds nothing, which is common for a close, clean shot of one item.
const IMAGENET_TO_MODEL = [
  [/desk/i, 'desk'],
  [/dining table|table/i, 'table'],
  [/studio couch|sofa|couch/i, 'sofa'],
  [/four-poster|bed|crib|cradle/i, 'bed'],
  [/folding chair|rocking chair|barber chair|throne|chair/i, 'chair'],
  [/wardrobe|armoire|chiffonier|chest/i, 'wardrobe'],
  [/bookcase|bookshop|shelf/i, 'shelf'],
  [/refrigerator|icebox/i, 'fridge'],
  [/monitor|screen|desktop computer/i, 'monitor'],
  [/notebook|laptop/i, 'laptop'],
  [/water bottle|bottle|cup|mug|coffee/i, 'bottle'],
  [/book|binder/i, 'books'],
  [/television|home theater/i, 'tv'],
  [/table lamp|lampshade|lamp/i, 'lamp'],
  [/pot|vase|flowerpot|plant/i, 'plant'],
  [/electric fan|fan/i, 'fan'],
  [/space heater|radiator/i, 'heater'],
  [/loudspeaker|speaker/i, 'speaker'],
  [/modem|router/i, 'router'],
];

const CLASS_TO_MODEL = Object.freeze({
  couch: 'sofa', bed: 'bed', chair: 'chair', 'dining table': 'table', tv: 'tv', 'potted plant': 'plant',
  refrigerator: 'fridge', laptop: 'laptop', bottle: 'bottle', cup: 'bottle', 'wine glass': 'bottle', book: 'books', keyboard: 'laptop',
  oven: 'box', microwave: 'box', sink: 'box', toilet: 'box', clock: null,
});

let modelPromise = null;
let classifierPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not download the detection model. Check your connection.'));
    document.head.append(script);
  });
}

export function loadDetector() {
  modelPromise ??= (async () => {
    for (const src of SCRIPTS) await loadScript(src);
    // The full MobileNet v2 base is ~3× slower than the lite one but finds far more.
    return globalThis.cocoSsd.load({ base: 'mobilenet_v2' });
  })().catch((error) => {
    modelPromise = null;
    throw error;
  });
  return modelPromise;
}

function loadClassifier() {
  classifierPromise ??= loadDetector().then(() => globalThis.mobilenet.load({ version: 2, alpha: 1.0 })).catch((error) => {
    classifierPromise = null;
    throw error;
  });
  return classifierPromise;
}

export async function detectFurniture(image) {
  const detector = await loadDetector();
  const predictions = await detector.detect(image, 20, 0.22);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  return predictions
    .map((prediction) => {
      const model = CLASS_TO_MODEL[prediction.class];
      if (!model) return null;
      const [x, y, w, h] = prediction.bbox;
      return {
        model,
        label: MODEL_PRESETS[model].label,
        detectedAs: prediction.class,
        confidence: prediction.score,
        // normalised image-space box
        box: { x: x / width, y: y / height, w: w / width, h: h / height },
      };
    })
    .filter(Boolean);
}

// Whole-photo guesses for one main object, best first.
export async function classifyFurniture(image) {
  const classifier = await loadClassifier();
  const predictions = await classifier.classify(image, 10);
  const seen = new Set();
  return predictions.flatMap((prediction) => {
    const match = IMAGENET_TO_MODEL.find(([pattern]) => pattern.test(prediction.className));
    if (!match || seen.has(match[1])) return [];
    seen.add(match[1]);
    return [{
      model: match[1],
      label: MODEL_PRESETS[match[1]].label,
      detectedAs: prediction.className.split(',')[0],
      confidence: prediction.probability,
      box: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      whole: true,
    }];
  });
}

// ─── Silhouette analysis ──────────────────────────────────────────────────
// Separates the object from a plain background (product shots) by colour
// distance from the border, then reads its proportions, the colour of its upper
// part (top/upholstery) and lower part (legs/frame), and how many separate leg
// columns touch the floor (two wide feet = T-legs, three or four = four legs).
const hex = ([r, g, b]) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

export function analyseSilhouette(image, box = { x: 0, y: 0, w: 1, h: 1 }) {
  const width = 160;
  const scale = width / (image.naturalWidth || image.width);
  const height = Math.max(8, Math.round((image.naturalHeight || image.height) * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const at = (x, y) => (y * width + x) * 4;
  const x0 = Math.floor(box.x * width);
  const y0 = Math.floor(box.y * height);
  const x1 = Math.min(width - 1, Math.ceil((box.x + box.w) * width));
  const y1 = Math.min(height - 1, Math.ceil((box.y + box.h) * height));
  // Background = median-ish colour of the crop's border.
  const border = [];
  for (let x = x0; x <= x1; x += 2) border.push(at(x, y0), at(x, y1));
  for (let y = y0; y <= y1; y += 2) border.push(at(x0, y), at(x1, y));
  const background = [0, 1, 2].map((channel) => {
    const values = border.map((index) => data[index + channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  });
  const mask = new Uint8Array(width * height);
  let minX = width; let maxX = 0; let minY = height; let maxY = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const index = at(x, y);
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const distance = Math.hypot(r - background[0], g - background[1], b - background[2]);
      if (distance < 48) continue;
      // Cast shadows are grey, mid-bright and colourless; black legs are much darker.
      const brightest = Math.max(r, g, b);
      const saturation = brightest ? (brightest - Math.min(r, g, b)) / brightest : 0;
      if (saturation < 0.12 && brightest > 105 && brightest < Math.max(...background) - 10) continue;
      mask[y * width + x] = 1;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX <= minX || maxY <= minY) return null;
  const average = (fromY, toY) => {
    const sum = [0, 0, 0];
    let count = 0;
    for (let y = Math.floor(fromY); y <= toY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!mask[y * width + x]) continue;
        const index = at(x, y);
        sum[0] += data[index]; sum[1] += data[index + 1]; sum[2] += data[index + 2];
        count += 1;
      }
    }
    return count ? sum.map((value) => value / count) : null;
  };
  const spanY = maxY - minY;
  const top = average(minY, minY + spanY * 0.3);
  const bottom = average(minY + spanY * 0.55, maxY);
  // Leg columns: runs of masked columns in bands below the top. In a 3/4 view
  // the back legs end higher, so take the most runs any band sees.
  let runs = 0;
  for (const fraction of [0.6, 0.68, 0.76, 0.84]) {
    const bandY = Math.round(minY + spanY * fraction);
    let count = 0;
    let inside = false;
    for (let x = minX; x <= maxX; x += 1) {
      let hit = false;
      for (let y = bandY - 1; y <= bandY + 1; y += 1) if (mask[y * width + x]) hit = true;
      if (hit && !inside) count += 1;
      inside = hit;
    }
    runs = Math.max(runs, count);
  }
  return {
    aspect: (maxX - minX) / Math.max(1, spanY),
    color: top ? hex(top) : null,
    color2: bottom ? hex(bottom) : null,
    contrast: top && bottom ? Math.hypot(top[0] - bottom[0], top[1] - bottom[1], top[2] - bottom[2]) : 0,
    legRuns: runs,
  };
}

// Size and style from what the photo shows, per type.
export function shapeFromSilhouette(model, silhouette) {
  if (!silhouette) return {};
  const { aspect, color, color2, contrast, legRuns } = silhouette;
  const colours = { color, ...(contrast > 60 ? { color2 } : {}) };
  if (model === 'table' || model === 'desk') {
    const legs = legRuns === 2 ? 'tleg' : legRuns >= 3 ? 'four' : 'panel';
    const style = model === 'table' ? { shape: 'rect', legs } : { legs };
    if (aspect > 2.1) return { ...colours, style, dimensions: { width: 1.8, depth: 0.8, height: 0.74 } };
    if (aspect > 1.45) return { ...colours, style, dimensions: { width: 1.4, depth: 0.7, height: 0.74 } };
    if (aspect > 1.1) return { ...colours, style, dimensions: { width: 1.2, depth: 0.75, height: 0.74 } };
    return { ...colours, style, dimensions: { width: 0.9, depth: 0.55, height: 0.45 } };
  }
  if (model === 'sofa') {
    if (aspect > 2.6) return { ...colours, dimensions: { width: 2.3, depth: 0.95, height: 0.82 } };
    if (aspect > 1.8) return { ...colours, dimensions: { width: 1.8, depth: 0.9, height: 0.82 } };
    return { ...colours, dimensions: { width: 0.85, depth: 0.85, height: 0.9 } };
  }
  if (model === 'shelf' || model === 'wardrobe') {
    return { ...colours, dimensions: { width: Math.max(0.4, Math.min(2, aspect * 1.9)), height: 1.9, depth: model === 'shelf' ? 0.35 : 0.58 } };
  }
  return colours;
}

// Turn detections into object placements. Horizontal position in the photo maps to
// the room's width, and lower in the frame means nearer the camera (front wall).
export function placementsFromDetections(detections, room) {
  return detections.map((detection) => {
    const preset = MODEL_PRESETS[detection.model];
    const centerX = detection.box.x + detection.box.w / 2;
    const bottom = detection.box.y + detection.box.h;
    const widthScale = Math.min(1.6, Math.max(0.6, (detection.box.w * room.width * 0.9) / preset.dimensions.width));
    const dimensions = {
      ...preset.dimensions,
      width: Number(Math.min(room.width - 0.1, preset.dimensions.width * (detection.model === 'box' ? 1 : widthScale)).toFixed(2)),
    };
    const shaped = detection.shape ?? {};
    return {
      model: detection.model,
      name: preset.label,
      ...(shaped.style ? { style: shaped.style } : {}),
      ...(shaped.color ? { color: shaped.color } : {}),
      ...(shaped.color2 ? { color2: shaped.color2 } : {}),
      dimensions: shaped.dimensions ? { ...shaped.dimensions } : dimensions,
      position: {
        x: Number((centerX * room.width).toFixed(2)),
        z: Number(((1 - Math.min(1, Math.max(0, (bottom - 0.45) / 0.55))) * room.depth).toFixed(2)),
      },
    };
  });
}
