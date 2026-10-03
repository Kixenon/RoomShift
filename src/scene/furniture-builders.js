import * as THREE from 'three';

// Parametric furniture. Every builder takes the object's box (width × height ×
// depth, metres) and its style options, and tags each mesh as the 'primary'
// surface (top, upholstery, carcass) or 'secondary' (legs, frame, handles) so
// the two colours can be set independently. Local +z is the object's front.

const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...options });

function part(group, mesh, role) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.part = role;
  group.add(mesh);
  return mesh;
}
function block(group, size, position, color, role = 'primary', options = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.width, size.height, size.depth), material(color, options));
  mesh.position.set(position.x, position.y, position.z);
  return part(group, mesh, role);
}
function rod(group, radiusTop, radiusBottom, height, position, color, role = 'secondary', segments = 14) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material(color));
  mesh.position.set(position.x, position.y, position.z);
  return part(group, mesh, role);
}
// A rounded slab (for round/oval tops and cushions).
function disc(group, width, depth, thickness, position, color, role = 'primary') {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, thickness, 40), material(color));
  mesh.scale.set(width, 1, depth);
  mesh.position.set(position.x, position.y, position.z);
  return part(group, mesh, role);
}

const WOOD = 0xc9a87a;
const DARK = 0x2b2d31;
const FABRIC = 0x8a9a8c;
const METAL = 0x8d969b;

// ─── Style catalogue ──────────────────────────────────────────────────────
// key → [option key, label, choices[[value, label]], default]
export const STYLE_OPTIONS = Object.freeze({
  table: [['shape', 'Top', [['rect', 'Rectangle'], ['round', 'Round'], ['oval', 'Oval']], 'rect'], ['legs', 'Legs', [['four', 'Four'], ['tleg', 'T-legs'], ['trestle', 'Trestle'], ['pedestal', 'Pedestal'], ['panel', 'Panel']], 'four']],
  desk: [['legs', 'Base', [['four', 'Four legs'], ['tleg', 'T-legs'], ['panel', 'Panels'], ['drawers', 'Drawers']], 'four']],
  sofa: [['arms', 'Arms', [['both', 'Both'], ['left', 'Left'], ['right', 'Right'], ['none', 'None']], 'both'], ['chaise', 'Chaise', [['none', 'None'], ['left', 'Left'], ['right', 'Right']], 'none'], ['back', 'Back', [['low', 'Low'], ['high', 'High']], 'low']],
  bed: [['headboard', 'Headboard', [['none', 'None'], ['low', 'Low'], ['tall', 'Tall'], ['panel', 'Upholstered']], 'low'], ['base', 'Base', [['legs', 'Legs'], ['platform', 'Platform'], ['storage', 'Drawers']], 'platform']],
  chair: [['kind', 'Kind', [['dining', 'Dining'], ['office', 'Office'], ['stool', 'Stool'], ['armchair', 'Armchair']], 'dining']],
  wardrobe: [['doors', 'Doors', [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']], 'auto'], ['opening', 'Opening', [['hinged', 'Hinged'], ['sliding', 'Sliding']], 'hinged'], ['mirror', 'Mirror', [['no', 'No'], ['yes', 'Yes']], 'no']],
  shelf: [['kind', 'Kind', [['open', 'Open shelves'], ['cube', 'Cube grid'], ['closed', 'Cabinet']], 'open']],
  lamp: [['kind', 'Kind', [['floor', 'Drum shade'], ['arc', 'Arc'], ['tripod', 'Tripod']], 'floor']],
  tv: [['mount', 'Mount', [['stand', 'On a stand'], ['wall', 'Wall-mounted']], 'stand']],
  fridge: [['kind', 'Kind', [['single', 'Single door'], ['top', 'Top freezer'], ['double', 'Side by side']], 'top']],
});

export function styleOf(object) {
  const options = STYLE_OPTIONS[object.model] ?? [];
  const style = {};
  for (const [key, , , fallback] of options) style[key] = object.style?.[key] ?? fallback;
  // Older scenes stored a table's shape as `variant`.
  if (object.model === 'table' && object.variant === 'round' && !object.style?.shape) style.shape = 'round';
  return style;
}

// ─── Tables & desks ───────────────────────────────────────────────────────
function tableBase(group, { width: w, height: h, depth: d }, legs, topH) {
  const legH = Math.max(0.05, h - topH);
  const y = -h / 2 + legH / 2;
  const inset = 0.06;
  if (legs === 'tleg') {
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - Math.min(0.25, w * 0.15));
      block(group, { width: 0.06, height: legH, depth: 0.06 }, { x, y, z: 0 }, DARK, 'secondary', { metalness: 0.5, roughness: 0.4 });
      block(group, { width: 0.06, height: 0.05, depth: d * 0.85 }, { x, y: -h / 2 + 0.025, z: 0 }, DARK, 'secondary', { metalness: 0.5, roughness: 0.4 });
      block(group, { width: 0.05, height: 0.04, depth: d * 0.75 }, { x, y: h / 2 - topH - 0.02, z: 0 }, DARK, 'secondary', { metalness: 0.5, roughness: 0.4 });
    }
  } else if (legs === 'trestle') {
    for (const side of [-1, 1]) {
      const x = side * (w / 2 - 0.18);
      for (const lean of [-1, 1]) {
        const leg = block(group, { width: 0.05, height: legH * 1.05, depth: 0.05 }, { x, y, z: lean * d * 0.18 }, WOOD, 'secondary');
        leg.rotation.x = lean * 0.32;
      }
    }
    block(group, { width: w - 0.4, height: 0.05, depth: 0.05 }, { x: 0, y: -h / 2 + legH * 0.35, z: 0 }, WOOD, 'secondary');
  } else if (legs === 'pedestal') {
    rod(group, 0.05, 0.06, legH, { x: 0, y, z: 0 }, DARK, 'secondary', 16);
    const foot = disc(group, Math.min(w, d) * 0.55, Math.min(w, d) * 0.55, 0.03, { x: 0, y: -h / 2 + 0.015, z: 0 }, DARK, 'secondary');
    foot.userData.part = 'secondary';
  } else if (legs === 'panel') {
    for (const side of [-1, 1]) block(group, { width: 0.04, height: legH, depth: d * 0.92 }, { x: side * (w / 2 - 0.02), y, z: 0 }, WOOD, 'secondary');
    block(group, { width: w - 0.08, height: legH * 0.35, depth: 0.02 }, { x: 0, y: h / 2 - topH - legH * 0.2, z: -d / 2 + 0.05 }, WOOD, 'secondary');
  } else if (legs === 'drawers') {
    block(group, { width: Math.min(0.42, w * 0.35), height: legH, depth: d * 0.9 }, { x: w / 2 - Math.min(0.42, w * 0.35) / 2 - 0.01, y, z: 0 }, WOOD, 'secondary');
    for (let index = 0; index < 3; index += 1) {
      block(group, { width: 0.12, height: 0.015, depth: 0.02 }, { x: w / 2 - Math.min(0.42, w * 0.35) / 2, y: -h / 2 + legH * (0.25 + index * 0.3), z: d * 0.46 }, METAL, 'secondary');
    }
    block(group, { width: 0.04, height: legH, depth: d * 0.9 }, { x: -w / 2 + 0.02, y, z: 0 }, WOOD, 'secondary');
  } else {
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      block(group, { width: 0.045, height: legH, depth: 0.045 }, { x: x * (w / 2 - inset), y, z: z * (d / 2 - inset) }, WOOD, 'secondary');
    }
  }
}

export function buildTable(group, dimensions, style) {
  const { width: w, height: h, depth: d } = dimensions;
  const topH = Math.min(0.045, h * 0.12);
  if (style.shape === 'round' || style.shape === 'oval') disc(group, w, d, topH, { x: 0, y: h / 2 - topH / 2, z: 0 }, WOOD);
  else block(group, { width: w, height: topH, depth: d }, { x: 0, y: h / 2 - topH / 2, z: 0 }, WOOD);
  const legs = (style.shape !== 'rect' && style.legs === 'four') ? 'four' : style.legs;
  tableBase(group, dimensions, legs === 'four' && style.shape !== 'rect' ? 'pedestal' : legs, topH);
}

export function buildDesk(group, dimensions, style) {
  const { width: w, height: h, depth: d } = dimensions;
  const topH = Math.min(0.035, h * 0.06);
  block(group, { width: w, height: topH, depth: d }, { x: 0, y: h / 2 - topH / 2, z: 0 }, WOOD);
  tableBase(group, dimensions, style.legs, topH);
}

// ─── Seating ──────────────────────────────────────────────────────────────
export function buildSofa(group, { width: w, height: h, depth: d }, style) {
  const armW = style.arms === 'none' ? 0 : Math.min(0.2, w * 0.1);
  const leftArm = style.arms === 'both' || style.arms === 'left';
  const rightArm = style.arms === 'both' || style.arms === 'right';
  const seatH = h * 0.5;
  const backH = style.back === 'high' ? h : h * 0.82;
  const backD = Math.min(0.22, d * 0.25);
  const innerLeft = -w / 2 + (leftArm ? armW : 0);
  const innerRight = w / 2 - (rightArm ? armW : 0);
  const innerW = innerRight - innerLeft;
  const innerX = (innerLeft + innerRight) / 2;
  block(group, { width: w, height: seatH * 0.55, depth: d - 0.02 }, { x: 0, y: -h / 2 + 0.06 + seatH * 0.275, z: 0 }, FABRIC);
  const seats = Math.max(1, Math.round(innerW / 0.65));
  for (let index = 0; index < seats; index += 1) {
    const cushionW = innerW / seats;
    block(group, { width: cushionW - 0.02, height: seatH * 0.3, depth: d - backD - 0.04 }, { x: innerLeft + cushionW * (index + 0.5), y: -h / 2 + 0.06 + seatH * 0.55 + seatH * 0.15, z: backD / 2 }, FABRIC);
    block(group, { width: cushionW - 0.03, height: backH - seatH * 0.8, depth: backD * 0.8 }, { x: innerLeft + cushionW * (index + 0.5), y: -h / 2 + 0.06 + seatH * 0.7 + (backH - seatH * 0.8) / 2, z: -d / 2 + backD * 0.6 }, FABRIC);
  }
  block(group, { width: innerW, height: backH - 0.06, depth: backD * 0.5 }, { x: innerX, y: -h / 2 + 0.06 + (backH - 0.06) / 2, z: -d / 2 + backD * 0.25 }, FABRIC);
  for (const [show, side] of [[leftArm, -1], [rightArm, 1]]) {
    if (!show) continue;
    block(group, { width: armW, height: seatH * 1.1, depth: d - 0.02 }, { x: side * (w / 2 - armW / 2), y: -h / 2 + 0.06 + seatH * 0.55, z: 0 }, FABRIC);
  }
  if (style.chaise !== 'none') {
    const side = style.chaise === 'left' ? -1 : 1;
    const chaiseW = Math.min(0.85, innerW / 2);
    block(group, { width: chaiseW, height: seatH * 0.85, depth: d * 0.9 }, { x: side * (innerW / 2 - chaiseW / 2) + innerX, y: -h / 2 + 0.06 + seatH * 0.425, z: d * 0.8 }, FABRIC);
  }
  for (const x of [-1, 1]) for (const z of [-1, 1]) rod(group, 0.02, 0.016, 0.06, { x: x * (w / 2 - 0.06), y: -h / 2 + 0.03, z: z * (d / 2 - 0.06) }, DARK);
}

export function buildChair(group, { width: w, height: h, depth: d }, style) {
  if (style.kind === 'stool') {
    disc(group, w, d, 0.04, { x: 0, y: h / 2 - 0.02, z: 0 }, WOOD);
    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI / 2 + Math.PI / 4;
      const leg = rod(group, 0.015, 0.02, h - 0.04, { x: Math.cos(angle) * w * 0.3, y: -0.02, z: Math.sin(angle) * d * 0.3 }, DARK);
      leg.rotation.set(Math.sin(angle) * 0.08, 0, -Math.cos(angle) * 0.08);
    }
    return;
  }
  if (style.kind === 'office') {
    const seatY = -h / 2 + h * 0.5;
    block(group, { width: w * 0.9, height: 0.08, depth: d * 0.85 }, { x: 0, y: seatY, z: 0.02 }, DARK);
    block(group, { width: w * 0.85, height: h * 0.42, depth: 0.06 }, { x: 0, y: seatY + h * 0.25, z: -d / 2 + 0.05 }, DARK);
    rod(group, 0.025, 0.03, h * 0.35, { x: 0, y: -h / 2 + h * 0.25, z: 0 }, METAL);
    for (let index = 0; index < 5; index += 1) {
      const angle = index * Math.PI * 2 / 5;
      const spoke = block(group, { width: w * 0.42, height: 0.03, depth: 0.04 }, { x: Math.cos(angle) * w * 0.21, y: -h / 2 + 0.05, z: Math.sin(angle) * w * 0.21 }, METAL, 'secondary');
      spoke.rotation.y = -angle;
      const wheel = rod(group, 0.025, 0.025, 0.025, { x: Math.cos(angle) * w * 0.42, y: -h / 2 + 0.025, z: Math.sin(angle) * w * 0.42 }, DARK);
      wheel.rotation.z = Math.PI / 2;
    }
    for (const side of [-1, 1]) block(group, { width: 0.04, height: 0.04, depth: d * 0.5 }, { x: side * w * 0.45, y: seatY + 0.18, z: 0 }, DARK, 'secondary');
    return;
  }
  if (style.kind === 'armchair') {
    buildSofa(group, { width: w, height: h, depth: d }, { arms: 'both', chaise: 'none', back: 'high' });
    return;
  }
  const seatY = -h / 2 + h * 0.52;
  block(group, { width: w, height: 0.045, depth: d }, { x: 0, y: seatY, z: 0 }, WOOD);
  block(group, { width: w, height: h * 0.38, depth: 0.035 }, { x: 0, y: seatY + h * 0.24, z: -d / 2 + 0.02 }, WOOD);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    block(group, { width: 0.035, height: h * 0.52, depth: 0.035 }, { x: x * (w / 2 - 0.03), y: -h / 2 + h * 0.26, z: z * (d / 2 - 0.03) }, WOOD, 'secondary');
  }
}

// ─── Beds & storage ───────────────────────────────────────────────────────
export function buildBed(group, { width: w, height: h, depth: d }, style) {
  const baseH = style.base === 'legs' ? h * 0.35 : h * 0.45;
  const mattressH = Math.min(0.24, h * 0.42);
  const baseY = -h / 2 + (style.base === 'legs' ? 0.12 : 0) + baseH / 2;
  if (style.base === 'legs') {
    for (const x of [-1, 1]) for (const z of [-1, 1]) block(group, { width: 0.05, height: 0.12, depth: 0.05 }, { x: x * (w / 2 - 0.06), y: -h / 2 + 0.06, z: z * (d / 2 - 0.06) }, WOOD, 'secondary');
  }
  block(group, { width: w, height: baseH, depth: d }, { x: 0, y: baseY, z: 0 }, WOOD, 'secondary');
  if (style.base === 'storage') {
    for (const side of [-1, 1]) {
      block(group, { width: 0.012, height: baseH * 0.6, depth: d * 0.36 }, { x: side * (w / 2 + 0.005), y: baseY, z: d * 0.18 }, METAL, 'secondary');
    }
  }
  const mattressY = baseY + baseH / 2 + mattressH / 2;
  block(group, { width: w - 0.06, height: mattressH, depth: d - 0.08 }, { x: 0, y: mattressY, z: 0.02 }, 0xece9e1);
  block(group, { width: w - 0.08, height: mattressH * 0.35, depth: d * 0.55 }, { x: 0, y: mattressY + mattressH * 0.5, z: d * 0.2 }, FABRIC);
  for (const side of (w > 1.1 ? [-1, 1] : [0])) {
    block(group, { width: side ? w * 0.38 : w * 0.6, height: 0.12, depth: 0.35 }, { x: side * w * 0.22, y: mattressY + mattressH / 2 + 0.06, z: -d / 2 + 0.28 }, 0xf5f3ee);
  }
  if (style.headboard !== 'none') {
    const headH = style.headboard === 'low' ? h * 1.4 : style.headboard === 'tall' ? h * 2.2 : h * 1.8;
    const tall = Math.max(headH, baseH + mattressH + 0.2);
    block(group, { width: w + 0.04, height: tall, depth: style.headboard === 'panel' ? 0.1 : 0.05 }, { x: 0, y: -h / 2 + tall / 2, z: -d / 2 - 0.02 }, style.headboard === 'panel' ? FABRIC : WOOD, style.headboard === 'panel' ? 'primary' : 'secondary');
  }
}

export function buildWardrobe(group, { width: w, height: h, depth: d }, style) {
  block(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, 0xe7e1d6);
  const doors = style.doors === 'auto' ? Math.max(1, Math.min(4, Math.round(w / 0.5))) : Number(style.doors);
  const doorW = w / doors;
  for (let index = 0; index < doors; index += 1) {
    const x = -w / 2 + doorW * (index + 0.5);
    const z = d / 2 + (style.opening === 'sliding' ? (index % 2 ? 0.012 : 0.03) : 0.006);
    const mirror = style.mirror === 'yes' && index % 2 === 0;
    block(group, { width: doorW - 0.01, height: h - 0.04, depth: 0.012 }, { x, y: 0, z }, mirror ? 0xc9d6dc : 0xefe9de, mirror ? 'mirror' : 'primary', mirror ? { metalness: 0.9, roughness: 0.08 } : {});
    if (style.opening !== 'sliding') {
      const handleX = x + (index % 2 ? -1 : 1) * (doorW / 2 - 0.05);
      block(group, { width: 0.015, height: 0.2, depth: 0.025 }, { x: handleX, y: 0, z: z + 0.015 }, METAL, 'secondary', { metalness: 0.7, roughness: 0.3 });
    }
  }
}

export function buildShelf(group, { width: w, height: h, depth: d }, style) {
  const t = 0.022;
  for (const side of [-1, 1]) block(group, { width: t, height: h, depth: d }, { x: side * (w / 2 - t / 2), y: 0, z: 0 }, WOOD);
  block(group, { width: w, height: h, depth: 0.008 }, { x: 0, y: 0, z: -d / 2 + 0.004 }, WOOD, 'secondary');
  const rows = Math.max(2, Math.round(h / (style.kind === 'cube' ? 0.36 : 0.32)));
  for (let index = 0; index <= rows; index += 1) {
    block(group, { width: w - 2 * t, height: t, depth: d }, { x: 0, y: -h / 2 + t / 2 + (h - t) * index / rows, z: 0 }, WOOD);
  }
  if (style.kind === 'cube') {
    const cols = Math.max(1, Math.round(w / 0.36));
    for (let index = 1; index < cols; index += 1) block(group, { width: t, height: h - 2 * t, depth: d }, { x: -w / 2 + w * index / cols, y: 0, z: 0 }, WOOD);
  }
  if (style.kind === 'closed') {
    block(group, { width: w - 0.01, height: h - 0.01, depth: 0.015 }, { x: 0, y: 0, z: d / 2 }, 0xefe9de);
    block(group, { width: 0.015, height: 0.16, depth: 0.025 }, { x: w * 0.4, y: 0, z: d / 2 + 0.015 }, METAL, 'secondary');
  } else {
    const colours = [0x8aa391, 0xc47b43, 0x7d93a8, 0xd8b45a];
    for (let index = 0; index < rows; index += 1) {
      const books = new THREE.Group();
      const shelfY = -h / 2 + t + (h - t) * index / rows;
      const span = (w - 2 * t) * 0.55;
      for (let book = 0; book < 6; book += 1) {
        const bookH = (h / rows) * (0.55 + ((book * 7 + index * 3) % 5) * 0.06);
        block(books, { width: span / 6 - 0.004, height: bookH, depth: d * 0.7 }, { x: -span / 2 + span * (book + 0.5) / 6 + (index % 2 ? 0.1 : -0.1) * w, y: shelfY + bookH / 2, z: 0 }, colours[(book + index) % colours.length], 'decor');
      }
      group.add(books);
    }
  }
}

// ─── Lights & appliances ──────────────────────────────────────────────────
export function buildLamp(group, { width, height, depth }, style) {
  const footprint = Math.min(width, depth);
  const shadeColor = 0xece4cf;
  const shadeMaterial = () => material(shadeColor, { side: THREE.DoubleSide, emissive: 0xffe2a8, emissiveIntensity: 0.18 });
  if (style.kind === 'arc') {
    rod(group, footprint * 0.3, footprint * 0.32, 0.05, { x: -width * 0.35, y: -height / 2 + 0.025, z: 0 }, DARK, 'secondary', 24);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-width * 0.35, -height / 2, 0), new THREE.Vector3(-width * 0.35, height * 0.6, 0), new THREE.Vector3(width * 0.4, height * 0.38, 0));
    part(group, new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 0.012, 8), material(METAL, { metalness: 0.7, roughness: 0.3 })), 'secondary');
    const shade = part(group, new THREE.Mesh(new THREE.SphereGeometry(footprint * 0.45, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), shadeMaterial()), 'shade');
    shade.position.set(width * 0.4, height * 0.36, 0);
  } else if (style.kind === 'tripod') {
    for (let index = 0; index < 3; index += 1) {
      const angle = index * Math.PI * 2 / 3;
      const leg = rod(group, 0.012, 0.016, height * 0.75, { x: Math.cos(angle) * footprint * 0.22, y: -height * 0.12, z: Math.sin(angle) * footprint * 0.22 }, WOOD);
      leg.rotation.set(Math.sin(angle) * 0.25, 0, -Math.cos(angle) * 0.25);
    }
    const shade = part(group, new THREE.Mesh(new THREE.CylinderGeometry(footprint * 0.38, footprint * 0.48, height * 0.24, 32, 1, true), shadeMaterial()), 'shade');
    shade.position.y = height / 2 - height * 0.12;
  } else {
    const shadeHeight = Math.min(0.32, height * 0.26);
    rod(group, footprint * 0.32, footprint * 0.38, 0.035, { x: 0, y: -height / 2 + 0.0175, z: 0 }, METAL, 'secondary', 24);
    rod(group, 0.014, 0.018, height - shadeHeight * 0.6, { x: 0, y: -shadeHeight * 0.3, z: 0 }, METAL, 'secondary', 10);
    const shade = part(group, new THREE.Mesh(new THREE.CylinderGeometry(footprint * 0.34, footprint * 0.5, shadeHeight, 32, 1, true), shadeMaterial()), 'shade');
    shade.position.y = height / 2 - shadeHeight / 2;
  }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(Math.min(0.045, footprint * 0.14), 16, 12), material(0xfff4d6, { emissive: 0xffe7b0, emissiveIntensity: 1.4 }));
  bulb.position.set(style.kind === 'arc' ? width * 0.4 : 0, style.kind === 'arc' ? height * 0.33 : height / 2 - Math.min(0.32, height * 0.26) * 0.6, 0);
  bulb.userData.noTint = true;
  group.add(bulb);
}

export function buildTv(group, { width: w, height: h, depth: d }, style) {
  const screenH = style.mount === 'wall' ? h : h * 0.88;
  block(group, { width: w, height: screenH, depth: Math.min(0.06, d) }, { x: 0, y: h / 2 - screenH / 2, z: 0 }, 0x1d2126, 'primary', { roughness: 0.25 });
  const glass = block(group, { width: w * 0.97, height: screenH * 0.94, depth: 0.004 }, { x: 0, y: h / 2 - screenH / 2, z: Math.min(0.06, d) / 2 + 0.002 }, 0x14202c, 'screen', { emissive: 0x0d1a26, emissiveIntensity: 0.6, roughness: 0.1 });
  glass.userData.noTint = true;
  if (style.mount !== 'wall') {
    block(group, { width: w * 0.32, height: 0.015, depth: Math.max(0.18, d) }, { x: 0, y: -h / 2 + 0.0075, z: 0 }, DARK, 'secondary');
    block(group, { width: 0.05, height: h - screenH, depth: 0.03 }, { x: 0, y: -h / 2 + (h - screenH) / 2, z: -0.01 }, DARK, 'secondary');
  }
}

export function buildFridge(group, { width: w, height: h, depth: d }, style) {
  block(group, { width: w, height: h, depth: d * 0.96 }, { x: 0, y: 0, z: -d * 0.02 }, 0xe6eae8, 'primary', { roughness: 0.35, metalness: 0.2 });
  const handle = (x, y, length) => block(group, { width: 0.025, height: length, depth: 0.035 }, { x, y, z: d / 2 + 0.01 }, METAL, 'secondary', { metalness: 0.8, roughness: 0.25 });
  if (style.kind === 'double') {
    block(group, { width: 0.006, height: h * 0.98, depth: 0.01 }, { x: 0, y: 0, z: d / 2 }, 0x9aa5a0, 'secondary');
    handle(-0.04, h * 0.1, h * 0.4);
    handle(0.04, h * 0.1, h * 0.4);
  } else if (style.kind === 'top') {
    block(group, { width: w * 0.98, height: 0.008, depth: 0.01 }, { x: 0, y: h * 0.22, z: d / 2 }, 0x9aa5a0, 'secondary');
    handle(w * 0.38, h * 0.36, h * 0.14);
    handle(w * 0.38, -h * 0.02, h * 0.3);
  } else {
    handle(w * 0.38, h * 0.1, h * 0.35);
  }
}

// Fan with a head that can turn (yaw), tilt, and oscillate.
export function buildFan(group, { width, height, depth }, props = {}) {
  const base = Math.min(width, depth) * 0.46;
  const headRadius = Math.min(width, depth) * 0.42;
  rod(group, base * 0.85, base, 0.06, { x: 0, y: -height / 2 + 0.03, z: 0 }, METAL, 'secondary', 24);
  rod(group, 0.022, 0.03, height * 0.62, { x: 0, y: -height * 0.16, z: 0 }, METAL, 'secondary', 12);
  const head = new THREE.Group();
  head.position.set(0, height * 0.24, 0);
  const tilt = new THREE.Group();
  head.add(tilt);
  const motor = rod(tilt, headRadius * 0.28, headRadius * 0.32, depth * 0.3, { x: 0, y: 0, z: -depth * 0.12 }, 0xd9dfdc, 'primary', 16);
  motor.rotation.x = Math.PI / 2;
  const cage = new THREE.Mesh(new THREE.TorusGeometry(headRadius * 0.86, 0.012, 6, 36), material(METAL, { metalness: 0.6 }));
  cage.position.z = depth * 0.08;
  part(tilt, cage, 'secondary');
  for (let index = 0; index < 8; index += 1) {
    const spoke = block(tilt, { width: headRadius * 1.7, height: 0.006, depth: 0.006 }, { x: 0, y: 0, z: depth * 0.12 }, METAL, 'secondary');
    spoke.rotation.z = index * Math.PI / 8;
  }
  const blades = new THREE.Group();
  blades.position.z = depth * 0.05;
  for (let index = 0; index < 3; index += 1) {
    const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material(0x6d9c85, { transparent: true, opacity: 0.85 }));
    blade.scale.set(headRadius * 0.2, headRadius * 0.62, 0.012);
    blade.position.y = headRadius * 0.32;
    const arm = new THREE.Group();
    arm.rotation.z = index * Math.PI * 2 / 3;
    arm.add(blade);
    blade.userData.part = 'primary';
    blades.add(arm);
  }
  tilt.add(blades);
  group.add(head);
  head.rotation.y = (props.yaw ?? 0) * Math.PI / 180;
  tilt.rotation.x = -(props.tilt ?? 0) * Math.PI / 180;
  group.userData.fan = { head, blades, yaw: (props.yaw ?? 0) * Math.PI / 180, oscillate: Boolean(props.oscillate), speed: props.speed ?? 2 };
}
