import { MODEL_PRESETS, isWallItem, objectMaterial, moveObject, rotateObject } from './room-scene.js';
import { lightContext, luxAt, wifiAt } from '../simulation/room-propagation.js';

// Livability check and layout search. Rules follow common residential planning
// guidance: ~60 cm minimum circulation width, 60–90 cm in front of storage, door
// swing kept clear, and ~90 cm between heaters and anything combustible.

const CELL = 0.1;
const WALK_RADIUS = 0.3; // half of a 60 cm walkway
const FIXED_MODELS = new Set(['ceilingLight', 'ac', 'router', 'speaker', 'deskLamp', 'monitor', 'laptop', 'bottle', 'books']);
const ACCESS = Object.freeze({
  // depth of the zone that must stay walkable, on the object's local +z (front) side
  wardrobe: 0.7, fridge: 0.8, shelf: 0.6, desk: 0.7, sofa: 0.5, tv: 0, bed: 0.5,
});
const WALL_LOVERS = new Set(['bed', 'wardrobe', 'shelf', 'desk', 'sofa', 'fridge', 'tv', 'heater']);
const SEATS = new Set(['bed', 'desk', 'sofa', 'chair']);

const rad = (degrees) => degrees * Math.PI / 180;

function footprint(object) {
  const angle = rad(object.rotation.y);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    cx: object.position.x,
    cz: object.position.z,
    hw: object.dimensions.width / 2,
    hd: object.dimensions.depth / 2,
    cos,
    sin,
    // world direction of the object's local +z (its front)
    front: { x: sin, z: cos },
  };
}

function insideFootprint(fp, x, z, margin = 0) {
  const dx = x - fp.cx;
  const dz = z - fp.cz;
  const lx = dx * fp.cos - dz * fp.sin;
  const lz = dx * fp.sin + dz * fp.cos;
  return Math.abs(lx) <= fp.hw + margin && Math.abs(lz) <= fp.hd + margin;
}

const blocksFloor = (object) => !isWallItem(object) && !FIXED_MODELS.has(object.model) && object.position.y < 0.6;

function grid(room) {
  const nx = Math.max(1, Math.round(room.width / CELL));
  const nz = Math.max(1, Math.round(room.depth / CELL));
  return { nx, nz, at: (i, k) => ({ x: (i + 0.5) * room.width / nx, z: (k + 0.5) * room.depth / nz }) };
}

function overlapArea(a, b) {
  // Sampled overlap of two footprints; cheap and exact enough for 10 cm planning.
  const fa = footprint(a);
  const fb = footprint(b);
  const r = Math.hypot(fa.hw, fa.hd);
  if (Math.hypot(fa.cx - fb.cx, fa.cz - fb.cz) > r + Math.hypot(fb.hw, fb.hd)) return 0;
  let hits = 0;
  const step = 0.08;
  for (let x = fa.cx - r; x <= fa.cx + r; x += step) {
    for (let z = fa.cz - r; z <= fa.cz + r; z += step) {
      if (insideFootprint(fa, x, z) && insideFootprint(fb, x, z)) hits += 1;
    }
  }
  return hits * step * step;
}

function doorCells(scene, g) {
  const cells = [];
  for (const door of scene.objects.filter((object) => object.model === 'door')) {
    const half = door.dimensions.width / 2;
    for (let i = 0; i < g.nx; i += 1) {
      for (let k = 0; k < g.nz; k += 1) {
        const { x, z } = g.at(i, k);
        const nearWall = door.wall === 'front' ? z < 0.45 && Math.abs(x - door.position.x) < half
          : door.wall === 'back' ? z > scene.room.depth - 0.45 && Math.abs(x - door.position.x) < half
            : door.wall === 'left' ? x < 0.45 && Math.abs(z - door.position.z) < half
              : x > scene.room.width - 0.45 && Math.abs(z - door.position.z) < half;
        if (nearWall) cells.push([i, k]);
      }
    }
  }
  return cells;
}

function inwardNormal(wall) {
  return wall === 'front' ? { x: 0, z: 1 } : wall === 'back' ? { x: 0, z: -1 } : wall === 'left' ? { x: 1, z: 0 } : { x: -1, z: 0 };
}

function distanceToWall(object, room) {
  const fp = footprint(object);
  const ex = Math.abs(fp.hw * fp.cos) + Math.abs(fp.hd * fp.sin);
  const ez = Math.abs(fp.hw * fp.sin) + Math.abs(fp.hd * fp.cos);
  return Math.min(object.position.x - ex, room.width - object.position.x - ex, object.position.z - ez, room.depth - object.position.z - ez);
}

export function evaluateLayout(scene, { environment = null } = {}) {
  const { room } = scene;
  const issues = [];
  const wins = [];
  let penalty = 0;
  const add = (severity, text, objectId = null, weight = severity === 'high' ? 14 : severity === 'medium' ? 7 : 3) => {
    issues.push({ severity, text, objectId });
    penalty += weight;
  };

  const floorObjects = scene.objects.filter(blocksFloor);
  const footprints = floorObjects.map((object) => ({ object, fp: footprint(object) }));

  // Overlaps
  for (let a = 0; a < floorObjects.length; a += 1) {
    for (let b = a + 1; b < floorObjects.length; b += 1) {
      const area = overlapArea(floorObjects[a], floorObjects[b]);
      const allowed = (floorObjects[a].model === 'chair' && floorObjects[b].model === 'desk')
        || (floorObjects[b].model === 'chair' && floorObjects[a].model === 'desk');
      if (area > 0.02 && !allowed) add('high', `${floorObjects[a].name} overlaps ${floorObjects[b].name}`, floorObjects[a].id, 10 + area * 30);
    }
  }

  // Walkability: free cells where a 60 cm-wide person fits, flood-filled from the door.
  const g = grid(room);
  const free = new Uint8Array(g.nx * g.nz);
  for (let k = 0; k < g.nz; k += 1) {
    for (let i = 0; i < g.nx; i += 1) {
      const { x, z } = g.at(i, k);
      const nearWallEdge = x < WALK_RADIUS - 0.05 || z < WALK_RADIUS - 0.05 || x > room.width - WALK_RADIUS + 0.05 || z > room.depth - WALK_RADIUS + 0.05;
      free[k * g.nx + i] = !nearWallEdge && !footprints.some(({ object, fp }) => object.model !== 'chair' && insideFootprint(fp, x, z, WALK_RADIUS - 0.04)) ? 1 : 0;
    }
  }
  let starts = doorCells(scene, g).map(([i, k]) => {
    // nudge inward from the wall to the first free cell
    for (let step = 0; step < 8; step += 1) {
      const door = scene.objects.find((object) => object.model === 'door');
      const n = inwardNormal(door.wall);
      const ii = i + Math.round(n.x * step);
      const kk = k + Math.round(n.z * step);
      if (ii >= 0 && kk >= 0 && ii < g.nx && kk < g.nz && free[kk * g.nx + ii]) return [ii, kk];
    }
    return null;
  }).filter(Boolean);
  const hasDoor = scene.objects.some((object) => object.model === 'door');
  if (!hasDoor) {
    // No door modelled: start from the largest free cell cluster's first cell.
    const index = free.indexOf(1);
    if (index >= 0) starts = [[index % g.nx, Math.floor(index / g.nx)]];
  }
  const reach = new Uint8Array(free.length);
  const queue = [];
  for (const [i, k] of starts) {
    reach[k * g.nx + i] = 1;
    queue.push(k * g.nx + i);
  }
  while (queue.length) {
    const cell = queue.pop();
    const i = cell % g.nx;
    const k = Math.floor(cell / g.nx);
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= g.nx || nk >= g.nz) continue;
      const next = nk * g.nx + ni;
      if (free[next] && !reach[next]) {
        reach[next] = 1;
        queue.push(next);
      }
    }
  }
  if (hasDoor && !starts.length) add('high', 'The door is blocked — nothing can get in or out', scene.objects.find((object) => object.model === 'door')?.id, 30);

  const reachableNear = (x, z, radius) => {
    for (let k = 0; k < g.nz; k += 1) {
      for (let i = 0; i < g.nx; i += 1) {
        if (!reach[k * g.nx + i]) continue;
        const p = g.at(i, k);
        if (Math.hypot(p.x - x, p.z - z) <= radius) return true;
      }
    }
    return false;
  };

  for (const { object, fp } of footprints) {
    const depth = ACCESS[object.model];
    if (depth === undefined) continue;
    const label = object.name;
    if (object.model === 'bed') {
      // A bed needs at least one long side reachable.
      const side = { x: fp.cos, z: -fp.sin };
      const ok = [-1, 1].some((sign) => reachableNear(fp.cx + side.x * sign * (fp.hw + 0.35), fp.cz + side.z * sign * (fp.hw + 0.35), 0.3));
      if (!ok) add('high', `You can't walk up to the side of ${label}`, object.id);
      else wins.push(`${label} is reachable from the door`);
      continue;
    }
    const fx = fp.cx + fp.front.x * (fp.hd + depth / 2);
    const fz = fp.cz + fp.front.z * (fp.hd + depth / 2);
    if (depth && !reachableNear(fx, fz, Math.max(0.3, depth / 2))) add(object.model === 'desk' ? 'high' : 'medium', `No walkable space in front of ${label}`, object.id);
    if (fx < 0 || fz < 0 || fx > room.width || fz > room.depth) add('medium', `${label} faces the wall`, object.id);
  }

  // Door swing
  for (const door of scene.objects.filter((object) => object.model === 'door' && object.props?.swing !== 'out')) {
    const n = inwardNormal(door.wall);
    const cx = door.position.x + n.x * door.dimensions.width / 2;
    const cz = door.position.z + n.z * door.dimensions.width / 2;
    const blocked = footprints.find(({ object, fp }) => object.position.y < 1.8 && insideFootprint(fp, cx, cz, door.dimensions.width / 2 - 0.1));
    if (blocked) add('medium', `${blocked.object.name} is in the door's swing`, blocked.object.id);
  }

  // Windows: tall things right in front block daylight and air.
  for (const window of scene.objects.filter((object) => object.model === 'window')) {
    const n = inwardNormal(window.wall);
    const blocker = footprints.find(({ object, fp }) => object.dimensions.height + object.position.y > window.position.y + 0.3
      && insideFootprint(fp, window.position.x + n.x * 0.35, window.position.z + n.z * 0.35, 0.2));
    if (blocker) add('medium', `${blocker.object.name} blocks ${window.name}`, blocker.object.id);
  }

  // Heater clearance from fabric (≈3 ft rule for space heaters)
  for (const heater of scene.objects.filter((object) => object.model === 'heater')) {
    for (const object of scene.objects) {
      if (object === heater || objectMaterial(object) !== 'fabric') continue;
      const gap = Math.hypot(object.position.x - heater.position.x, object.position.z - heater.position.z)
        - Math.hypot(object.dimensions.width, object.dimensions.depth) / 2 - heater.dimensions.width / 2;
      if (gap < 0.9) add('high', `${heater.name} is within 90 cm of ${object.name} (fire risk)`, heater.id);
    }
  }

  // Comfort: radiant heat makes a seat or desk within ~60 cm unpleasant.
  for (const heater of scene.objects.filter((object) => object.model === 'heater')) {
    for (const object of scene.objects.filter((item) => ['desk', 'chair', 'sofa', 'bed'].includes(item.model))) {
      if (objectMaterial(object) === 'fabric') continue; // already covered by the fire-risk rule
      const gap = Math.hypot(object.position.x - heater.position.x, object.position.z - heater.position.z)
        - Math.hypot(object.dimensions.width, object.dimensions.depth) / 2 - heater.dimensions.width / 2;
      if (gap < 0.6) add('medium', `${heater.name} is within 60 cm of ${object.name} — too hot to sit there`, heater.id);
    }
  }

  // Routers on the floor lose range to furniture and bodies.
  for (const router of scene.objects.filter((object) => object.model === 'router')) {
    if (router.position.y < 0.4) add('low', `${router.name} is on the floor — raise it to 1–2 m for better coverage`, router.id);
  }

  // Comfort: AC jet straight onto the bed; fan aimed at nobody.
  const seats = scene.objects.filter((object) => SEATS.has(object.model));
  const aims = (source, target, maxDistance) => {
    const fp = footprint(source);
    const dx = target.position.x - source.position.x;
    const dz = target.position.z - source.position.z;
    const distance = Math.hypot(dx, dz);
    return distance < maxDistance && (dx * fp.front.x + dz * fp.front.z) / Math.max(0.01, distance) > Math.cos(rad(30));
  };
  for (const ac of scene.objects.filter((object) => object.model === 'ac')) {
    const bed = scene.objects.find((object) => object.model === 'bed' && aims(ac, object, 2.5));
    if (bed) add('low', `${ac.name} blows straight onto ${bed.name} — cold drafts while sleeping`, ac.id);
  }
  for (const fan of scene.objects.filter((object) => object.model === 'fan')) {
    const target = seats.find((object) => aims(fan, object, 3.2));
    if (target) wins.push(`${fan.name} reaches ${target.name}`);
    else add('low', `${fan.name} isn't aimed at a bed, desk or sofa`, fan.id);
  }

  // A sofa should face the TV from a comfortable viewing distance.
  for (const tv of scene.objects.filter((object) => object.model === 'tv')) {
    const sofas = scene.objects.filter((object) => object.model === 'sofa');
    if (!sofas.length) continue;
    const facing = sofas.find((sofa) => aims(sofa, tv, 4.5) && aims(tv, sofa, 4.5)
      && Math.hypot(sofa.position.x - tv.position.x, sofa.position.z - tv.position.z) > 1.4);
    if (facing) wins.push(`${facing.name} faces ${tv.name}`);
    else add('medium', `No sofa faces ${tv.name} from 1.5–4.5 m`, tv.id);
  }

  // Daylight at the desk
  const windows = scene.objects.filter((object) => object.model === 'window');
  for (const desk of scene.objects.filter((object) => object.model === 'desk')) {
    const near = windows.some((window) => Math.hypot(window.position.x - desk.position.x, window.position.z - desk.position.z) < 2.0);
    if (windows.length && !near) add('low', `${desk.name} is far from daylight`, desk.id);
    else if (near) wins.push(`${desk.name} gets daylight`);
    if (environment) {
      const lux = luxAt(lightContext(scene, environment), { x: desk.position.x, y: desk.position.y + desk.dimensions.height + 0.01, z: desk.position.z });
      if (lux < 300) add('low', `${desk.name} gets ${Math.round(lux)} lux at ${String(Math.floor(environment.hour)).padStart(2, '0')}:00 — add a desk lamp (300–500 lux for work)`, desk.id);
    }
    const signal = wifiAt(scene, { x: desk.position.x, y: 1.0, z: desk.position.z });
    if (signal !== null && signal < -67) add('medium', `Weak WiFi at ${desk.name} (${signal.toFixed(0)} dBm)`, desk.id);
  }

  // Free floor
  const freeCells = free.reduce((sum, value) => sum + value, 0);
  const reachable = reach.reduce((sum, value) => sum + value, 0);
  const openFloor = freeCells / free.length;
  if (freeCells && reachable / freeCells < 0.8) add('medium', 'Part of the floor is cut off by furniture', null, 6);
  if (openFloor < 0.25) add('medium', 'Under 25% of the floor is walkable — the room will feel cramped', null, 6);

  return {
    score: Math.max(0, Math.round(100 - penalty)),
    issues: issues.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]),
    wins,
    openFloor,
    reachableMask: { nx: g.nx, nz: g.nz, data: reach },
  };
}

function objective(scene) {
  const result = evaluateLayout(scene);
  // Tie-breakers: big furniture against walls keeps the middle open.
  let bonus = 0;
  for (const object of scene.objects) {
    if (WALL_LOVERS.has(object.model) && blocksFloor(object)) bonus -= Math.min(0.6, Math.max(0, distanceToWall(object, scene.room))) * 2;
  }
  return { value: result.score + result.openFloor * 10 + bonus, result };
}

function randomMove(scene, object, room, random) {
  const choice = random();
  try {
    if (choice < 0.25) return rotateObject(scene, object.id, { y: object.rotation.y + (random() < 0.5 ? 90 : -90) }).scene;
    if (choice < 0.55) {
      // Snap to a random wall, facing into the room.
      const wall = Math.floor(random() * 4);
      const rotation = [0, 180, 90, -90][wall];
      const rotated = rotateObject(scene, object.id, { y: rotation }).scene;
      const along = random();
      const position = [
        { x: along * room.width, z: 0 },
        { x: along * room.width, z: room.depth },
        { x: 0, z: along * room.depth },
        { x: room.width, z: along * room.depth },
      ][wall];
      return moveObject(rotated, object.id, position).scene;
    }
    const step = choice < 0.85 ? 0.3 : 1.2;
    return moveObject(scene, object.id, {
      x: object.position.x + (random() - 0.5) * step * 2,
      z: object.position.z + (random() - 0.5) * step * 2,
    }).scene;
  } catch {
    return scene;
  }
}

// Simulated annealing over unlocked floor furniture. Yields to the UI between chunks.
export async function suggestLayout(scene, { iterations = 1400, onProgress = () => {}, seed = Date.now(), isCancelled = () => false } = {}) {
  let state = seed >>> 0;
  const random = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  const movable = scene.objects.filter((object) => blocksFloor(object) && !object.locked && MODEL_PRESETS[object.model]).map((object) => object.id);
  let current = scene;
  let currentScore = objective(scene);
  let best = current;
  let bestScore = currentScore;
  if (!movable.length) return { scene, before: currentScore.result, after: currentScore.result, improved: false };
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    if (iteration % 60 === 0) {
      onProgress(iteration / iterations, bestScore.result.score);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (isCancelled()) break;
    }
    const temperature = 8 * (1 - iteration / iterations) + 0.2;
    const id = movable[Math.floor(random() * movable.length)];
    const object = current.objects.find((item) => item.id === id);
    const candidate = randomMove(current, object, scene.room, random);
    if (candidate === current) continue;
    const score = objective(candidate);
    if (score.value >= currentScore.value || random() < Math.exp((score.value - currentScore.value) / temperature)) {
      current = candidate;
      currentScore = score;
      if (score.value > bestScore.value) {
        best = candidate;
        bestScore = score;
      }
    }
  }
  onProgress(1, bestScore.result.score);
  const before = evaluateLayout(scene);
  return { scene: best, before, after: bestScore.result, improved: bestScore.result.score > before.score };
}
