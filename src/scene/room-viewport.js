import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mountViewportCanvas } from './mount-canvas.js';
import { createRoomFieldLayer } from './room-field-layer-3d.js';
import { floorContains, floorOutline, isWallItem, objectMaterial, openFraction } from '../model/room-scene.js';
import { MATERIALS, SURFACE_MATERIALS, sceneSurfaces } from '../model/materials.js';
import { bearingToRoomVector, sunPosition } from '../model/environment.js';
import { gsap } from 'gsap';
import {
  buildBed, buildChair, buildDesk, buildFan, buildFridge, buildLamp, buildShelf, buildSofa, buildTable, buildTv, buildWardrobe, styleOf,
} from './furniture-builders.js';

// Parametric builders take the object's style; these replace the simple ones.
const STYLED_BUILDERS = Object.freeze({
  table: buildTable, desk: buildDesk, sofa: buildSofa, chair: buildChair, bed: buildBed, wardrobe: buildWardrobe,
  shelf: buildShelf, lamp: buildLamp, tv: buildTv, fridge: buildFridge,
});

const COLORS = Object.freeze({
  fan: 0x6d9c85,
  sofa: 0x819f84,
  desk: 0xc2a97a,
  table: 0xb69b73,
  lamp: 0x86a88f,
  heater: 0xaab2aa,
  metal: 0x75877d,
  shade: 0xe3dfd0,
  windowFrame: 0x9aa6ad,
  windowGlass: 0x9fc8d1,
});

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.76, metalness: 0.02, ...options });
}

function box(group, size, position, color, options = {}) {
  const geometry = new THREE.BoxGeometry(size.width, size.height, size.depth);
  const mesh = new THREE.Mesh(geometry, material(color, options));
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cylinder(group, radiusTop, radiusBottom, height, position, color, radialSegments = 20) {
  const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments);
  const mesh = new THREE.Mesh(geometry, material(color));
  mesh.position.set(position.x, position.y, position.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function createFan(group, dimensions) {
  const { width, height, depth } = dimensions;
  const base = Math.min(width, depth) * 0.46;
  const headRadius = Math.min(width, depth) * 0.42;
  cylinder(group, base * 0.85, base, 0.08, { x: 0, y: -height / 2 + 0.04, z: 0 }, COLORS.metal);
  cylinder(group, 0.026, 0.034, height * 0.57, { x: 0, y: -height * 0.16, z: 0 }, COLORS.metal, 12);
  const headY = height * 0.24;
  const headZ = depth * 0.1;
  const cage = new THREE.Mesh(new THREE.TorusGeometry(headRadius * 0.76, 0.014, 6, 28), material(COLORS.metal));
  cage.position.set(0, headY, headZ + 0.025);
  group.add(cage);
  cylinder(group, headRadius * 0.72, headRadius * 0.72, depth * 0.12, { x: 0, y: headY, z: headZ }, 0xd7e2db, 20).rotation.x = Math.PI / 2;
  const bladeRadius = headRadius * 0.57;
  for (let index = 0; index < 3; index += 1) {
    const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), material(COLORS.fan));
    blade.scale.set(headRadius * 0.17, bladeRadius * 0.52, 0.017);
    blade.position.set(0, headY, headZ + 0.105);
    blade.rotation.z = index * (Math.PI * 2 / 3);
    group.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.14, 16, 12), material(0xf4f7f3));
  hub.position.set(0, headY, headZ + 0.13);
  group.add(hub);
}

function createSofa(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  box(group, { width: w * 0.92, height: h * 0.53, depth: d * 0.87 }, { x: 0, y: -h * 0.13, z: 0 }, 0x718f79);
  box(group, { width: w * 0.82, height: h * 0.18, depth: d * 0.77 }, { x: 0, y: -h * 0.04, z: d * 0.02 }, 0x9aaf91);
  box(group, { width: w * 0.88, height: h * 0.34, depth: d * 0.2 }, { x: 0, y: h * 0.16, z: -d * 0.34 }, 0x799681);
  for (const side of [-1, 1]) {
    box(group, { width: w * 0.09, height: h * 0.52, depth: d * 0.85 }, { x: side * w * 0.43, y: -h * 0.1, z: 0 }, 0x688570);
    box(group, { width: w * 0.19, height: h * 0.11, depth: d * 0.22 }, { x: side * w * 0.21, y: h * 0.1, z: -d * 0.2 }, 0xb7c5a8);
    cylinder(group, 0.025, 0.025, h * 0.14, { x: side * w * 0.38, y: -h * 0.43, z: d * 0.31 }, 0x786b56, 8);
  }
}

function createBed(group, dimensions) {
  const { width, height, depth } = dimensions;
  const frameHeight = height * 0.16;
  const mattressHeight = height * 0.42;
  const mattressY = -height / 2 + frameHeight + mattressHeight / 2;
  box(group, { width: width * 0.94, height: frameHeight, depth: depth * 0.94 }, { x: 0, y: -height / 2 + frameHeight / 2, z: 0 }, 0x786b5c);
  box(group, { width: width * 0.9, height: mattressHeight, depth: depth * 0.9 }, { x: 0, y: mattressY, z: 0 }, 0xe1dfd5);
  box(group, { width: width * 0.94, height, depth: depth * 0.09 }, { x: 0, y: 0, z: -depth * 0.43 }, 0x8b7e70);
  for (const side of [-1, 1]) {
    box(group, { width: width * 0.36, height: mattressHeight * 0.28, depth: depth * 0.14 }, { x: side * width * 0.22, y: mattressY + mattressHeight * 0.38, z: -depth * 0.3 }, 0xf4f2ea);
  }
}

function createDesk(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  const topH = Math.min(0.08, h * 0.12);
  box(group, { width: w, height: topH, depth: d }, { x: 0, y: h / 2 - topH / 2, z: 0 }, COLORS.desk);
  const legH = h - topH;
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      box(group, { width: Math.min(0.055, w * 0.07), height: legH, depth: Math.min(0.055, d * 0.1) }, { x: x * (w / 2 - 0.05), y: -topH / 2, z: z * (d / 2 - 0.05) }, 0x8f8069);
    }
  }
  box(group, { width: w * 0.28, height: h * 0.06, depth: d * 0.22 }, { x: -w * 0.08, y: h * 0.17, z: -d * 0.12 }, 0x8a9c91);
}

function createTable(group, dimensions, variant) {
  const { width: w, height: h, depth: d } = dimensions;
  const topH = Math.min(0.075, h * 0.22);
  const legH = Math.max(0.08, h - topH);
  if (variant === 'round') {
    const top = cylinder(group, w / 2, w / 2, topH, { x: 0, y: h / 2 - topH / 2, z: 0 }, COLORS.table, 40);
    top.scale.z = d / w;
    cylinder(group, 0.04, 0.05, legH, { x: 0, y: -topH / 2, z: 0 }, 0x8d7a61, 12);
    cylinder(group, Math.min(w, d) * 0.28, Math.min(w, d) * 0.3, 0.03, { x: 0, y: -h / 2 + 0.015, z: 0 }, 0x8d7a61, 24);
    return;
  }
  box(group, { width: w, height: topH, depth: d }, { x: 0, y: h / 2 - topH / 2, z: 0 }, COLORS.table);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      cylinder(group, 0.023, 0.03, legH, { x: x * w * 0.4, y: -topH / 2, z: z * d * 0.37 }, 0x8d7a61, 8);
    }
  }
}

// Shade spans most of the footprint so it reads as a lamp, not a pole.
function createLamp(group, dimensions) {
  const { width, height, depth } = dimensions;
  const footprint = Math.min(width, depth);
  const shadeHeight = Math.min(0.32, height * 0.26);
  const shadeBottom = footprint * 0.5;
  const shadeTop = footprint * 0.34;
  const shadeY = height / 2 - shadeHeight / 2;
  cylinder(group, footprint * 0.32, footprint * 0.38, 0.035, { x: 0, y: -height / 2 + 0.0175, z: 0 }, COLORS.metal, 24);
  cylinder(group, 0.014, 0.018, height - shadeHeight * 0.6, { x: 0, y: -shadeHeight * 0.3, z: 0 }, COLORS.metal, 10);
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(shadeTop, shadeBottom, shadeHeight, 32, 1, true),
    material(COLORS.shade, { side: THREE.DoubleSide, emissive: 0xffe2a8, emissiveIntensity: 0.18 }),
  );
  shade.position.y = shadeY;
  shade.castShadow = true;
  shade.userData.shade = true;
  group.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(Math.min(0.045, footprint * 0.14), 16, 12), material(0xfff4d6, { emissive: 0xffe7b0, emissiveIntensity: 1.4 }));
  bulb.position.y = shadeY - shadeHeight * 0.1;
  bulb.userData.noTint = true;
  group.add(bulb);
}

function createHeater(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  box(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, 0xe5e8e3);
  const count = Math.max(5, Math.floor(w * 13));
  for (let index = 0; index < count; index += 1) {
    const x = -w * 0.41 + (w * 0.82 * index) / Math.max(1, count - 1);
    box(group, { width: 0.012, height: h * 0.68, depth: 0.012 }, { x, y: 0, z: d * 0.52 }, 0xb5c0b8);
  }
  for (const side of [-1, 1]) {
    cylinder(group, 0.022, 0.025, h * 0.13, { x: side * w * 0.38, y: -h * 0.55, z: 0 }, 0x89968e, 8);
  }
}

// Windows by type. Each sets `openPart.apply(fraction)` so opening animates.
function createWindow(group, dimensions, props = {}) {
  const { width, height, depth } = dimensions;
  const frame = 0.045;
  const type = props.type ?? 'sliding';
  const rail = (size, position) => box(group, size, position, COLORS.windowFrame);
  rail({ width: frame, height, depth }, { x: -width / 2 + frame / 2, y: 0, z: 0 });
  rail({ width: frame, height, depth }, { x: width / 2 - frame / 2, y: 0, z: 0 });
  rail({ width, height: frame, depth }, { x: 0, y: -height / 2 + frame / 2, z: 0 });
  rail({ width, height: frame, depth }, { x: 0, y: height / 2 - frame / 2, z: 0 });
  const glassPane = (parent, paneWidth, paneHeight, x, y) => {
    box(parent, { width: paneWidth, height: paneHeight, depth: 0.01 }, { x, y, z: 0 }, COLORS.windowGlass, { transparent: true, opacity: 0.34, roughness: 0.18, depthWrite: false }).castShadow = false;
    box(parent, { width: paneWidth, height: 0.025, depth: 0.03 }, { x, y: y + paneHeight / 2, z: 0 }, COLORS.windowFrame);
    box(parent, { width: paneWidth, height: 0.025, depth: 0.03 }, { x, y: y - paneHeight / 2, z: 0 }, COLORS.windowFrame);
  };
  const innerWidth = width - frame * 2;
  const innerHeight = height - frame * 2;
  if (type === 'fixed') {
    glassPane(group, innerWidth, innerHeight, 0, 0);
    return;
  }
  if (type === 'sliding') {
    const paneWidth = innerWidth / 2;
    const fixedPane = new THREE.Group();
    fixedPane.position.z = -0.012;
    glassPane(fixedPane, paneWidth, innerHeight, -paneWidth / 2, 0);
    group.add(fixedPane);
    const sliding = new THREE.Group();
    sliding.position.z = 0.012;
    glassPane(sliding, paneWidth, innerHeight, 0, 0);
    group.add(sliding);
    group.userData.openPart = { apply: (f) => { sliding.position.x = paneWidth / 2 - f * (paneWidth - 0.02); } };
    return;
  }
  if (type === 'casement') {
    // Hinged at the left jamb, swinging into the room.
    const hinge = new THREE.Group();
    hinge.position.set(-innerWidth / 2, 0, depth / 2);
    glassPane(hinge, innerWidth, innerHeight, innerWidth / 2, 0);
    group.add(hinge);
    group.userData.openPart = { apply: (f) => { hinge.rotation.y = -f * Math.PI * 0.45; } };
    return;
  }
  // Top-hung (awning): hinged along the top, bottom tilts into the room.
  const hinge = new THREE.Group();
  hinge.position.set(0, innerHeight / 2, depth / 2);
  glassPane(hinge, innerWidth, innerHeight, 0, -innerHeight / 2);
  group.add(hinge);
  group.userData.openPart = { apply: (f) => { hinge.rotation.x = f * Math.PI * 0.2; } };
}

function createChair(group, { width: w, height: h, depth: d }) {
  const seatY = -h / 2 + h * 0.52;
  box(group, { width: w, height: 0.05, depth: d }, { x: 0, y: seatY, z: 0 }, 0xb59a74);
  box(group, { width: w, height: h * 0.45, depth: 0.04 }, { x: 0, y: seatY + h * 0.24, z: -d / 2 + 0.02 }, 0xa88d68);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    box(group, { width: 0.035, height: h * 0.52, depth: 0.035 }, { x: x * (w / 2 - 0.03), y: -h / 2 + h * 0.26, z: z * (d / 2 - 0.03) }, 0x7f6f59);
  }
}

function createWardrobe(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, 0xd8c7a6);
  box(group, { width: 0.012, height: h * 0.94, depth: 0.01 }, { x: 0, y: 0, z: d / 2 + 0.005 }, 0x8f7d62);
  for (const x of [-1, 1]) box(group, { width: 0.02, height: 0.2, depth: 0.03 }, { x: x * 0.05, y: 0, z: d / 2 + 0.02 }, 0x75877d);
}

function createShelf(group, { width: w, height: h, depth: d }) {
  for (const x of [-1, 1]) box(group, { width: 0.03, height: h, depth: d }, { x: x * (w / 2 - 0.015), y: 0, z: 0 }, 0xc2a97a);
  const count = Math.max(3, Math.round(h / 0.38));
  for (let index = 0; index <= count; index += 1) {
    box(group, { width: w - 0.06, height: 0.025, depth: d }, { x: 0, y: -h / 2 + 0.0125 + (h - 0.025) * index / count, z: 0 }, 0xc9b088);
    if (index < count) box(group, { width: w * 0.5, height: h / count * 0.6, depth: d * 0.7 }, { x: -w * 0.12 * (index % 2 ? 1 : -1), y: -h / 2 + (h / count) * (index + 0.35), z: 0 }, [0x8aa391, 0xc47b43, 0x7d93a8][index % 3]);
  }
}

function createPlant(group, { width: w, height: h }) {
  cylinder(group, w * 0.3, w * 0.22, h * 0.3, { x: 0, y: -h / 2 + h * 0.15, z: 0 }, 0xb98060);
  const foliage = new THREE.Mesh(new THREE.IcosahedronGeometry(w * 0.5, 1), material(0x5f8f5f, { flatShading: true }));
  foliage.scale.set(1, (h * 0.7) / w, 1);
  foliage.position.y = h * 0.15;
  foliage.castShadow = true;
  group.add(foliage);
}

function createFridge(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, 0xe6eae8);
  box(group, { width: w * 0.98, height: 0.01, depth: 0.01 }, { x: 0, y: h * 0.18, z: d / 2 + 0.005 }, 0x9aa5a0);
  box(group, { width: 0.025, height: h * 0.25, depth: 0.03 }, { x: w * 0.38, y: h * 0.32, z: d / 2 + 0.02 }, 0x75877d);
}

function createTv(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: h * 0.9, depth: d * 0.5 }, { x: 0, y: h * 0.05, z: 0 }, 0x1f2a2a, { roughness: 0.25 });
  box(group, { width: w * 0.3, height: h * 0.1, depth: d }, { x: 0, y: -h * 0.45, z: 0 }, 0x404a48);
}

function createAc(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, 0xf2f4f2);
  box(group, { width: w * 0.86, height: 0.02, depth: 0.04 }, { x: 0, y: -h * 0.38, z: d / 2 - 0.01 }, 0x9fb7c4);
  box(group, { width: 0.05, height: 0.012, depth: 0.004 }, { x: w * 0.38, y: h * 0.25, z: d / 2 + 0.002 }, 0x3fb68f, { emissive: 0x3fb68f });
}

function createCeilingLight(group, { width: w, height: h }) {
  cylinder(group, w * 0.5, w * 0.42, h, { x: 0, y: 0, z: 0 }, 0xf7f3e6, 28);
  const glow = cylinder(group, w * 0.4, w * 0.4, 0.004, { x: 0, y: -h / 2, z: 0 }, 0xfff3c4, 28);
  glow.material.emissive = new THREE.Color(0xffe9a8);
  glow.material.emissiveIntensity = 0.6;
}

function createRouter(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: h * 0.3, depth: d }, { x: 0, y: -h * 0.35, z: 0 }, 0x2c3b3a);
  for (const x of [-0.35, 0, 0.35]) cylinder(group, 0.007, 0.009, h * 0.7, { x: x * w, y: h * 0.15, z: -d * 0.3 }, 0x2c3b3a, 6);
  box(group, { width: 0.02, height: 0.006, depth: 0.004 }, { x: w * 0.3, y: -h * 0.3, z: d / 2 + 0.002 }, 0x3fb68f, { emissive: 0x3fb68f });
}

function createSpeaker(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, 0x6e5b48);
  for (const [y, r] of [[h * 0.15, w * 0.32], [-h * 0.22, w * 0.18]]) {
    cylinder(group, r, r, 0.02, { x: 0, y, z: d / 2 + 0.005 }, 0x2a2a2a, 24).rotation.x = Math.PI / 2;
  }
}

function createDoor(group, dimensions, props = {}) {
  const { width, height, depth } = dimensions;
  const frame = 0.05;
  const rightHinge = props.hinge === 'right';
  const outward = props.swing === 'out';
  const rail = (size, position) => box(group, size, position, 0xd6cbb5);
  rail({ width: frame, height, depth: depth * 1.6 }, { x: -width / 2 + frame / 2, y: 0, z: 0 });
  rail({ width: frame, height, depth: depth * 1.6 }, { x: width / 2 - frame / 2, y: 0, z: 0 });
  rail({ width, height: frame, depth: depth * 1.6 }, { x: 0, y: height / 2 - frame / 2, z: 0 });
  const hinge = new THREE.Group();
  const side = rightHinge ? 1 : -1;
  hinge.position.set(side * (width / 2 - frame), 0, (outward ? -1 : 1) * depth * 0.3);
  const leafWidth = width - frame * 2;
  box(hinge, { width: leafWidth, height: height - frame, depth: 0.04 }, { x: -side * leafWidth / 2, y: -frame / 2, z: 0 }, 0xb8936a);
  box(hinge, { width: 0.1, height: 0.02, depth: 0.05 }, { x: -side * (leafWidth - 0.1), y: 0, z: 0.04 }, 0x75877d);
  group.add(hinge);
  // Positive angle swings into the room (local +z); "out" swings the other way.
  const direction = (outward ? 1 : -1) * side;
  group.userData.openPart = { apply: (f) => { hinge.rotation.y = direction * f * Math.PI / 2; } };
}

function createMonitor(group, { width: w, height: h, depth: d }) {
  box(group, { width: w * 0.3, height: 0.015, depth: d * 0.8 }, { x: 0, y: -h / 2 + 0.0075, z: 0 }, 0x3a3d42);
  box(group, { width: 0.04, height: h * 0.35, depth: 0.03 }, { x: 0, y: -h / 2 + h * 0.18, z: -d * 0.15 }, 0x3a3d42);
  box(group, { width: w, height: h * 0.62, depth: 0.03 }, { x: 0, y: h * 0.17, z: 0 }, 0x1d2126, { roughness: 0.3 });
  box(group, { width: w * 0.95, height: h * 0.56, depth: 0.004 }, { x: 0, y: h * 0.17, z: 0.017 }, 0x26405e, { emissive: 0x1b3a5c, emissiveIntensity: 0.4 }).userData.noTint = true;
}
function createLaptop(group, { width: w, height: h, depth: d }) {
  box(group, { width: w, height: 0.018, depth: d }, { x: 0, y: -h / 2 + 0.009, z: 0 }, 0xb9bec4, { metalness: 0.6, roughness: 0.35 });
  const lid = box(group, { width: w, height: 0.008, depth: d }, { x: 0, y: -h / 2 + d / 2 * 0.95, z: -d / 2 - 0.02 }, 0xb9bec4, { metalness: 0.6, roughness: 0.35 });
  lid.rotation.x = Math.PI / 2 * 0.85;
}
function createBottle(group, { width: w, height: h }) {
  cylinder(group, w / 2, w / 2, h * 0.82, { x: 0, y: -h * 0.09, z: 0 }, 0x6fa3c4, 18);
  cylinder(group, w * 0.32, w * 0.38, h * 0.18, { x: 0, y: h * 0.41, z: 0 }, 0x2f3a44, 14);
}
function createBooks(group, { width: w, height: h, depth: d }) {
  const colours = [0x9c4a3c, 0x3c6a8a, 0xd8b45a, 0x5f7f6a];
  const count = Math.max(1, Math.round(h / 0.035));
  for (let index = 0; index < count; index += 1) {
    const shrink = 1 - (index % 3) * 0.06;
    box(group, { width: w * shrink, height: h / count * 0.95, depth: d * shrink }, { x: (index % 2 ? 0.01 : -0.01), y: -h / 2 + (index + 0.5) * h / count, z: 0 }, colours[index % colours.length]);
  }
}

const BUILDERS = Object.freeze({
  monitor: createMonitor, laptop: createLaptop, bottle: createBottle, books: createBooks,
  fan: createFan, sofa: createSofa, bed: createBed, desk: createDesk, table: createTable, lamp: createLamp, heater: createHeater,
  chair: createChair, wardrobe: createWardrobe, shelf: createShelf, plant: createPlant, fridge: createFridge, tv: createTv,
  ac: createAc, ceilingLight: createCeilingLight, deskLamp: createLamp, router: createRouter, speaker: createSpeaker,
});

const MATERIAL_TINTS = Object.freeze({ wood: 0xc2a97a, fabric: 0x8fa58e, metal: 0x9aa4a2, glass: 0xa9cfd6, plastic: 0xe4e6e2, stone: 0xc9c5bc, plant: 0x6f9a6f });

// Light-emitting models and where their bulb sits, as a fraction of height from the centre.
const LIGHT_SOURCES = Object.freeze({ lamp: { y: 0.36, power: 4500, lumens: 800 }, deskLamp: { y: 0.3, power: 2600, lumens: 450 }, ceilingLight: { y: -0.6, power: 6500, lumens: 1600 } });

export const VIEW_THEMES = Object.freeze({
  light: { background: 0xf2f4f7, grid: 0x8f9bb0, gridOpacity: 0.22, outline: 0x7d8aa3, handle: 0x2f6fe4 },
  dark: { background: 0x161a21, grid: 0x8c97ab, gridOpacity: 0.16, outline: 0x6b778c, handle: 0x5b93ff },
});

const ROOM_PLANES = (room) => [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), room.width / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), room.width / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), room.depth / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), room.depth / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.001),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), room.height),
];

const PLANE_RAMPS = Object.freeze({
  light: [[0.1, 0.1, 0.16], [0.36, 0.25, 0.42], [0.8, 0.45, 0.32], [0.98, 0.78, 0.4], [1, 0.98, 0.86]],
  wifi: [[0.86, 0.29, 0.25], [0.95, 0.66, 0.26], [0.55, 0.78, 0.42], [0.18, 0.62, 0.52], [0.12, 0.42, 0.62]],
  sound: [[0.16, 0.22, 0.42], [0.36, 0.33, 0.62], [0.72, 0.38, 0.6], [0.95, 0.55, 0.38], [0.99, 0.86, 0.5]],
});

// Lighting-design false colour on a log scale.
const LUX_STOPS = [[0, [0.12, 0.1, 0.32]], [50, [0.38, 0.2, 0.6]], [150, [0.85, 0.3, 0.45]], [300, [0.98, 0.55, 0.25]], [600, [1, 0.82, 0.3]], [1500, [1, 0.96, 0.62]], [5000, [1, 1, 0.95]]];
export function luxColor(lux) {
  let color = LUX_STOPS.at(-1)[1];
  for (let index = 1; index < LUX_STOPS.length; index += 1) {
    if (lux <= LUX_STOPS[index][0]) {
      const [l0, c0] = LUX_STOPS[index - 1];
      const [l1, c1] = LUX_STOPS[index];
      const t = (Math.log(lux + 10) - Math.log(l0 + 10)) / (Math.log(l1 + 10) - Math.log(l0 + 10));
      color = c0.map((value, channel) => value + (c1[channel] - value) * t);
      break;
    }
  }
  return color;
}

function rampColor(ramp, t) {
  const scaled = Math.min(0.9999, Math.max(0, t)) * (ramp.length - 1);
  const index = Math.floor(scaled);
  const f = scaled - index;
  return ramp[index].map((value, channel) => value + (ramp[index + 1][channel] - value) * f);
}

function disposeTree(root) {
  root.traverse((child) => {
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const item of materials) {
      for (const uniform of Object.values(item?.uniforms ?? {})) {
        if (uniform.value?.isTexture) uniform.value.dispose();
      }
      item?.dispose();
    }
  });
}

// Which bounding wall (if any) an outline edge lies on.
function edgeWall(a, b, room) {
  const eps = 1e-4;
  if (Math.abs(a[1]) < eps && Math.abs(b[1]) < eps) return 'front';
  if (Math.abs(a[1] - room.depth) < eps && Math.abs(b[1] - room.depth) < eps) return 'back';
  if (Math.abs(a[0]) < eps && Math.abs(b[0]) < eps) return 'left';
  if (Math.abs(a[0] - room.width) < eps && Math.abs(b[0] - room.width) < eps) return 'right';
  return null;
}

// A wall panel along the outline edge a→b, with holes for openings on it.
function createEdgeWall(a, b, height, openings, room) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(length, 0);
  shape.lineTo(length, height);
  shape.lineTo(0, height);
  shape.closePath();
  const wall = edgeWall(a, b, room);
  for (const opening of openings.filter((item) => item.wall === wall)) {
    const along = (opening.position.x - a[0]) * direction[0] + (opening.position.z - a[1]) * direction[1];
    const half = opening.dimensions.width / 2;
    if (along - half < -1e-3 || along + half > length + 1e-3) continue;
    const bottom = Math.max(0.005, opening.position.y);
    const top = Math.min(height - 0.005, bottom + opening.dimensions.height);
    const hole = new THREE.Path();
    hole.moveTo(along - half, bottom);
    hole.lineTo(along - half, top);
    hole.lineTo(along + half, top);
    hole.lineTo(along + half, bottom);
    hole.closePath();
    shape.holes.push(hole);
  }
  const geometry = new THREE.ShapeGeometry(shape);
  return { geometry, angle: Math.atan2(-direction[1], direction[0]) };
}

export class RoomViewport {
  constructor(container, { onSelect = () => {}, onTransform = () => {}, onDragChange = () => {}, onProbe = () => {}, onRoomResize = () => {}, onContextMenu = () => {} } = {}) {
    this.container = container;
    this.onProbe = onProbe;
    this.onRoomResize = onRoomResize;
    this.onContextMenu = onContextMenu;
    this.theme = 'light';
    this.dynamicLights = [];
    this.handles = [];
    this.resizing = null;
    this.dimLabels = {};
    this.environment = null;
    this.planeField = null;
    this.planeMesh = null;
    this.sunLight = null;
    this.onSelect = onSelect;
    this.onTransform = onTransform;
    this.onDragChange = onDragChange;
    this.roomScene = null;
    this.selectedId = null;
    this.groups = new Map();
    this.fieldLayer = null;
    this.lightingPreview = false;
    this.lightingLights = [];
    this.pointerStart = null;
    this.isTopView = false;
    this.projection = 'perspective';
    this.orthoFrustumHeight = 8;
    this.transformMode = 'translate';
    this.hoveredId = null;
    this.hoverBox = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf6f8f6);
    this.sceneRoot = new THREE.Group();
    this.scene.add(this.sceneRoot);
    this.perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    this.perspectiveCamera.position.set(7.5, 6.1, 8.2);
    this.orthographicCamera = new THREE.OrthographicCamera(-4, 4, 4, -4, 0.05, 200);
    this.camera = this.perspectiveCamera;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.id = 'room-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Three-dimensional room. Click an object to select it.');
    this.renderer.domElement.dataset.projection = this.projection;
    mountViewportCanvas(this.container, this.renderer.domElement);

    this.hemisphereLight = new THREE.HemisphereLight(0xeaf3ed, 0x97a38f, 2.1);
    this.keyLight = new THREE.DirectionalLight(0xfff7e9, 2.6);
    this.keyLight.position.set(-4, 8, 6);
    this.scene.add(this.hemisphereLight, this.keyLight);
    this.setupControls(this.camera, new THREE.Vector3(0, 1.1, 0));

    this.selectionBox = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      // A view change animates the camera; grabbing the view must cancel it, or
      // the tween and OrbitControls fight and drags feel wrong.
      gsap.killTweensOf(this.camera.position);
      this.handleResizeStart(event);
    }, { capture: true });
    this.renderer.domElement.addEventListener('wheel', () => gsap.killTweensOf(this.camera.position), { capture: true, passive: true });
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
    this.renderer.domElement.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const objectId = this.objectAtPointer(event.clientX, event.clientY);
      if (objectId) {
        this.select(objectId);
        this.onSelect(objectId);
      }
      this.onContextMenu({ objectId, clientX: event.clientX, clientY: event.clientY });
    });
    this.renderer.domElement.addEventListener('dblclick', (event) => {
      const objectId = this.objectAtPointer(event.clientX, event.clientY);
      if (objectId) this.onActivate?.(objectId);
    });
    window.addEventListener('pointermove', (event) => this.handleResizeMove(event));
    window.addEventListener('pointerup', (event) => this.handleResizeEnd(event));
    this.createViewCube();
    for (const axis of ['width', 'depth']) {
      const label = document.createElement('div');
      label.className = 'dim-label';
      label.dataset.axis = axis;
      this.container.append(label);
      this.dimLabels[axis] = label;
    }
    this.renderer.domElement.addEventListener('pointermove', (event) => this.handlePointerMove(event));
    this.renderer.domElement.addEventListener('pointerup', (event) => this.handlePointerUp(event));
    this.prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate = this.animate.bind(this);
    this.frameRequest = requestAnimationFrame(this.animate);
  }

  resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    if (this.camera.isPerspectiveCamera) {
      this.camera.aspect = width / height;
    } else {
      this.camera.left = -this.orthoFrustumHeight * width / height / 2;
      this.camera.right = this.orthoFrustumHeight * width / height / 2;
      this.camera.top = this.orthoFrustumHeight / 2;
      this.camera.bottom = -this.orthoFrustumHeight / 2;
    }
    this.camera.updateProjectionMatrix();
  }

  setupControls(camera, target) {
    const selectedId = this.selectedId;
    this.orbit?.dispose();
    if (this.transform) {
      this.transform.detach();
      this.scene.remove(this.transform.getHelper());
      this.transform.dispose();
    }
    this.camera = camera;
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.075;
    this.orbit.target.copy(target);
    this.orbit.minDistance = 2.5;
    this.orbit.maxDistance = 40;
    this.orbit.maxPolarAngle = Math.PI * 0.48;
    this.orbit.enableRotate = !this.isTopView;
    this.orbit.enablePan = !this.isTopView;
    this.orbit.update();

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode(this.transformMode);
    this.transform.setSpace('world');
    this.transform.setSize(0.8);
    this.transform.addEventListener('dragging-changed', (event) => {
      this.orbit.enabled = !event.value;
      this.onDragChange(event.value);
    });
    this.transform.addEventListener('objectChange', () => this.handleObjectChange());
    this.scene.add(this.transform.getHelper());
    this.softenGizmo();
    if (selectedId && this.groups.has(selectedId)) this.transform.attach(this.groups.get(selectedId));
  }

  // Muted axis colours: the stock pure red/green/blue gizmo is harsh next to the room.
  softenGizmo() {
    const muted = this.theme === 'dark'
      ? { r: 0xe08b80, g: 0x8fc49b, b: 0x86a9e0 }
      : { r: 0xc9695e, g: 0x5f9d6d, b: 0x5b85c4 };
    this.transform.getHelper().traverse((child) => {
      const item = child.material;
      if (!item?.color) return;
      const { r, g, b } = item.color;
      let hex = null;
      if (r > 0.6 && g < 0.4 && b < 0.4) hex = muted.r;
      else if (g > 0.6 && r < 0.4 && b < 0.4) hex = muted.g;
      else if (b > 0.6 && r < 0.4 && g < 0.4) hex = muted.b;
      if (hex === null) return;
      item.color.setHex(hex);
      item._color = item.color.clone();
    });
  }

  // Floor furniture slides on the floor and turns about the vertical; only
  // mounted things (windows, AC, lights, routers) get a vertical handle.
  updateGizmoAxes() {
    const object = this.roomScene?.objects.find((item) => item.id === this.selectedId);
    const mounted = object && (isWallItem(object) || ['ac', 'ceilingLight', 'router', 'deskLamp', 'speaker', 'tv'].includes(object.model) || object.position.y > 0.05);
    if (this.transformMode === 'rotate') {
      this.transform.showX = false;
      this.transform.showZ = false;
      this.transform.showY = true;
    } else {
      this.transform.showX = true;
      this.transform.showZ = true;
      this.transform.showY = Boolean(mounted);
    }
  }

  setProjection(projection) {
    if (!['perspective', 'orthographic'].includes(projection) || projection === this.projection) return;
    const target = this.orbit.target.clone();
    const position = this.camera.position.clone();
    const up = this.camera.up.clone();
    if (projection === 'orthographic') {
      const distance = position.distanceTo(target);
      this.orthoFrustumHeight = this.isTopView
        ? Math.max(this.roomScene.room.width, this.roomScene.room.depth) * 1.3
        : Math.max(2, 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2)));
      const aspect = Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
      this.orthographicCamera.left = -this.orthoFrustumHeight * aspect / 2;
      this.orthographicCamera.right = this.orthoFrustumHeight * aspect / 2;
      this.orthographicCamera.top = this.orthoFrustumHeight / 2;
      this.orthographicCamera.bottom = -this.orthoFrustumHeight / 2;
      this.orthographicCamera.position.copy(position);
      this.orthographicCamera.up.copy(up);
      this.orthographicCamera.lookAt(target);
      this.orthographicCamera.updateProjectionMatrix();
      this.camera = this.orthographicCamera;
    } else {
      this.perspectiveCamera.position.copy(position);
      this.perspectiveCamera.up.copy(up);
      this.perspectiveCamera.lookAt(target);
      this.perspectiveCamera.updateProjectionMatrix();
      this.camera = this.perspectiveCamera;
    }
    this.projection = projection;
    this.setupControls(this.camera, target);
    this.renderer.domElement.dataset.projection = projection;
  }

  buildRoom() {
    const room = this.roomScene.room;
    const { width, depth, height } = room;
    const theme = VIEW_THEMES[this.theme];
    const surfaces = sceneSurfaces(this.roomScene);
    const floorSurface = SURFACE_MATERIALS.floor[surfaces.floor] ?? SURFACE_MATERIALS.floor.wood;
    const wallSurface = SURFACE_MATERIALS.walls[surfaces.walls] ?? SURFACE_MATERIALS.walls.paint;
    const outline = floorOutline(room);
    const toWorld = ([x, z]) => [x - width / 2, z - depth / 2];

    const floorShape = new THREE.Shape(outline.map((point) => {
      const [x, z] = toWorld(point);
      return new THREE.Vector2(x, -z);
    }));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), material(floorSurface.color, { roughness: surfaces.floor === 'tile' ? 0.4 : 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    this.sceneRoot.add(floor);

    const gridPoints = [];
    const step = 0.1;
    for (let x = 0; x <= width + 1e-3; x += 0.5) {
      for (let z = 0; z < depth - 1e-3; z += step) {
        if (floorContains(room, Math.min(x, width - 1e-3) || 1e-3, z + step / 2)) gridPoints.push(new THREE.Vector3(x - width / 2, 0.006, z - depth / 2), new THREE.Vector3(x - width / 2, 0.006, Math.min(depth, z + step) - depth / 2));
      }
    }
    for (let z = 0; z <= depth + 1e-3; z += 0.5) {
      for (let x = 0; x < width - 1e-3; x += step) {
        if (floorContains(room, x + step / 2, Math.min(z, depth - 1e-3) || 1e-3)) gridPoints.push(new THREE.Vector3(x - width / 2, 0.006, z - depth / 2), new THREE.Vector3(Math.min(width, x + step) - width / 2, 0.006, z - depth / 2));
      }
    }
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPoints), new THREE.LineBasicMaterial({ color: theme.grid, transparent: true, opacity: theme.gridOpacity }));
    this.sceneRoot.add(grid);

    const wallMaterial = material(wallSurface.color, { transparent: true, opacity: this.theme === 'dark' ? 0.14 : 0.2, side: THREE.DoubleSide, depthWrite: false });
    const openings = this.roomScene.objects.filter(isWallItem);
    const linePoints = [];
    for (let index = 0; index < outline.length; index += 1) {
      const a = outline[index];
      const b = outline[(index + 1) % outline.length];
      const { geometry, angle } = createEdgeWall(a, b, height, openings, room);
      const mesh = new THREE.Mesh(geometry, wallMaterial.clone());
      const [x, z] = toWorld(a);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = angle;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.roomWall = true;
      this.sceneRoot.add(mesh);
      const [bx, bz] = toWorld(b);
      linePoints.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(bx, 0, bz), new THREE.Vector3(x, height, z), new THREE.Vector3(bx, height, bz));
      const previous = outline[(index - 1 + outline.length) % outline.length];
      const turn = Math.abs((a[0] - previous[0]) * (b[1] - a[1]) - (a[1] - previous[1]) * (b[0] - a[0]));
      if (turn > 0.01 * Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(a[0] - previous[0], a[1] - previous[1]) * 10) {
        linePoints.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, height, z));
      }
    }
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePoints), new THREE.LineBasicMaterial({ color: theme.outline, transparent: true, opacity: 0.8 }));
    this.sceneRoot.add(lines);

    // Invisible ceiling: casts shadows only, so sunlight enters through windows.
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width + 0.4, depth + 0.4), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    ceiling.castShadow = true;
    ceiling.userData.roomWall = true;
    this.sceneRoot.add(ceiling);
    this.buildHandles();
  }

  // ─── Room resize handles ─────────────────────────────────────────────────
  buildHandles() {
    const { width, depth } = this.roomScene.room;
    const color = VIEW_THEMES[this.theme].handle;
    this.handles = [];
    for (const [axis, x, z, rotation] of [['width', width / 2 + 0.28, 0, 0], ['depth', 0, depth / 2 + 0.28, Math.PI / 2]]) {
      const handle = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.02, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }));
      handle.add(disc);
      for (const side of [-1, 1]) {
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        arrow.rotation.z = side * -Math.PI / 2;
        arrow.position.set(side * 0.07, 0.02, 0);
        handle.add(arrow);
      }
      handle.rotation.y = rotation;
      handle.position.set(x, 0.03, z);
      handle.userData.resizeAxis = axis;
      handle.renderOrder = 5;
      this.sceneRoot.add(handle);
      this.handles.push(handle);
    }
  }

  handleAt(clientX, clientY) {
    if (!this.handles.length || this.isTopView === undefined) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.handles, true)[0];
    let target = hit?.object;
    while (target && !target.userData.resizeAxis) target = target.parent;
    return target ?? null;
  }

  floorPoint(clientX, clientY) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  handleResizeStart(event) {
    if (event.button !== 0 || this.cubeHit(event)) return;
    const handle = this.handleAt(event.clientX, event.clientY);
    if (!handle) return;
    event.stopImmediatePropagation();
    this.orbit.enabled = false;
    const room = this.roomScene.room;
    this.resizing = { axis: handle.userData.resizeAxis, handle, start: { ...room }, value: room[handle.userData.resizeAxis] };
    this.renderer.domElement.style.cursor = 'grabbing';
  }

  handleResizeMove(event) {
    if (!this.resizing) {
      if (event.target === this.renderer.domElement && !this.transform.dragging) {
        const handle = this.handleAt(event.clientX, event.clientY);
        if (handle) this.renderer.domElement.style.cursor = handle.userData.resizeAxis === 'width' ? 'ew-resize' : 'ns-resize';
      }
      return;
    }
    const point = this.floorPoint(event.clientX, event.clientY);
    if (!point) return;
    const { axis, start, handle } = this.resizing;
    const raw = axis === 'width' ? point.x + start.width / 2 - 0.28 : point.z + start.depth / 2 - 0.28;
    const value = Math.round(Math.min(20, Math.max(2, raw)) * 20) / 20;
    this.resizing.value = value;
    if (axis === 'width') handle.position.x = value - start.width / 2 + 0.28;
    else handle.position.z = value - start.depth / 2 + 0.28;
    this.updateDimLabels?.();
  }

  handleResizeEnd() {
    if (!this.resizing) return;
    const { axis, value, start } = this.resizing;
    this.resizing = null;
    this.orbit.enabled = true;
    this.renderer.domElement.style.cursor = '';
    if (Math.abs(value - start[axis]) > 0.01) this.onRoomResize({ [axis]: value });
    else this.updateDimLabels();
  }

  updateDimLabels() {
    if (!this.roomScene) return;
    const bounds = this.container.getBoundingClientRect();
    const visible = !this.planeMesh && !this.fieldLayer;
    for (const handle of this.handles) {
      const axis = handle.userData.resizeAxis;
      const label = this.dimLabels[axis];
      const value = this.resizing?.axis === axis ? this.resizing.value : this.roomScene.room[axis];
      const position = handle.getWorldPosition(new THREE.Vector3());
      position.y += 0.05;
      position.project(this.camera);
      const offscreen = position.z > 1 || Math.abs(position.x) > 1.05 || Math.abs(position.y) > 1.05;
      label.hidden = !visible || offscreen;
      if (label.hidden) continue;
      label.textContent = `${axis === 'width' ? 'W' : 'D'} ${value.toFixed(2)} m`;
      label.classList.toggle('active', this.resizing?.axis === axis);
      label.style.transform = `translate(${(position.x + 1) / 2 * bounds.width}px, ${(1 - position.y) / 2 * bounds.height}px) translate(-50%, -150%)`;
    }
  }

  // ─── View cube (Onshape-style) ───────────────────────────────────────────
  createViewCube() {
    this.cubeScene = new THREE.Scene();
    this.cubeCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
    const labels = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'BACK', 'FRONT'];
    this.cubeMaterials = labels.map((label) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 128;
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      const faceMaterial = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      faceMaterial.userData = { canvas, label };
      return faceMaterial;
    });
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), this.cubeMaterials);
    this.cube.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.cube.geometry), new THREE.LineBasicMaterial({ color: 0x8090a8 })));
    this.cubeScene.add(this.cube);
    this.paintViewCube();
  }

  paintViewCube(hoverIndex = -1) {
    const dark = this.theme === 'dark';
    this.cubeMaterials.forEach((faceMaterial, index) => {
      const { canvas, label } = faceMaterial.userData;
      const context = canvas.getContext('2d');
      context.fillStyle = index === hoverIndex ? (dark ? '#2b4a80' : '#dbe7ff') : (dark ? '#262b34' : '#ffffff');
      context.fillRect(0, 0, 128, 128);
      context.fillStyle = dark ? '#d6dce6' : '#2a3342';
      context.font = '600 24px Geist, system-ui, sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, 64, 64);
      faceMaterial.map.needsUpdate = true;
    });
  }

  cubeRect() {
    const size = 84;
    const width = this.container.clientWidth;
    return { x: width - size - 18 - (this.rightInset ?? 0), y: 70, size };
  }

  // Screen position of the top of an object, for anchoring floating UI.
  screenPositionOf(objectId) {
    const group = this.groups.get(objectId);
    if (!group) return null;
    const box = new THREE.Box3().setFromObject(group);
    const point = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).project(this.camera);
    const right = new THREE.Vector3(box.max.x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2).project(this.camera);
    return {
      x: (point.x + 1) / 2 * this.container.clientWidth,
      y: (1 - point.y) / 2 * this.container.clientHeight,
      right: (Math.max(point.x, right.x) + 1) / 2 * this.container.clientWidth,
      visible: point.z < 1 && Math.abs(point.x) < 1.1 && Math.abs(point.y) < 1.1,
    };
  }

  // Room coordinates of the floor under a screen point (for drag-and-drop).
  roomPointAt(clientX, clientY) {
    const point = this.floorPoint(clientX, clientY);
    if (!point || !this.roomScene) return null;
    const x = point.x + this.roomScene.room.width / 2;
    const z = point.z + this.roomScene.room.depth / 2;
    if (!floorContains(this.roomScene.room, x, z)) return null;
    return { x, z };
  }

  cubeHit(event) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    const rect = this.cubeRect();
    const x = event.clientX - bounds.left - rect.x;
    const y = event.clientY - bounds.top - rect.y;
    if (x < 0 || y < 0 || x > rect.size || y > rect.size) return null;
    const pointer = new THREE.Vector2(x / rect.size * 2 - 1, -(y / rect.size) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.cubeCamera);
    const hit = this.raycaster.intersectObject(this.cube, false)[0];
    return hit ? { faceIndex: hit.face.materialIndex, normal: hit.face.normal.clone() } : { faceIndex: -1 };
  }

  renderViewCube() {
    const rect = this.cubeRect();
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.cubeCamera.position.copy(direction.multiplyScalar(4));
    this.cubeCamera.up.copy(this.camera.up);
    this.cubeCamera.lookAt(0, 0, 0);
    const height = this.container.clientHeight;
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(rect.x, height - rect.y - rect.size, rect.size, rect.size);
    this.renderer.setViewport(rect.x, height - rect.y - rect.size, rect.size, rect.size);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.cubeScene, this.cubeCamera);
    this.renderer.autoClear = true;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, this.container.clientWidth, height);
  }

  // Animate the camera to look at the room from a world direction.
  viewFrom(direction) {
    if (direction.y > 0.9) {
      this.setViewAnimated('top');
      return 'top';
    }
    this.isTopView = false;
    this.orbit.enableRotate = true;
    this.orbit.enablePan = true;
    const distance = Math.max(this.roomScene.room.width, this.roomScene.room.depth) * 1.9;
    const target = this.orbit.target.set(0, this.roomScene.room.height / 2, 0);
    const destination = target.clone().addScaledVector(direction.clone().normalize(), distance);
    if (Math.abs(direction.y) < 0.1) destination.y += 0.4;
    this.camera.up.set(0, 1, 0);
    gsap.killTweensOf(this.camera.position);
    gsap.to(this.camera.position, {
      x: destination.x, y: destination.y, z: destination.z, duration: this.prefersReducedMotion ? 0 : 0.55, ease: 'power3.inOut',
      onUpdate: () => this.camera.lookAt(this.orbit.target),
    });
    return '3d';
  }

  // Spinning blades and oscillating heads.
  animateFans(seconds) {
    if (this.prefersReducedMotion || !this.groups) return;
    const delta = Math.min(0.05, seconds - (this.lastFanTime ?? seconds));
    this.lastFanTime = seconds;
    for (const group of this.groups.values()) {
      const fan = group.userData.fan;
      if (!fan) continue;
      fan.blades.rotation.z += delta * (6 + fan.speed * 7);
      if (fan.oscillate) fan.head.rotation.y = fan.yaw + Math.sin(seconds * 0.55) * 0.75;
    }
  }

  // ─── Reference layers: a 3D scan ghost and a floor-plan underlay ──────────
  setReference(root, bounds) {
    if (this.reference) {
      this.scene.remove(this.reference);
      disposeTree(this.reference);
      this.reference = null;
    }
    if (!root) return;
    const ghost = new THREE.MeshStandardMaterial({ color: 0x7f9bd6, transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide });
    root.traverse((child) => {
      if (!child.isMesh && !child.isPoints) return;
      child.material = ghost;
      child.castShadow = false;
      child.raycast = () => {};
    });
    const group = new THREE.Group();
    group.add(root);
    group.userData.bounds = bounds.clone();
    group.renderOrder = 1;
    this.reference = group;
    this.positionReferences();
    this.scene.add(group);
  }

  setUnderlay(underlay) {
    if (this.underlay) {
      this.scene.remove(this.underlay);
      this.underlay.material.map?.dispose();
      disposeTree(this.underlay);
      this.underlay = null;
    }
    if (!underlay?.image) return;
    const texture = new THREE.TextureLoader().load(underlay.image);
    texture.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(underlay.widthMeters, underlay.depthMeters),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: underlay.opacity ?? 0.55, depthWrite: false, toneMapped: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 0;
    mesh.raycast = () => {};
    mesh.userData.underlay = underlay;
    this.underlay = mesh;
    this.positionReferences();
    this.scene.add(mesh);
  }

  positionReferences() {
    if (!this.roomScene) return;
    const { width, depth } = this.roomScene.room;
    if (this.reference) {
      const bounds = this.reference.userData.bounds;
      this.reference.position.set(-width / 2 - bounds.min.x, -bounds.min.y, -depth / 2 - bounds.min.z);
    }
    if (this.underlay) {
      const { centerX, centerZ } = this.underlay.userData.underlay;
      this.underlay.position.set(centerX - width / 2, -0.004, centerZ - depth / 2);
    }
  }

  setTheme(theme) {
    this.theme = theme === 'dark' ? 'dark' : 'light';
    this.scene.background = new THREE.Color(VIEW_THEMES[this.theme].background);
    this.paintViewCube();
    this.softenGizmo();
    if (this.roomScene) this.setScene(this.roomScene, this.selectedId);
  }

  createObjectGroup(object) {
    const group = new THREE.Group();
    group.name = object.id;
    group.userData.objectId = object.id;
    group.userData.primitive = object.primitive;
    group.userData.model = object.model;
    const builder = BUILDERS[object.model];
    const materialKey = objectMaterial(object);
    if (object.model === 'window') createWindow(group, object.dimensions, object.props);
    else if (object.model === 'door') createDoor(group, object.dimensions, object.props);
    else if (object.model === 'fan') buildFan(group, object.dimensions, object.props);
    else if (STYLED_BUILDERS[object.model]) STYLED_BUILDERS[object.model](group, object.dimensions, styleOf(object));
    else if (builder) builder(group, object.dimensions, object.variant);
    else box(group, object.dimensions, { x: 0, y: 0, z: 0 }, MATERIAL_TINTS[materialKey] ?? COLORS.metal);
    // Main colour → 'primary' parts (and untagged ones); second colour → legs and frames.
    if ((object.color || object.color2) && !isWallItem(object)) {
      const primary = object.color ? new THREE.Color(object.color) : null;
      const secondary = object.color2 ? new THREE.Color(object.color2) : null;
      group.traverse((child) => {
        const item = child.material;
        if (!item?.color || child.userData.noTint || item.emissiveIntensity > 0.5) return;
        const role = child.userData.part;
        if (['decor', 'mirror', 'screen', 'shade'].includes(role)) return;
        const tint = role === 'secondary' ? secondary : primary;
        if (tint) item.color.copy(tint);
      });
    }
    const surface = MATERIALS[materialKey];
    if (surface && !isWallItem(object)) {
      group.traverse((child) => {
        if (!child.material?.isMeshStandardMaterial || child.material.transparent || child.userData.part === 'secondary' || child.userData.part === 'mirror') return;
        child.material.roughness = surface.roughness;
        child.material.metalness = surface.metalness;
      });
    }
    group.userData.open = object.open;
    const part = group.userData.openPart;
    if (part) {
      // Animate from the last state this viewport showed, so changes read as motion.
      this.openStates ??= new Map();
      const target = openFraction(object);
      const was = this.openStates.get(object.id);
      const state = { f: was ?? target };
      part.apply(state.f);
      if (was !== undefined && Math.abs(was - target) > 0.001) {
        gsap.to(state, { f: target, duration: this.prefersReducedMotion ? 0 : 0.7, ease: 'power2.inOut', onUpdate: () => { part.apply(state.f); this.selectionBox?.update(); } });
      }
      this.openStates.set(object.id, target);
    }
    this.applyObjectTransform(group, object);
    this.sceneRoot.add(group);
    this.groups.set(object.id, group);
    return group;
  }

  applyObjectTransform(group, object) {
    group.position.set(
      object.position.x - this.roomScene.room.width / 2,
      object.position.y + object.dimensions.height / 2,
      object.position.z - this.roomScene.room.depth / 2,
    );
    group.rotation.set(
      THREE.MathUtils.degToRad(object.rotation.x),
      THREE.MathUtils.degToRad(object.rotation.y),
      THREE.MathUtils.degToRad(object.rotation.z),
    );
  }

  setScene(roomScene, selectedId = this.selectedId) {
    const showLighting = this.lightingPreview;
    const roomKey = JSON.stringify(roomScene.room);
    const roomChanged = roomKey !== this.roomKey;
    this.roomKey = roomKey;
    const keptPlane = this.planeField;
    this.clearPlaneField();
    this.clearFields();
    this.clearHover();
    this.transform.detach();
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      disposeTree(this.selectionBox);
      this.selectionBox = null;
    }
    const keptLayers = [...(this.layers?.values() ?? [])];
    for (const child of [...this.sceneRoot.children]) {
      if (keptLayers.includes(child)) continue;
      this.sceneRoot.remove(child);
      disposeTree(child);
    }
    this.groups.clear();
    this.roomScene = roomScene;
    this.buildRoom();
    for (const object of roomScene.objects) this.createObjectGroup(object);
    this.select(selectedId);
    if (roomChanged) this.fitRoom(false);
    if (showLighting) this.setLightingPreview(true);
    else this.rebuildLights();
    if (keptPlane && !roomChanged) this.setPlaneField(keptPlane);
    this.positionReferences();
  }

  // Several lenses at once: one volume layer per lens.
  setLayer(mode, result) {
    this.layers ??= new Map();
    this.clearLayer(mode);
    if (!result) return;
    const layer = createRoomFieldLayer(result, mode);
    this.layers.set(mode, layer);
    this.sceneRoot.add(layer);
  }

  clearLayer(mode) {
    const layer = this.layers?.get(mode);
    if (!layer) return;
    this.sceneRoot.remove(layer);
    disposeTree(layer);
    this.layers.delete(mode);
  }

  setFields(result, mode) {
    this.clearFields();
    if (mode === 'light') {
      this.setLightingPreview(true);
      this.fieldLayer = null;
    } else {
      this.fieldLayer = createRoomFieldLayer(result, mode);
      this.sceneRoot.add(this.fieldLayer);
    }
    this.renderer.domElement.dataset.fieldMode = mode;
    this.renderer.domElement.dataset.fieldCells = String(result.grid.nx * result.grid.ny * result.grid.nz);
    this.renderer.domElement.dataset.fieldBackend = result.backend ?? 'cpu-preview';
    this.renderer.domElement.dataset.fieldCellSize = String(result.grid.cellSize ?? Math.max(result.grid.dx, result.grid.dy, result.grid.dz));
    this.renderer.domElement.dataset.fieldMaxSpeed = String(result.stats.maxSpeed ?? 0);
    this.renderer.domElement.dataset.fieldRmsDivergence = String(result.stats.rmsDivergence ?? 0);
    this.renderer.domElement.dataset.fieldMaxTemperature = String(result.stats.maxTemperature ?? result.stats.maxLevel ?? 0);
    this.renderer.domElement.dataset.fieldVolumeVoxels = String(this.fieldLayer?.userData.volumeVoxelCount ?? 0);
    if (mode === 'airflow' && this.fieldLayer) {
      this.renderer.domElement.dataset.streamlineVertices = String(this.fieldLayer.userData.streamlineVertexCount);
    }
    this.renderer.domElement.dataset.fieldRevision = String(Number(this.renderer.domElement.dataset.fieldRevision ?? 0) + 1);
  }

  // Replace the overlay volume without touching the light preview (used by the
  // Light lens, which keeps its shadowed render underneath the lux volume).
  setOverlayField(result, mode) {
    if (this.fieldLayer) {
      this.sceneRoot.remove(this.fieldLayer);
      disposeTree(this.fieldLayer);
      this.fieldLayer = null;
    }
    if (!result) return;
    this.fieldLayer = createRoomFieldLayer(result, mode);
    this.sceneRoot.add(this.fieldLayer);
  }

  // A line from a source to the probed point, coloured by level along it.
  setProbeLine(from, to, colors) {
    if (this.probeLine) {
      this.scene.remove(this.probeLine);
      disposeTree(this.probeLine);
      this.probeLine = null;
    }
    if (!from || !this.roomScene) return;
    const { width, depth } = this.roomScene.room;
    const points = colors.map((_, index) => {
      const t = index / (colors.length - 1);
      return new THREE.Vector3(from.x + (to.x - from.x) * t - width / 2, from.y + (to.y - from.y) * t, from.z + (to.z - from.z) * t - depth / 2);
    });
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors.flat(), 3));
    this.probeLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, linewidth: 2 }));
    this.probeLine.renderOrder = 6;
    this.scene.add(this.probeLine);
  }

  // Screen position of a room-space point (for pins).
  projectRoomPoint(point) {
    if (!this.roomScene) return null;
    const vector = new THREE.Vector3(point.x - this.roomScene.room.width / 2, point.y, point.z - this.roomScene.room.depth / 2).project(this.camera);
    return { x: (vector.x + 1) / 2 * this.container.clientWidth, y: (1 - vector.y) / 2 * this.container.clientHeight, visible: vector.z < 1 };
  }

  clearFields() {
    if (this.fieldLayer) {
      this.sceneRoot.remove(this.fieldLayer);
      disposeTree(this.fieldLayer);
      this.fieldLayer = null;
    }
    this.setLightingPreview(false);
    delete this.renderer.domElement.dataset.fieldMode;
    delete this.renderer.domElement.dataset.fieldCells;
    delete this.renderer.domElement.dataset.fieldBackend;
    delete this.renderer.domElement.dataset.fieldCellSize;
    delete this.renderer.domElement.dataset.fieldMaxSpeed;
    delete this.renderer.domElement.dataset.fieldRmsDivergence;
    delete this.renderer.domElement.dataset.fieldMaxTemperature;
    delete this.renderer.domElement.dataset.fieldVolumeVoxels;
    delete this.renderer.domElement.dataset.streamlineVertices;
  }

  // Light lens: the same full-colour room, lit only by what is physically there
  // (sky through windows, sun, lamps) instead of the studio fill light.
  setLightingPreview(enabled) {
    if (enabled === this.lightingPreview) return;
    this.lightingPreview = enabled;
    this.renderer.toneMappingExposure = enabled ? 1.15 : 1.04;
    this.rebuildLights();
    this.renderer.domElement.dataset.lightingPreview = String(enabled);
    if (enabled) {
      this.renderer.domElement.dataset.fieldMode = 'light';
      this.renderer.domElement.dataset.fieldVolumeVoxels = '0';
    } else this.setSurfaceMap(null);
  }

  // False-colour illuminance painted onto the floor and walls, like a lighting
  // designer's isolux render. `sample(point, normal)` returns lux.
  setSurfaceMap(sample) {
    if (this.surfaceMap) {
      this.sceneRoot.remove(this.surfaceMap);
      disposeTree(this.surfaceMap);
      this.surfaceMap = null;
    }
    if (!sample || !this.roomScene) return;
    const { width, depth, height } = this.roomScene.room;
    const group = new THREE.Group();
    group.name = 'lux-map';
    // Front faces only, facing into the room: walls between you and the room
    // stay see-through, like the walls themselves.
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, side: THREE.FrontSide, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const surface = (origin, u, v, normal, step, inset) => {
      const nu = Math.max(2, Math.round(Math.hypot(u.x, u.y, u.z) / step));
      const nv = Math.max(2, Math.round(Math.hypot(v.x, v.y, v.z) / step));
      const positions = [];
      const colors = [];
      const alphaMask = [];
      for (let j = 0; j <= nv; j += 1) {
        for (let i = 0; i <= nu; i += 1) {
          const point = {
            x: origin.x + u.x * i / nu + v.x * j / nv + normal.x * inset,
            y: origin.y + u.y * i / nu + v.y * j / nv + normal.y * inset,
            z: origin.z + u.z * i / nu + v.z * j / nv + normal.z * inset,
          };
          const inside = floorContains(this.roomScene.room, Math.min(width - 1e-3, Math.max(1e-3, point.x)), Math.min(depth - 1e-3, Math.max(1e-3, point.z)), -0.02);
          const lux = inside ? sample(point, normal) : 0;
          const [r, g, b] = luxColor(lux);
          positions.push(point.x - width / 2, point.y, point.z - depth / 2);
          colors.push(r, g, b);
          alphaMask.push(inside);
        }
      }
      const indices = [];
      for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
          const a0 = j * (nu + 1) + i;
          const a1 = a0 + 1;
          const b0 = a0 + nu + 1;
          const b1 = b0 + 1;
          if (!(alphaMask[a0] && alphaMask[a1] && alphaMask[b0] && alphaMask[b1])) continue;
          indices.push(a0, b0, a1, a1, b0, b1);
        }
      }
      // Wind the triangles so their face normal is the inward normal.
      if (indices.length) {
        const p = (index) => new THREE.Vector3(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
        const face = new THREE.Vector3().crossVectors(p(indices[1]).sub(p(indices[0])), p(indices[2]).sub(p(indices[0])));
        if (face.dot(new THREE.Vector3(normal.x, normal.y, normal.z)) < 0) {
          for (let index = 0; index < indices.length; index += 3) [indices[index + 1], indices[index + 2]] = [indices[index + 2], indices[index + 1]];
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.raycast = () => {};
      mesh.renderOrder = 1;
      group.add(mesh);
    };
    surface({ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: 1, z: 0 }, 0.1, 0.004);
    surface({ x: 0, y: 0, z: 0 }, { x: width, y: 0, z: 0 }, { x: 0, y: height, z: 0 }, { x: 0, y: 0, z: 1 }, 0.15, 0.01);
    surface({ x: 0, y: 0, z: depth }, { x: width, y: 0, z: 0 }, { x: 0, y: height, z: 0 }, { x: 0, y: 0, z: -1 }, 0.15, 0.01);
    surface({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: height, z: 0 }, { x: 1, y: 0, z: 0 }, 0.15, 0.01);
    surface({ x: width, y: 0, z: 0 }, { x: 0, y: 0, z: depth }, { x: 0, y: height, z: 0 }, { x: -1, y: 0, z: 0 }, 0.15, 0.01);
    this.surfaceMap = group;
    this.sceneRoot.add(group);
  }

  // Sun, lamps and daylight shafts are part of every view; Light mode dims the
  // ambient fill so their effect stands out and turns on lamp shadows.
  rebuildLights() {
    for (const light of this.dynamicLights) {
      light.parent?.remove(light);
      if (light.isMesh) disposeTree(light);
      light.dispose?.();
    }
    this.dynamicLights = [];
    this.lightingLights = this.dynamicLights;
    if (!this.roomScene) return;
    const preview = this.lightingPreview;
    const sun = this.sunState();
    const sunUp = sun && sun.altitude > 0.5;
    // In the Light lens the fill is the sky: bright by day, near-dark at night.
    const daylight = sun ? Math.max(0, Math.min(1, (sun.altitude + 4) / 30)) : 0;
    this.hemisphereLight.intensity = preview ? 0.12 + daylight * 1.1 : sunUp ? 1.45 : 1.15;
    this.keyLight.intensity = preview ? 0 : sunUp ? 0.7 : 0.9;
    if (sunUp) this.addSunLight(sun);
    for (const object of this.roomScene.objects.filter((item) => LIGHT_SOURCES[item.model])) {
      const group = this.groups.get(object.id);
      if (!group || object.props?.on === 0) continue;
      const spec = LIGHT_SOURCES[object.model];
      const source = new THREE.PointLight(0xffe2b8, 1, preview ? 9 : 6, 2);
      source.power = (preview ? spec.power : spec.power * 0.35) * (object.props?.lumens ?? spec.lumens) / spec.lumens;
      source.castShadow = preview;
      source.position.set(0, object.dimensions.height * spec.y, 0);
      group.localToWorld(source.position);
      if (preview) {
        source.shadow.mapSize.set(1024, 1024);
        source.shadow.camera.near = 0.05;
        source.shadow.camera.far = 9;
        source.shadow.bias = -0.00025;
        source.shadow.normalBias = 0.025;
        source.shadow.radius = 3;
      }
      source.userData.objectId = object.id;
      this.scene.add(source);
      this.dynamicLights.push(source);
    }
  }

  updateLightingLightPositions() {
    for (const light of this.dynamicLights) {
      if (!light.isPointLight || !light.userData.objectId) continue;
      const object = this.roomScene.objects.find((item) => item.id === light.userData.objectId);
      const group = this.groups.get(light.userData.objectId);
      if (!object || !group) continue;
      light.position.set(0, object.dimensions.height * LIGHT_SOURCES[object.model].y, 0);
      group.localToWorld(light.position);
    }
  }

  setEnvironment(environment) {
    this.environment = environment;
    this.rebuildLights();
  }

  sunState() {
    return this.environment ? sunPosition(this.environment) : null;
  }

  addSunLight(sun) {
    const { width, depth, height } = this.roomScene.room;
    const toSun = bearingToRoomVector(sun.azimuth, this.environment.backWallBearing, sun.altitude);
    const strength = Math.sin(THREE.MathUtils.degToRad(sun.altitude));
    const light = new THREE.DirectionalLight(sun.altitude < 12 ? 0xffc98a : 0xfff1d6, (this.lightingPreview ? 2.2 : 1.6) + 2.4 * strength);
    const reach = Math.max(width, depth, height) * 2.5;
    light.position.set(toSun.x * reach, toSun.y * reach, toSun.z * reach);
    light.target.position.set(0, height / 3, 0);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    const extent = Math.max(width, depth, height) * 1.2;
    Object.assign(light.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 0.1, far: reach * 2 });
    light.shadow.bias = -0.0004;
    light.shadow.normalBias = 0.03;
    this.scene.add(light, light.target);
    this.dynamicLights.push(light, light.target);

    // Visible shafts of daylight through each window facing the sun.
    const travel = new THREE.Vector3(-toSun.x, -toSun.y, -toSun.z);
    const clipping = ROOM_PLANES(this.roomScene.room);
    for (const window of this.roomScene.objects.filter((object) => object.model === 'window' || (object.model === 'door' && object.open))) {
      const inward = { front: [0, 1], back: [0, -1], left: [1, 0], right: [-1, 0] }[window.wall];
      if (travel.x * inward[0] + travel.z * inward[1] <= 0.02) continue;
      const alongX = window.wall === 'back' || window.wall === 'front';
      const plane = window.wall === 'front' ? -depth / 2 : window.wall === 'back' ? depth / 2 : window.wall === 'left' ? -width / 2 : width / 2;
      const center = alongX ? window.position.x - width / 2 : window.position.z - depth / 2;
      const half = window.dimensions.width / 2;
      const y0 = window.position.y;
      const y1 = y0 + window.dimensions.height;
      const corners = [[center - half, y0], [center + half, y0], [center + half, y1], [center - half, y1]].map(([s, y]) => (
        alongX ? new THREE.Vector3(s, y, plane) : new THREE.Vector3(plane, y, s)));
      const length = Math.max(width, depth, height) * 3;
      const far = corners.map((corner) => corner.clone().addScaledVector(travel, length));
      const positions = [];
      const colors = [];
      const near = [1, 0.86, 0.58].map((value) => value * (this.lightingPreview ? 0.22 : 0.13) * (0.4 + strength));
      const quad = (a, b, c, d) => {
        for (const [point, bright] of [[a, 1], [b, 1], [c, 0], [b, 1], [d, 0], [c, 0]]) {
          positions.push(point.x, point.y, point.z);
          colors.push(...near.map((value) => value * (bright ? 1 : 0.15)));
        }
      };
      for (let index = 0; index < 4; index += 1) quad(corners[index], corners[(index + 1) % 4], far[index], far[(index + 1) % 4]);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const shaft = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, clippingPlanes: clipping, toneMapped: false,
      }));
      shaft.renderOrder = 1;
      this.sceneRoot.add(shaft);
      this.dynamicLights.push(shaft);
    }
  }

  setPlaneField(field) {
    if (!field?.values) {
      this.clearPlaneField();
      this.planeField = field;
      return;
    }
    const { nx, nz, values } = field;
    const transform = field.logScale ? (value) => Math.log10(Math.max(1, value)) : (value) => value;
    const min = transform(field.min);
    const span = Math.max(1e-6, transform(field.max) - min);
    const ramp = PLANE_RAMPS[field.mode] ?? PLANE_RAMPS.wifi;
    let mesh = this.planeMesh;
    if (!mesh || mesh.userData.nx !== nx || mesh.userData.nz !== nz || mesh.userData.mode !== field.mode) {
      this.clearPlaneField();
      const texture = new THREE.DataTexture(new Uint8Array(nx * nz * 4), nx, nz, THREE.RGBAFormat);
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      const { width, depth } = this.roomScene.room;
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        uniforms: {
          uMap: { value: texture },
          uTime: { value: 0 },
          uSources: { value: Array.from({ length: 4 }, () => new THREE.Vector2()) },
          uCount: { value: 0 },
          uWave: { value: field.mode === 'wifi' ? 14 : 9 },
          uSpeed: { value: field.mode === 'wifi' ? 5 : 3 },
          uOpacity: { value: 0 },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vUv = uv;
            vec4 world = modelMatrix * vec4(position, 1.0);
            vWorld = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform vec2 uSources[4];
          uniform int uCount;
          uniform float uWave;
          uniform float uSpeed;
          uniform float uOpacity;
          varying vec2 vUv;
          varying vec3 vWorld;
          void main() {
            vec4 texel = texture2D(uMap, vUv);
            if (texel.a < 0.01) discard;
            float strength = texel.a;
            vec3 color = texel.rgb;
            float rings = 0.0;
            for (int i = 0; i < 4; i++) {
              if (i >= uCount) break;
              float d = distance(vWorld.xz, uSources[i]);
              float wave = pow(0.5 + 0.5 * sin(d * uWave - uTime * uSpeed), 12.0);
              rings += wave * smoothstep(0.0, 0.25, d);
            }
            // Wavefronts fade with the local field strength, so they visibly
            // weaken with distance and in the shadow of furniture.
            color += rings * strength * strength * 0.6;
            gl_FragColor = vec4(color, uOpacity * (0.62 + 0.3 * strength + rings * 0.12 * strength));
          }
        `,
      }));
      mesh.rotation.x = Math.PI / 2;
      mesh.renderOrder = 2;
      mesh.userData = { nx, nz, mode: field.mode };
      gsap.to(mesh.material.uniforms.uOpacity, { value: 0.92, duration: this.prefersReducedMotion ? 0 : 0.4, ease: 'power2.out' });
      this.planeMesh = mesh;
      this.sceneRoot.add(mesh);
    }
    const data = mesh.material.uniforms.uMap.value.image.data;
    for (let index = 0; index < nx * nz; index += 1) {
      const value = values[index];
      const offset = index * 4;
      if (!Number.isFinite(value)) {
        data[offset + 3] = 0;
        continue;
      }
      const t = (transform(value) - min) / span;
      const [r, g, b] = rampColor(ramp, t);
      data[offset] = r * 255;
      data[offset + 1] = g * 255;
      data[offset + 2] = b * 255;
      data[offset + 3] = Math.max(4, Math.round((0.05 + 0.95 * t) * 255));
    }
    mesh.material.uniforms.uMap.value.needsUpdate = true;
    const { width, depth } = this.roomScene.room;
    const sources = (field.sources ?? []).slice(0, 4);
    mesh.material.uniforms.uCount.value = field.mode === 'light' ? 0 : sources.length;
    sources.forEach((source, index) => mesh.material.uniforms.uSources.value[index].set(source.x - width / 2, source.z - depth / 2));
    mesh.position.y = field.height;
    this.planeField = field;
  }

  clearPlaneField() {
    if (!this.planeMesh) return;
    gsap.killTweensOf(this.planeMesh.material.uniforms.uOpacity);
    this.sceneRoot.remove(this.planeMesh);
    this.planeMesh.material.uniforms.uMap.value.dispose();
    disposeTree(this.planeMesh);
    this.planeMesh = null;
    this.planeField = null;
  }

  // Room-space point under the cursor on the active plane (or the floor).
  probeAtPointer(clientX, clientY) {
    if (!this.roomScene) return null;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const height = this.probeHeight ?? this.planeField?.height ?? 0;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
    const hit = this.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return null;
    const x = hit.x + this.roomScene.room.width / 2;
    const z = hit.z + this.roomScene.room.depth / 2;
    if (x < 0 || z < 0 || x > this.roomScene.room.width || z > this.roomScene.room.depth) return null;
    return { x, y: height, z, clientX, clientY };
  }

  captureThumbnail(size = 360) {
    this.renderer.render(this.scene, this.camera);
    const source = this.renderer.domElement;
    const canvas = document.createElement('canvas');
    const aspect = source.width / source.height;
    canvas.width = size;
    canvas.height = Math.round(size / Math.max(0.5, aspect));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  }

  select(objectId) {
    this.selectedId = objectId && this.groups.has(objectId) ? objectId : null;
    if (this.selectedId === this.hoveredId) this.clearHover();
    this.transform.detach();
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      disposeTree(this.selectionBox);
      this.selectionBox = null;
    }
    if (this.selectedId) {
      const group = this.groups.get(this.selectedId);
      this.updateGizmoAxes();
      this.transform.attach(group);
      this.selectionBox = new THREE.BoxHelper(group, 0x23836c);
      this.selectionBox.material.depthTest = false;
      this.selectionBox.material.transparent = true;
      this.selectionBox.material.opacity = 0.88;
      this.selectionBox.renderOrder = 3;
      this.scene.add(this.selectionBox);
    }
  }

  setMode(mode) {
    if (mode === 'translate' || mode === 'rotate') {
      this.transformMode = mode;
      this.transform.setMode(mode);
      this.updateGizmoAxes();
    }
  }

  setView(view) {
    this.isTopView = view === 'top';
    this.orbit.enableRotate = !this.isTopView;
    this.orbit.enablePan = !this.isTopView;
    this.renderer.domElement.dataset.cameraView = this.isTopView ? 'top' : '3d';
    this.orbit.target.set(0, this.roomScene.room.height / 2, 0);
    if (this.camera.isOrthographicCamera) {
      this.orthoFrustumHeight = Math.max(this.roomScene.room.width, this.roomScene.room.depth) * 1.45;
      this.resize();
    }
    const distance = Math.max(this.roomScene.room.width, this.roomScene.room.depth) * 1.35;
    const destination = this.isTopView
      ? new THREE.Vector3(0, this.roomScene.room.height + distance, 0.001)
      : new THREE.Vector3(distance * 0.88, distance * 0.7, distance * 0.96);
    this.camera.up.set(0, this.isTopView ? 0 : 1, this.isTopView ? -1 : 0);
    gsap.killTweensOf(this.camera.position);
    if (this.animateNextView && !this.prefersReducedMotion) {
      gsap.to(this.camera.position, {
        x: destination.x, y: destination.y, z: destination.z, duration: 0.6, ease: 'power3.inOut',
        onUpdate: () => this.camera.lookAt(this.orbit.target),
      });
    } else {
      this.camera.position.copy(destination);
    }
    this.animateNextView = false;
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  // Animated variant for user-driven camera changes; programmatic refits stay instant.
  setViewAnimated(view) {
    this.animateNextView = true;
    this.setView(view);
  }

  fitRoom(resetView = true) {
    if (resetView) this.isTopView = false;
    this.setView(this.isTopView ? 'top' : '3d');
  }

  handlePointerUp(event) {
    const cube = this.pointerStart && this.cubeHit(event);
    if (cube && Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y) < 5) {
      this.pointerStart = null;
      if (cube.faceIndex >= 0) this.onViewChange?.(this.viewFrom(cube.normal));
      return;
    }
    if (!this.pointerStart || this.transform.dragging) {
      this.pointerStart = null;
      return;
    }
    const distance = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
    this.pointerStart = null;
    if (distance > 5) return;
    const selected = this.objectAtPointer(event.clientX, event.clientY);
    if (!selected && this.onEmptyClick?.(this.probeAtPointer(event.clientX, event.clientY))) return;
    this.select(selected);
    this.onSelect(selected);
  }

  objectAtPointer(clientX, clientY) {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.groups.values()], true);
    for (const hit of hits) {
      let target = hit.object;
      while (target && !target.userData.objectId) target = target.parent;
      if (target?.userData.objectId) return target.userData.objectId;
    }
    return null;
  }

  handlePointerMove(event) {
    if (this.transform.dragging || this.resizing) return;
    const cube = this.cubeHit(event);
    if (cube) {
      if (cube.faceIndex !== this.cubeHover) {
        this.cubeHover = cube.faceIndex;
        this.paintViewCube(cube.faceIndex);
      }
      this.renderer.domElement.style.cursor = cube.faceIndex >= 0 ? 'pointer' : '';
      return;
    }
    if (this.cubeHover !== -1 && this.cubeHover !== undefined) {
      this.cubeHover = -1;
      this.paintViewCube();
    }
    this.updateHover(this.objectAtPointer(event.clientX, event.clientY));
    this.onProbe(this.probeAtPointer(event.clientX, event.clientY));
  }

  updateHover(objectId) {
    const nextId = objectId === this.selectedId ? null : objectId;
    if (nextId === this.hoveredId) return;
    this.clearHover();
    if (!nextId) return;
    const group = this.groups.get(nextId);
    if (!group) return;
    this.hoveredId = nextId;
    this.hoverBox = new THREE.BoxHelper(group, 0xc47b43);
    this.hoverBox.material.depthTest = false;
    this.hoverBox.material.transparent = true;
    this.hoverBox.material.opacity = 0.95;
    this.hoverBox.renderOrder = 4;
    this.scene.add(this.hoverBox);
    this.renderer.domElement.dataset.hoveredObject = nextId;
    this.renderer.domElement.style.cursor = 'pointer';
  }

  clearHover() {
    if (this.hoverBox) {
      this.scene.remove(this.hoverBox);
      disposeTree(this.hoverBox);
    }
    this.hoverBox = null;
    this.hoveredId = null;
    delete this.renderer.domElement.dataset.hoveredObject;
    this.renderer.domElement.style.cursor = '';
  }

  handleObjectChange() {
    const group = this.transform.object;
    const objectId = group?.userData.objectId;
    const source = this.roomScene.objects.find((object) => object.id === objectId);
    if (!source) return;
    const rotation = {
      x: THREE.MathUtils.radToDeg(group.rotation.x),
      y: THREE.MathUtils.radToDeg(group.rotation.y),
      z: THREE.MathUtils.radToDeg(group.rotation.z),
    };
    const position = {
      x: group.position.x + this.roomScene.room.width / 2,
      y: group.position.y - source.dimensions.height / 2,
      z: group.position.z + this.roomScene.room.depth / 2,
    };
    let updated;
    try {
      updated = this.onTransform(objectId, position, rotation);
    } catch {
      this.applyObjectTransform(group, source);
      this.selectionBox?.update();
      return;
    }
    if (!updated) {
      this.applyObjectTransform(group, source);
      this.selectionBox?.update();
      return;
    }
    this.roomScene = updated.scene;
    this.applyObjectTransform(group, updated.object);
    this.updateLightingLightPositions();
    this.selectionBox?.update();
  }

  updateFieldVolumeDepthTest() {
    for (const layer of this.layers?.values() ?? []) this.updateLayerDepthTest(layer);
    this.updateLayerDepthTest(this.fieldLayer);
  }

  updateLayerDepthTest(layer) {
    const volume = layer?.children?.find((child) => child.userData?.boundsHalfSize);
    if (!volume) return;
    const { boundsCenter, boundsHalfSize } = volume.userData;
    const position = this.camera.position;
    const cameraInside = Math.abs(position.x - boundsCenter.x) < boundsHalfSize.x
      && Math.abs(position.y - boundsCenter.y) < boundsHalfSize.y
      && Math.abs(position.z - boundsCenter.z) < boundsHalfSize.z;
    const material = volume.material;
    if (material.depthTest === !cameraInside) return;
    material.depthTest = !cameraInside;
    material.needsUpdate = true;
  }

  animate(time = 0) {
    this.frameRequest = requestAnimationFrame(this.animate);
    this.orbit.update();
    this.fieldLayer?.userData.animate?.(this.prefersReducedMotion ? 0 : time / 1000);
    for (const layer of this.layers?.values() ?? []) layer.userData.animate?.(this.prefersReducedMotion ? 0 : time / 1000);
    this.selectionBox?.update();
    this.hoverBox?.update();
    this.updateFieldVolumeDepthTest();
    if (this.planeMesh) this.planeMesh.material.uniforms.uTime.value = this.prefersReducedMotion ? 0 : time / 1000;
    this.animateFans?.(time / 1000);
    this.renderer.render(this.scene, this.camera);
    this.renderViewCube?.();
    this.updateDimLabels?.();
    this.onFrame?.();
  }

  dispose() {
    cancelAnimationFrame(this.frameRequest);
    this.clearFields();
    this.clearHover();
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.transform.dispose();
    disposeTree(this.sceneRoot);
    this.renderer.dispose();
  }
}
