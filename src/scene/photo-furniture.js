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
    return {
      model: detection.model,
      name: preset.label,
      dimensions,
      position: {
        x: Number((centerX * room.width).toFixed(2)),
        z: Number(((1 - Math.min(1, Math.max(0, (bottom - 0.45) / 0.55))) * room.depth).toFixed(2)),
      },
    };
  });
}
