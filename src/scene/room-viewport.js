import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mountViewportCanvas } from './mount-canvas.js';
import { createRoomFieldLayer } from './room-field-layer-3d.js';
import { DEFAULT_LAMP_POWER, DEFAULT_TIME_MINUTES, describeDaylight } from '../simulation/daylight.js';
import { isOpeningObject } from '../model/openings.js';

// Nominal power for the point lights at lamp bulbs, in lumens. Matches what the
// light preview used before there was a time of day, so an unchanged scene looks
// the same at the times when the lamps are on.
const LAMP_LIGHT_DISTANCE = 9;

const COLORS = Object.freeze({
  fan: 0x6d9c85,
  sofa: 0x819f84,
  desk: 0xc2a97a,
  table: 0xb69b73,
  lamp: 0x86a88f,
  heater: 0xaab2aa,
  router: 0x536d83,
  chair: 0x65756d,
  airConditioner: 0xe7ebe7,
  metal: 0x75877d,
  shade: 0xe3dfd0,
  windowFrame: 0x68847b,
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
  const rotor = new THREE.Group();
  rotor.name = 'fan-rotor';
  rotor.position.set(0, headY, headZ + 0.105);
  const bladeRadius = headRadius * 0.57;
  for (let index = 0; index < 3; index += 1) {
    const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), material(COLORS.fan));
    blade.scale.set(headRadius * 0.17, bladeRadius * 0.52, 0.017);
    blade.rotation.z = index * (Math.PI * 2 / 3);
    rotor.add(blade);
  }
  const hub = new THREE.Mesh(new THREE.SphereGeometry(headRadius * 0.14, 16, 12), material(0xf4f7f3));
  hub.position.z = 0.025;
  rotor.add(hub);
  group.add(rotor);
}

function createSofa(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  box(group, { width: w * 0.92, height: h * 0.53, depth: d * 0.87 }, { x: 0, y: -h * 0.13, z: 0 }, 0x718f79);
  box(group, { width: w * 0.82, height: h * 0.18, depth: d * 0.77 }, { x: 0, y: -h * 0.04, z: d * 0.02 }, 0x9aaf91);
  box(group, { width: w * 0.88, height: h * 0.34, depth: d * 0.2 }, { x: 0, y: h * 0.16, z: -d * 0.34 }, 0x799681);
  for (const side of [-1, 1]) {
    const pillow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material(side < 0 ? 0xe9e1d1 : 0xd9c8ad));
    pillow.scale.set(w * 0.15, h * 0.16, d * 0.12);
    pillow.position.set(side * w * 0.22, h * 0.2, -d * 0.25);
    pillow.rotation.z = side * -0.12;
    group.add(pillow);
  }
  for (const side of [-1, 1]) {
    box(group, { width: w * 0.09, height: h * 0.52, depth: d * 0.85 }, { x: side * w * 0.43, y: -h * 0.1, z: 0 }, 0x688570);
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
  box(group, { width: w * 0.43, height: h * 0.38, depth: 0.045 }, { x: 0, y: h * 0.7, z: -d * 0.25 }, 0x37434a);
  box(group, { width: w * 0.39, height: h * 0.33, depth: 0.008 }, { x: 0, y: h * 0.7, z: -d * 0.25 + 0.028 }, 0x90b5ba);
  box(group, { width: w * 0.055, height: h * 0.25, depth: 0.045 }, { x: 0, y: h * 0.35, z: -d * 0.25 }, 0x6d7773);
  box(group, { width: w * 0.36, height: 0.018, depth: d * 0.22 }, { x: 0, y: h / 2 + 0.012, z: d * 0.22 }, 0x4d5652);
}

function createOfficeChair(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  box(group, { width: w * 0.84, height: h * 0.095, depth: d * 0.78 }, { x: 0, y: -h * 0.02, z: 0 }, COLORS.chair);
  box(group, { width: w * 0.78, height: h * 0.49, depth: d * 0.1 }, { x: 0, y: h * 0.23, z: -d * 0.38 }, 0x71847a);
  cylinder(group, 0.035, 0.045, h * 0.38, { x: 0, y: -h * 0.25, z: 0 }, 0x89968e, 12);
  cylinder(group, 0.12, 0.14, 0.035, { x: 0, y: -h * 0.43, z: 0 }, 0x89968e, 20);
  for (let index = 0; index < 5; index += 1) {
    const angle = index * Math.PI * 2 / 5;
    const leg = box(group, { width: w * 0.32, height: 0.028, depth: 0.035 }, {
      x: Math.cos(angle) * w * 0.2,
      y: -h * 0.43,
      z: Math.sin(angle) * d * 0.2,
    }, 0x89968e);
    leg.rotation.y = -angle;
  }
}

function createTable(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  const topH = Math.min(0.075, h * 0.22);
  box(group, { width: w, height: topH, depth: d }, { x: 0, y: h / 2 - topH / 2, z: 0 }, COLORS.table);
  const legH = Math.max(0.08, h - topH);
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      cylinder(group, 0.023, 0.03, legH, { x: x * w * 0.4, y: -topH / 2, z: z * d * 0.37 }, 0x8d7a61, 8);
    }
  }
  box(group, { width: w * 0.3, height: 0.035, depth: d * 0.24 }, { x: -w * 0.15, y: h / 2 + 0.02, z: -d * 0.12 }, 0x81705d);
  box(group, { width: w * 0.28, height: 0.025, depth: d * 0.22 }, { x: -w * 0.15, y: h / 2 + 0.05, z: -d * 0.12 }, 0xc4ab83);
  cylinder(group, 0.035, 0.035, 0.085, { x: w * 0.31, y: h / 2 + 0.045, z: d * 0.18 }, 0xd8d1c3, 16);
}

function createLamp(group, dimensions) {
  const { width, height, depth } = dimensions;
  const radius = Math.min(width, depth) * 0.45;
  cylinder(group, radius * 0.78, radius, 0.06, { x: 0, y: -height / 2 + 0.03, z: 0 }, COLORS.metal);
  cylinder(group, 0.018, 0.023, height * 0.79, { x: 0, y: -height * 0.12, z: 0 }, COLORS.metal, 10);
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(width * 0.12, width * 0.24, height * 0.17, 20, 1, true), material(COLORS.shade, { side: THREE.DoubleSide }));
  shade.position.set(0, height * 0.31, 0);
  group.add(shade);
  cylinder(group, width * 0.1, width * 0.1, 0.035, { x: 0, y: height * 0.22, z: 0 }, 0xe8d89d, 16);
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

function createRouter(group, dimensions) {
  const { width, height, depth } = dimensions;
  box(group, { width, height: height * 0.68, depth }, { x: 0, y: -height * 0.12, z: 0 }, COLORS.router);
  for (const x of [-1, 1]) {
    cylinder(group, 0.009, 0.012, height * 1.55, {
      x: x * width * 0.32,
      y: height * 0.96,
      z: -depth * 0.3,
    }, 0x3d5266, 10);
  }
  for (let index = 0; index < 3; index += 1) {
    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0x86d9a5, emissive: 0x225e38, roughness: 0.5 }),
    );
    led.position.set((index - 1) * width * 0.18, -height * 0.12, depth / 2 + 0.003);
    group.add(led);
  }
}

function createAirConditioner(group, dimensions) {
  const { width: w, height: h, depth: d } = dimensions;
  box(group, { width: w, height: h, depth: d }, { x: 0, y: 0, z: 0 }, COLORS.airConditioner);
  box(group, { width: w * 0.78, height: h * 0.34, depth: 0.012 }, { x: 0, y: -h * 0.2, z: d / 2 + 0.008 }, 0xb8c3bd);
  for (let index = 0; index < 5; index += 1) {
    box(group, { width: w * 0.72, height: 0.012, depth: 0.018 }, {
      x: 0,
      y: -h * 0.31 + index * h * 0.055,
      z: d / 2 + 0.02,
    }, 0x71847a);
  }
  const status = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xa7ddbe, emissive: 0x275c3a, roughness: 0.48 }),
  );
  status.position.set(w * 0.39, h * 0.3, d / 2 + 0.01);
  group.add(status);
}

function createCeilingFan(group, dimensions) {
  const { width, height } = dimensions;
  box(group, { width: width * 0.22, height: 0.035, depth: width * 0.22 }, { x: 0, y: height * 0.43, z: 0 }, 0x77847e);
  cylinder(group, 0.026, 0.026, height * 0.48, { x: 0, y: height * 0.18, z: 0 }, 0x89968e, 10);

  const rotor = new THREE.Group();
  rotor.name = 'fan-rotor';
  rotor.userData.rotationAxis = 'y';
  rotor.position.y = -height * 0.04;
  cylinder(rotor, width * 0.11, width * 0.15, height * 0.25, { x: 0, y: 0, z: 0 }, 0x738178);
  for (let index = 0; index < 4; index += 1) {
    const angle = index * Math.PI / 2;
    const blade = box(rotor, { width: width * 0.42, height: 0.025, depth: width * 0.12 }, {
      x: Math.cos(angle) * width * 0.28,
      y: 0.015,
      z: -Math.sin(angle) * width * 0.28,
    }, COLORS.fan);
    blade.rotation.y = angle;
  }
  const diffuser = new THREE.Mesh(
    new THREE.SphereGeometry(width * 0.13, 16, 10),
    material(0xffe4a5, { emissive: 0x75531c, emissiveIntensity: 0.32, roughness: 0.4 }),
  );
  diffuser.scale.y = 0.48;
  diffuser.position.y = -height * 0.24;
  rotor.add(diffuser);
  group.add(rotor);
}

function createOpening(group, dimensions, open, model) {
  const { width, height, depth } = dimensions;
  const frame = 0.045;
  const rail = (size, position) => box(group, size, position, COLORS.windowFrame);
  rail({ width: frame, height, depth }, { x: -width / 2 + frame / 2, y: 0, z: 0 });
  rail({ width: frame, height, depth }, { x: width / 2 - frame / 2, y: 0, z: 0 });
  rail({ width, height: frame, depth }, { x: 0, y: height / 2 - frame / 2, z: 0 });
  if (model === 'window') {
    rail({ width, height: frame, depth }, { x: 0, y: -height / 2 + frame / 2, z: 0 });
    rail({ width: frame * 0.55, height: height - frame * 2, depth }, { x: 0, y: 0, z: 0 });
  }
  if (!open) {
    if (model === 'door') {
      box(group, { width: width - frame * 2, height: height - frame, depth: depth * 0.65 }, { x: 0, y: -frame / 2, z: 0 }, 0x9a795c);
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), material(0xc5a86e, { metalness: 0.55, roughness: 0.34 }));
      handle.position.set(width * 0.34, -0.02, depth * 0.4);
      group.add(handle);
    } else {
      box(group, { width: width - frame * 2, height: height - frame * 2, depth: 0.012 }, { x: 0, y: 0, z: 0 }, COLORS.windowGlass, {
        transparent: true,
        opacity: 0.34,
        roughness: 0.18,
        depthWrite: false,
      }).castShadow = false;
    }
  }
}

const BUILDERS = Object.freeze({
  fan: createFan,
  'ceiling-fan': createCeilingFan,
  sofa: createSofa,
  bed: createBed,
  desk: createDesk,
  chair: createOfficeChair,
  table: createTable,
  lamp: createLamp,
  heater: createHeater,
  'air-conditioner': createAirConditioner,
  router: createRouter,
});

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

function createWallGeometry(width, height, windows, wall, room) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  for (const window of windows.filter((item) => item.wall === wall && item.open)) {
    const center = wall === 'front'
      ? window.position.x - room.width / 2
      : wall === 'back'
        ? room.width / 2 - window.position.x
        : wall === 'left'
          ? room.depth / 2 - window.position.z
          : window.position.z - room.depth / 2;
    const halfWidth = window.dimensions.width / 2;
    const bottom = window.position.y;
    const top = bottom + window.dimensions.height;
    const hole = new THREE.Path();
    hole.moveTo(center - halfWidth, bottom);
    hole.lineTo(center - halfWidth, top);
    hole.lineTo(center + halfWidth, top);
    hole.lineTo(center + halfWidth, bottom);
    hole.closePath();
    shape.holes.push(hole);
  }
  return new THREE.ShapeGeometry(shape);
}

const wallLayouts = (room) => [
  { side: 'front', span: room.width, position: [0, 0, -room.depth / 2], rotation: [0, 0, 0] },
  { side: 'back', span: room.width, position: [0, 0, room.depth / 2], rotation: [0, Math.PI, 0] },
  { side: 'left', span: room.depth, position: [-room.width / 2, 0, 0], rotation: [0, Math.PI / 2, 0] },
  { side: 'right', span: room.depth, position: [room.width / 2, 0, 0], rotation: [0, -Math.PI / 2, 0] },
];

export class RoomViewport {
  constructor(container, {
    onSelect = () => {},
    onTransform = () => {},
    onDragChange = () => {},
    onPlacementError = () => {},
    onCameraViewChange = () => {},
  } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onTransform = onTransform;
    this.onDragChange = onDragChange;
    this.onCameraViewChange = onCameraViewChange;
    this.onPlacementError = onPlacementError;
    this.roomScene = null;
    this.selectedId = null;
    this.groups = new Map();
    this.fanRotors = new Map();
    this.fieldLayer = null;
    this.lightingPreview = false;
    this.lightingLights = [];
    this.timeMinutes = DEFAULT_TIME_MINUTES;
    this.daylightState = null;
    this.sunPatchMeshes = [];
    this.pointerStart = null;
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'room-canvas';
    this.renderer.domElement.setAttribute('aria-label', 'Three-dimensional room. Click an object to select it.');
    this.renderer.domElement.dataset.projection = this.projection;
    mountViewportCanvas(this.container, this.renderer.domElement);

    this.hemisphereLight = new THREE.HemisphereLight(0xeaf3ed, 0x97a38f, 2.1);
    this.keyLight = new THREE.DirectionalLight(0xfff7e9, 2.6);
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.1;
    this.keyLight.shadow.camera.far = 50;
    this.keyLight.shadow.bias = -0.0002;
    this.keyLight.position.set(-4, 8, 6);
    this.scene.add(this.hemisphereLight, this.keyLight);
    this.setupControls(this.camera, new THREE.Vector3(0, 1.1, 0));

    this.selectionBox = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.renderer.domElement.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pointerStart = { x: event.clientX, y: event.clientY };
    });
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
    this.orbit.enableRotate = true;
    this.orbit.enablePan = true;
    this.orbit.addEventListener('change', () => {
      const direction = this.camera.position.clone().sub(this.orbit.target).normalize();
      this.onCameraViewChange(direction.y > 0.98 ? 'top' : '3d');
    });
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
    if (selectedId && this.groups.has(selectedId)) this.transform.attach(this.groups.get(selectedId));
  }

  setProjection(projection) {
    if (!['perspective', 'orthographic'].includes(projection) || projection === this.projection) return;
    const target = this.orbit.target.clone();
    const position = this.camera.position.clone();
    const up = this.camera.up.clone();
    if (projection === 'orthographic') {
      const distance = position.distanceTo(target);
      const direction = position.clone().sub(target).normalize();
      const aspect = Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
      this.orthoFrustumHeight = direction.y > 0.98
        ? Math.max(this.roomScene.room.depth, this.roomScene.room.width / aspect) * 1.12
        : Math.max(2, 2 * distance * Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2)));
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
    const { width, depth, height } = this.roomScene.room;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      material(0xcab18f, { roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    this.sceneRoot.add(floor);

    const floorSeams = [];
    const plankDepth = 0.24;
    const plankLength = 1.15;
    const rows = Math.ceil(depth / plankDepth);
    for (let row = 1; row < rows; row += 1) {
      const z = -depth / 2 + row * plankDepth;
      floorSeams.push(new THREE.Vector3(-width / 2, 0.006, z), new THREE.Vector3(width / 2, 0.006, z));
      const offset = row % 2 ? plankLength / 2 : 0;
      for (let x = -width / 2 + offset; x < width / 2; x += plankLength) {
        if (x <= -width / 2 || x >= width / 2) continue;
        floorSeams.push(
          new THREE.Vector3(x, 0.006, z - plankDepth / 2),
          new THREE.Vector3(x, 0.006, z + plankDepth / 2),
        );
      }
    }
    const floorGeometry = new THREE.BufferGeometry().setFromPoints(floorSeams);
    const floorLines = new THREE.LineSegments(floorGeometry, new THREE.LineBasicMaterial({ color: 0x8c6b49, transparent: true, opacity: 0.2 }));
    floorLines.name = 'wood-floor-seams';
    this.sceneRoot.add(floorLines);

    const trimHeight = 0.065;
    const trimDepth = 0.025;
    for (const side of [-1, 1]) {
      box(this.sceneRoot, { width, height: trimHeight, depth: trimDepth }, {
        x: 0, y: trimHeight / 2, z: side * (depth / 2 - trimDepth / 2),
      }, 0xe8dfcf);
      box(this.sceneRoot, { width: trimDepth, height: trimHeight, depth }, {
        x: side * (width / 2 - trimDepth / 2), y: trimHeight / 2, z: 0,
      }, 0xe8dfcf);
    }

    for (const wall of wallLayouts(this.roomScene.room)) this.createWall(wall);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false }),
    );
    ceiling.name = 'daylight-ceiling-occluder';
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = height;
    ceiling.castShadow = true;
    ceiling.raycast = () => {};
    this.sceneRoot.add(ceiling);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(width, height, depth)),
      new THREE.LineBasicMaterial({ color: 0x8fa198, transparent: true, opacity: 0.75 }),
    );
    outline.position.y = height / 2;
    this.sceneRoot.add(outline);
  }

  createWall(wall) {
    const { width, height, depth } = this.roomScene.room;
    const span = wall.side === 'left' || wall.side === 'right' ? depth : width;
    const openings = this.roomScene.objects.filter(isOpeningObject);
    const mesh = new THREE.Mesh(
      createWallGeometry(span, height, openings, wall.side, this.roomScene.room),
      material(0xf4efe5, { transparent: true, opacity: 0.27, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.name = `room-wall-${wall.side}`;
    mesh.position.set(...wall.position);
    mesh.rotation.set(...wall.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.sceneRoot.add(mesh);
    if (this.lightingPreview) {
      this.applyLightingToMaterial(mesh.material);
    }
  }

  rebuildWalls(sides) {
    for (const side of new Set(sides)) {
      const previous = this.sceneRoot.getObjectByName(`room-wall-${side}`);
      if (previous) {
        this.sceneRoot.remove(previous);
        disposeTree(previous);
      }
      const wall = wallLayouts(this.roomScene.room).find((item) => item.side === side);
      if (wall) this.createWall(wall);
    }
  }

  createObjectGroup(object) {
    const group = new THREE.Group();
    group.name = object.id;
    group.userData.objectId = object.id;
    group.userData.primitive = object.primitive;
    group.userData.model = object.model;
    const builder = BUILDERS[object.model];
    if (isOpeningObject(object)) createOpening(group, object.dimensions, object.open, object.model);
    else if (builder) builder(group, object.dimensions);
    else box(group, object.dimensions, { x: 0, y: 0, z: 0 }, COLORS.metal);
    group.userData.open = object.open;
    if (object.model === 'fan' || object.model === 'ceiling-fan') {
      const rotor = group.getObjectByName('fan-rotor');
      rotor.userData.enabled = object.enabled !== false && (object.intensity ?? 1) > 0;
      rotor.traverse((child) => {
        if (!child.material?.color) return;
        child.material.userData.enabledColor ??= child.material.color.clone();
        child.material.color.copy(child.material.userData.enabledColor).multiplyScalar(rotor.userData.enabled ? 1 : 0.34);
      });
      this.fanRotors.set(object.id, rotor);
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
    const initialScene = !this.roomScene;
    const showLighting = this.lightingPreview;
    this.clearFields();
    this.clearHover();
    this.transform.detach();
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      disposeTree(this.selectionBox);
      this.selectionBox = null;
    }
    for (const child of [...this.sceneRoot.children]) {
      this.sceneRoot.remove(child);
      disposeTree(child);
    }
    this.groups.clear();
    this.fanRotors.clear();
    this.roomScene = roomScene;
    this.buildRoom();
    for (const object of roomScene.objects) this.createObjectGroup(object);
    this.select(selectedId);
    if (initialScene) this.fitRoom();
    if (showLighting) this.setLightingPreview(true, true);
  }

  setFields(result, mode, options = {}) {
    this.clearFields();
    if (mode === 'light' && options.displayStyle !== 'map') {
      this.setLightingPreview(true);
      this.fieldLayer = null;
    } else {
      this.setLightingPreview(false);
      this.fieldLayer = createRoomFieldLayer(result, mode, this.roomScene, { ...options, objectGroups: this.groups });
      this.sceneRoot.add(this.fieldLayer);
    }
    this.renderer.domElement.dataset.fieldMode = mode;
    this.renderer.domElement.dataset.fieldCells = String(result.grid.nx * result.grid.ny * result.grid.nz);
    this.renderer.domElement.dataset.fieldBackend = result.backend ?? 'cpu-preview';
    this.renderer.domElement.dataset.fieldGpuFallbackReason = result.gpuFallbackReason ?? '';
    this.renderer.domElement.dataset.fieldCellSize = String(result.grid.cellSize ?? Math.max(result.grid.dx, result.grid.dy, result.grid.dz));
    this.renderer.domElement.dataset.fieldMaxSpeed = String(result.stats.maxSpeed ?? 0);
    this.renderer.domElement.dataset.fieldRmsDivergence = String(result.stats.rmsDivergence ?? 0);
    this.renderer.domElement.dataset.fieldBoundaryFlowImbalance = String(result.stats.boundaryFlowImbalancePercent ?? 0);
    this.renderer.domElement.dataset.fieldNetBoundaryFlow = String(result.stats.netBoundaryFlowM3s ?? 0);
    this.renderer.domElement.dataset.fieldMinTemperature = String(result.stats.minTemperature ?? result.ambientTemperature ?? 0);
    this.renderer.domElement.dataset.fieldMeanTemperature = String(result.stats.meanTemperature ?? result.ambientTemperature ?? 0);
    this.renderer.domElement.dataset.fieldMaxTemperature = String(result.stats.maxTemperature ?? result.stats.maxLevel ?? 0);
    this.renderer.domElement.dataset.fieldVolumeVoxels = String(this.fieldLayer?.userData.volumeVoxelCount ?? 0);
    if (mode === 'airflow' && this.fieldLayer) {
      this.renderer.domElement.dataset.gasVoxels = String(this.fieldLayer.userData.gasVoxelCount);
      this.renderer.domElement.dataset.gasSourceCounts = JSON.stringify(this.fieldLayer.userData.gasSourceCounts);
    }
    this.renderer.domElement.dataset.fieldRevision = String(Number(this.renderer.domElement.dataset.fieldRevision ?? 0) + 1);
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
    delete this.renderer.domElement.dataset.fieldGpuFallbackReason;
    delete this.renderer.domElement.dataset.fieldCellSize;
    delete this.renderer.domElement.dataset.fieldMaxSpeed;
    delete this.renderer.domElement.dataset.fieldRmsDivergence;
    delete this.renderer.domElement.dataset.fieldBoundaryFlowImbalance;
    delete this.renderer.domElement.dataset.fieldNetBoundaryFlow;
    delete this.renderer.domElement.dataset.fieldMinTemperature;
    delete this.renderer.domElement.dataset.fieldMeanTemperature;
    delete this.renderer.domElement.dataset.fieldMaxTemperature;
    delete this.renderer.domElement.dataset.fieldVolumeVoxels;
    delete this.renderer.domElement.dataset.gasVoxels;
    delete this.renderer.domElement.dataset.gasSourceCounts;
    delete this.renderer.domElement.dataset.gasDensityMax;
    delete this.renderer.domElement.dataset.gasOccupiedVoxels;
    delete this.renderer.domElement.dataset.tracerVolumeM3;
    delete this.renderer.domElement.dataset.exteriorTracerVolumeM3;
  }

  setLightingPreview(enabled, force = false) {
    if (enabled === this.lightingPreview && !force) return;
    this.lightingPreview = enabled;
    this.clearSunPatches();
    for (const light of this.lightingLights) {
      this.scene.remove(light);
      light.dispose?.();
    }
    this.lightingLights = [];

    if (!enabled) {
      // Restore the neutral studio lighting the editor shows outside the preview.
      this.hemisphereLight.intensity = 2.1;
      this.keyLight.intensity = 2.6;
      this.keyLight.color.setHex(0xfff7e9);
      this.keyLight.castShadow = false;
      this.keyLight.visible = true;
      this.keyLight.position.set(-4, 8, 6);
      this.hemisphereLight.color.setHex(0xeaf3ed);
      this.renderer.toneMappingExposure = 1.04;
      this.scene.background.set(0xf6f8f6);
    }

    this.sceneRoot.traverse((child) => {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const item of materials) this.applyLightingToMaterial(item, enabled);
    });

    if (enabled) {
      for (const object of this.roomScene.objects.filter((item) => ['lamp', 'ceiling-fan'].includes(item.model) && item.enabled !== false)) {
        const group = this.groups.get(object.id);
        if (!group) continue;
        const source = new THREE.PointLight(0xffffff, 1, LAMP_LIGHT_DISTANCE, 2);
        source.power = DEFAULT_LAMP_POWER * (object.model === 'lamp' ? object.intensity ?? 1 : 0.75);
        source.castShadow = true;
        source.position.set(0, object.model === 'lamp' ? object.dimensions.height * 0.22 : -object.dimensions.height * 0.24, 0);
        group.localToWorld(source.position);
        source.shadow.mapSize.set(1024, 1024);
        source.shadow.camera.near = 0.05;
        source.shadow.camera.far = 9;
        source.shadow.bias = -0.00025;
        source.shadow.normalBias = 0.025;
        source.shadow.radius = 3;
        source.userData.objectId = object.id;
        this.scene.add(source);
        this.lightingLights.push(source);
      }
    }
    if (enabled) {
      // Daylight replaces the fixed preview lighting, so derive it from the
      // current scene and clock rather than hard-coding a look.
      this.setTimeOfDay({});
      this.renderer.domElement.dataset.fieldMode = 'light';
      this.renderer.domElement.dataset.fieldVolumeVoxels = '0';
    } else {
      this.clearDaylightDataset();
    }
    this.renderer.domElement.dataset.lightingPreview = String(enabled);
  }

  /**
   * Recompute the daylight state and push it into the scene. Safe to call at any
   * time; it is a no-op for rendering while the light preview is off, but the
   * state is kept so the inspector can show it.
   */
  setTimeOfDay({ timeMinutes } = {}) {
    if (timeMinutes !== undefined) this.timeMinutes = timeMinutes;
    if (!this.roomScene) return null;
    this.daylightState = describeDaylight({
      scene: this.roomScene,
      timeMinutes: this.timeMinutes,
    });
    if (this.lightingPreview) this.applyDaylight();
    return this.daylightState;
  }

  applyDaylight() {
    const state = this.daylightState;
    if (!state) return;

    const { colour, intensity, direction } = state.sun;
    this.keyLight.color.setRGB(colour.r, colour.g, colour.b);
    this.keyLight.intensity = intensity;
    // Park the sun far enough out that its shadow camera covers the room.
    const reach = Math.max(this.roomScene?.room.width ?? 5, this.roomScene?.room.depth ?? 4) + 6;
    this.keyLight.position.set(direction.x * reach, Math.max(direction.y, 0.05) * reach, direction.z * reach);
    const shadowRadius = Math.max(this.roomScene.room.width, this.roomScene.room.depth) / 2 + this.roomScene.room.height;
    Object.assign(this.keyLight.shadow.camera, {
      left: -shadowRadius,
      right: shadowRadius,
      top: shadowRadius,
      bottom: -shadowRadius,
    });
    this.keyLight.shadow.camera.updateProjectionMatrix();
    this.keyLight.target.position.set(
      (this.roomScene?.room.width ?? 5) / 2,
      0,
      (this.roomScene?.room.depth ?? 4) / 2,
    );
    this.keyLight.target.updateMatrixWorld();
    this.keyLight.castShadow = state.sun.daylight > 0.02;
    this.keyLight.visible = state.sun.daylight > 0;

    // Keep only a small neutral fill for readability. Exterior light comes from
    // the shadow-casting sun, which the room shell blocks except at open apertures.
    this.hemisphereLight.color.setHex(0xeaf3ed);
    this.hemisphereLight.intensity = 0.06;

    this.scene.background.setRGB(state.background.r, state.background.g, state.background.b);
    this.renderer.toneMappingExposure = state.exposure;

    for (const light of this.lightingLights) {
      const fixture = this.roomScene.objects.find((object) => object.id === light.userData.objectId);
      const brightness = fixture?.model === 'lamp' ? fixture.intensity ?? 1 : 0.75;
      light.power = (fixture?.enabled !== false ? DEFAULT_LAMP_POWER * brightness : 0);
    }
    this.rebuildSunPatches();
    this.updateDaylightDataset();
  }

  /** Publish the current daylight so tests and the DOM can read it. */
  updateDaylightDataset() {
    const state = this.daylightState;
    if (!state || !this.lightingPreview) return;
    const data = this.renderer.domElement.dataset;
    data.sunAltitude = String(Number(state.sun.altitude.toFixed(1)));
    data.sunAzimuth = String(Number(state.sun.azimuth.toFixed(1)));
    data.clockTime = state.clock;
    data.lampsOn = String(this.roomScene.objects.some((object) => ['lamp', 'ceiling-fan'].includes(object.model) && object.enabled !== false));
    data.sunPatches = String(this.sunPatchMeshes.length);
  }

  clearDaylightDataset() {
    const data = this.renderer.domElement.dataset;
    delete data.sunAltitude;
    delete data.sunAzimuth;
    delete data.clockTime;
    delete data.lampsOn;
    delete data.sunPatches;
  }

  clearSunPatches() {
    for (const mesh of this.sunPatchMeshes) {
      this.sceneRoot.remove(mesh);
      disposeTree(mesh);
    }
    this.sunPatchMeshes = [];
  }

  /** Sunlit floor patches, drawn as translucent polygons just above the floor. */
  rebuildSunPatches() {
    this.clearSunPatches();
    const state = this.daylightState;
    if (!state || !state.patches.length) return;
    const floorY = 0.012;

    for (const patch of state.patches) {
      const points = patch.polygon;
      if (points.length < 3) continue;
      const positions = [];
      for (let index = 1; index < points.length - 1; index += 1) {
        for (const point of [points[0], points[index], points[index + 1]]) {
          positions.push(point.x, floorY, point.z);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      const colour = state.sun.colour;
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: new THREE.Color(colour.r, colour.g, colour.b),
        transparent: true,
        // The directional light already washes the whole floor, so the patch is
        // what makes direct sun legible. Grazing light spreads the same energy
        // over more floor and reads as a softer wash rather than a hard shape.
        opacity: Math.min(0.9, 0.34 + 0.62 * patch.intensity),
        depthWrite: false,
        toneMapped: false,
      }));
      mesh.renderOrder = 2;
      mesh.name = `sun-patch-${patch.windowId}`;
      mesh.userData.windowId = patch.windowId;
      mesh.userData.area = patch.area;
      mesh.userData.intensity = patch.intensity;
      this.sceneRoot.add(mesh);
      this.sunPatchMeshes.push(mesh);
    }
  }

  applyLightingToMaterial(item, enabled = this.lightingPreview) {
    if (!item?.color) return;
    item.userData.roomShiftColor ??= item.color.clone();
    item.userData.roomShiftOpacity ??= item.opacity;
    if (enabled) {
      const { r, g, b } = item.userData.roomShiftColor;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      item.color.setRGB(luminance, luminance, luminance);
      if (item.transparent && item.userData.roomShiftOpacity <= 0.25) item.opacity = 0.38;
    } else {
      item.color.copy(item.userData.roomShiftColor);
      item.opacity = item.userData.roomShiftOpacity;
    }
    item.needsUpdate = true;
  }

  updateLightingLightPositions() {
    for (const light of this.lightingLights) {
      const object = this.roomScene.objects.find((item) => item.id === light.userData.objectId);
      const group = this.groups.get(light.userData.objectId);
      if (!object || !group) continue;
      light.position.set(0, object.model === 'lamp' ? object.dimensions.height * 0.22 : -object.dimensions.height * 0.24, 0);
      group.localToWorld(light.position);
    }
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
    }
  }

  snapToTop() {
    const { width, depth, height } = this.roomScene.room;
    this.orbit.target.set(0, height / 2, 0);
    this.orbit.enabled = true;
    this.orbit.enableRotate = true;
    this.orbit.enablePan = true;
    const aspect = Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
    const viewHeight = Math.max(depth, width / aspect) * 1.2;
    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.perspectiveCamera.fov / 2));
    const perspectiveDistance = Math.max(
      Math.max(width, depth) * 1.6,
      viewHeight / (2 * tanHalfFov),
    );
    if (this.camera.isOrthographicCamera) {
      this.orthoFrustumHeight = 2 * perspectiveDistance * tanHalfFov;
      this.resize();
    }
    const distance = this.camera.isPerspectiveCamera ? perspectiveDistance : Math.max(width, depth) * 1.35;
    const tilt = 0.04;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(0, height / 2 + distance * Math.cos(tilt), distance * Math.sin(tilt));
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  fitRoom() {
    const { width, depth, height } = this.roomScene.room;
    this.orbit.target.set(0, height / 2, 0);
    this.orbit.enabled = true;
    this.orbit.enableRotate = true;
    this.orbit.enablePan = true;
    const distance = Math.max(width, depth) * 1.35;
    this.camera.up.set(0, 1, 0);
    this.camera.position.set(distance * 0.88, distance * 0.7, distance * 0.96);
    if (this.camera.isOrthographicCamera) {
      this.orthoFrustumHeight = Math.max(width, depth) * 1.45;
      this.resize();
    }
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  handlePointerUp(event) {
    if (!this.pointerStart || this.transform.dragging) {
      this.pointerStart = null;
      return;
    }
    const distance = Math.hypot(event.clientX - this.pointerStart.x, event.clientY - this.pointerStart.y);
    this.pointerStart = null;
    if (distance > 5) return;
    const selected = this.objectAtPointer(event.clientX, event.clientY);
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
    if (this.transform.dragging) return;
    this.updateHover(this.objectAtPointer(event.clientX, event.clientY));
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
    } catch (error) {
      this.onPlacementError(error.message);
      if (this.selectionBox) this.selectionBox.material.color.set(0xd04e42);
      this.applyObjectTransform(group, source);
      this.selectionBox?.update();
      return;
    }
    if (!updated) {
      this.onPlacementError('This placement is invalid.');
      if (this.selectionBox) this.selectionBox.material.color.set(0xd04e42);
      this.applyObjectTransform(group, source);
      this.selectionBox?.update();
      return;
    }
    this.roomScene = updated.scene;
    if (isOpeningObject(source)) this.rebuildWalls([source.wall, updated.object.wall]);
    this.onPlacementError('');
    if (this.selectionBox) this.selectionBox.material.color.set(0x23836c);
    this.applyObjectTransform(group, updated.object);
    if (this.lightingPreview) this.updateLightingLightPositions();
    this.selectionBox?.update();
  }

  updateFieldVolumeDepthTest() {
    let volume;
    this.fieldLayer?.traverse((child) => {
      if (!volume && child.userData?.boundsHalfSize) volume = child;
    });
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
    const seconds = time / 1000;
    const delta = this.lastAnimationTime === undefined ? 0 : THREE.MathUtils.clamp(seconds - this.lastAnimationTime, 0, 0.05);
    this.lastAnimationTime = seconds;
    // Selecting a simulated field is an explicit request to see it evolve.
    // Reduced motion still stops decorative object animation such as fan rotors.
    this.fieldLayer?.userData.animate?.(seconds);
    if (this.fieldLayer?.userData.gasVoxelCount) {
      this.renderer.domElement.dataset.gasDensityMax = String(this.fieldLayer.userData.maxDensity ?? 0);
      this.renderer.domElement.dataset.gasOccupiedVoxels = String(this.fieldLayer.userData.occupiedVoxels ?? 0);
      this.renderer.domElement.dataset.tracerVolumeM3 = String(this.fieldLayer.userData.tracerVolumeM3 ?? 0);
      this.renderer.domElement.dataset.exteriorTracerVolumeM3 = String(this.fieldLayer.userData.exteriorTracerVolumeM3 ?? 0);
    }
    if (!this.prefersReducedMotion) {
      for (const rotor of this.fanRotors.values()) {
        if (!rotor.userData.enabled) continue;
        if (rotor.userData.rotationAxis === 'y') rotor.rotation.y += delta * 9;
        else rotor.rotation.z += delta * 19;
      }
    }
    this.selectionBox?.update();
    this.hoverBox?.update();
    this.updateFieldVolumeDepthTest();
    this.renderer.render(this.scene, this.camera);
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
