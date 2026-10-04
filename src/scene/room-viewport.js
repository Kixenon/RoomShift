import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mountViewportCanvas } from './mount-canvas.js';
import { createRoomFieldLayer } from './room-field-layer-3d.js';
import { DEFAULT_LAMP_POWER, DEFAULT_TIME_MINUTES, describeDaylight } from '../simulation/daylight.js';
import { indirectLux, lightContext, skyLux, windowRadiance } from '../simulation/room-light.js';
import { isOpeningObject } from '../model/openings.js';

// RectAreaLight needs its LTC look-up textures registered once before any window
// light renders; without this the window lights contribute nothing.
let rectAreaLightsReady = false;
function ensureRectAreaLights() {
  if (rectAreaLightsReady) return;
  RectAreaLightUniformsLib.init();
  rectAreaLightsReady = true;
}

// Hand-tuned bridge from the radiosity model's radiance (nits-like) to a Three.js
// area-light power in lumens. Chosen so a bright open window reads about like the
// lamps and does not blow out the tone-mapped preview; not a photometric value.
const WINDOW_LIGHT_GAIN = 0.06;
// Interior illuminance (lux-like) that maps to full sky fill, so the room is lit
// from its windows and their inter-reflection even when no direct sun reaches it.
const SKY_FILL_REFERENCE_LUX = 800;

// Nominal power for the point lights at lamp bulbs, in lumens. Matches what the
// light preview used before there was a time of day, so an unchanged scene looks
// the same at the times when the lamps are on.
const LAMP_LIGHT_DISTANCE = 9;
// Clips a shaft to the inside of the room so it never bleeds through a wall or
// the floor. Mirrors the bounds the shell geometry already describes.
const ROOM_PLANES = (room) => [
  new THREE.Plane(new THREE.Vector3(1, 0, 0), room.width / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), room.width / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(0, 0, 1), room.depth / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), room.depth / 2 + 0.001),
  new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.001),
  new THREE.Plane(new THREE.Vector3(0, -1, 0), room.height),
];

const COLORS = Object.freeze({
  fan: 0x6d9c85,
  sofa: 0x819f84,
  desk: 0xc2a97a,
  table: 0xb69b73,
  lamp: 0x86a88f,
  heater: 0xaab2aa,
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

const BUILDERS = Object.freeze({ fan: createFan, sofa: createSofa, bed: createBed, desk: createDesk, table: createTable, lamp: createLamp, heater: createHeater });

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
    this.windowLights = [];
    this.radiosityContext = null;
    this.timeMinutes = DEFAULT_TIME_MINUTES;
    this.daylightState = null;
    this.sunPatchMeshes = [];
    this.sunShaftMeshes = [];
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
    // Required for material.clippingPlanes to take effect; without it three.js
// silently ignores them and the sun shafts draw straight through the floor.
this.renderer.localClippingEnabled = true;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap filters across neighbouring texels instead of testing a single
    // sample, so the sun gets a penumbra rather than a hard one-pixel edge where
    // lit floor meets shadowed floor. VSM honours shadow.radius for a wider blur,
    // but it leaked light across the whole room here and washed the direct sun
    // out entirely, so the softer-but-wrong look was not worth trading for.
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    this.keyLight.shadow.normalBias = 0.03;
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
      material(0xe8e7dc, { roughness: 0.93 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.012;
    floor.receiveShadow = true;
    this.sceneRoot.add(floor);

    const gridPoints = [];
    for (let x = -width / 2; x <= width / 2 + 0.001; x += 0.5) {
      gridPoints.push(new THREE.Vector3(x, 0.006, -depth / 2), new THREE.Vector3(x, 0.006, depth / 2));
    }
    for (let z = -depth / 2; z <= depth / 2 + 0.001; z += 0.5) {
      gridPoints.push(new THREE.Vector3(-width / 2, 0.006, z), new THREE.Vector3(width / 2, 0.006, z));
    }
    const gridGeometry = new THREE.BufferGeometry().setFromPoints(gridPoints);
    const grid = new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x9aa99c, transparent: true, opacity: 0.23 }));
    this.sceneRoot.add(grid);

    for (const wall of wallLayouts(this.roomScene.room)) this.createWall(wall);
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(width, depth),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false }),
    );
    ceiling.name = 'daylight-ceiling-occluder';
    ceiling.rotation.x = -Math.PI / 2;
    ceiling.position.y = height;
    // The roof is part of the shell and has to keep blocking the sun, otherwise
    // daylight lands on the room as if it came through the roof. Direct sun
    // reaches the interior only through the apertures in the walls below, and
    // rebuildSunShafts draws the visible beam for each one.
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
      material(0xf9fbf6, { transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
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
    if (object.model === 'fan') {
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
    if (showLighting) this.setLightingPreview(true);
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

  setLightingPreview(enabled) {
    if (enabled === this.lightingPreview) return;
    this.lightingPreview = enabled;
    this.clearSunPatches();
    for (const light of [...this.lightingLights, ...this.windowLights]) {
      this.scene.remove(light);
      light.dispose?.();
    }
    this.lightingLights = [];
    this.windowLights = [];

    if (!enabled) {
      // Restore the neutral studio lighting the editor shows outside the preview.
      this.clearSunShafts();
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
      for (const object of this.roomScene.objects.filter((item) => item.model === 'lamp' && item.enabled !== false)) {
        const group = this.groups.get(object.id);
        if (!group) continue;
        const source = new THREE.PointLight(0xffffff, 1, LAMP_LIGHT_DISTANCE, 2);
        source.power = DEFAULT_LAMP_POWER * (object.intensity ?? 1);
        source.castShadow = true;
        source.position.set(0, object.dimensions.height * 0.22, 0);
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

      // An area light at each aperture stands in for the sky it admits. The
      // radiosity model decides how bright each one is (applyDaylight); this only
      // builds and orients them. RectAreaLight is the right shape for a window —
      // a rectangle of diffuse emission — and, needing no shadow map, it behaves
      // as a soft fill that keeps the room lit from its openings.
      ensureRectAreaLights();
      const { width: roomWidth, depth: roomDepth } = this.roomScene.room;
      for (const object of this.roomScene.objects.filter(isOpeningObject)) {
        const inward = { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0] }[object.wall];
        if (!inward) continue;
        const alongX = object.wall === 'back' || object.wall === 'front';
        const plane = object.wall === 'front' ? -roomDepth / 2
          : object.wall === 'back' ? roomDepth / 2
            : object.wall === 'left' ? -roomWidth / 2 : roomWidth / 2;
        const across = alongX ? object.position.x - roomWidth / 2 : object.position.z - roomDepth / 2;
        const centre = new THREE.Vector3(
          alongX ? across : plane,
          object.position.y + object.dimensions.height / 2,
          alongX ? plane : across,
        );
        const into = new THREE.Vector3(inward[0], 0, inward[2]);
        const light = new THREE.RectAreaLight(0xffffff, 0, object.dimensions.width, object.dimensions.height);
        light.position.copy(centre).addScaledVector(into, 0.02);
        light.lookAt(centre.clone().add(into));
        light.userData.openingId = object.id;
        this.scene.add(light);
        this.windowLights.push(light);
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
    // The room shell blocks the sun, so direct light can only arrive through the
    // apertures in the walls. Lighting the sun from a point far outside the room
    // would have every interior surface sit behind the shell in the shadow map,
    // leaving furniture uniformly dark and casting nothing. Placing the light just
    // outside each sun-facing wall, along the real sun vector, lets the aperture
    // do the shaping: sun enters the opening, and anything it touches casts a
    // shadow inside the room. Walls the sun is not shining into contribute no
    // light, which is what keeps daylight from appearing to fall from the roof.
    const reach = Math.max(this.roomScene?.room.width ?? 5, this.roomScene?.room.depth ?? 4) + 6;
    const { width = 5, depth = 4 } = this.roomScene?.room ?? {};
    const roomCentre = new THREE.Vector3(width / 2, this.roomScene.room.height / 2, depth / 2);
    // Step just outside whichever wall the sun is arriving through, along the sun
    // vector, so the aperture sits between the light and the room interior.
    const margins = [
      ...(direction.x !== 0 ? [width / 2 + 0.6] : []),
      ...(direction.z !== 0 ? [depth / 2 + 0.6] : []),
    ];
    // Distance from the room centre back out to just past the sun-facing wall.
    const back = Math.max(...margins, 0.6);
    const sun = new THREE.Vector3(direction.x, Math.max(direction.y, 0.05), direction.z).normalize();
    this.keyLight.position.copy(roomCentre).addScaledVector(sun, back + reach * 0.25);
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

    // The radiosity model supplies the fill: the sky seen through each opening
    // plus the light that bounced off the surfaces it lit. This is what drives
    // the room brightening by day through its windows rather than a fixed
    // constant, and it keeps furniture legible when the sun is not reaching it.
    const context = lightContext(this.roomScene, state);
    this.radiosityContext = context;
    const { width: fillWidth, depth: fillDepth } = this.roomScene.room;
    const sample = { x: fillWidth / 2, y: 0.75, z: fillDepth / 2 };
    const ambient = skyLux(context, sample) + indirectLux(context, sample);
    this.hemisphereLight.color.setHex(0xeaf3ed);
    this.hemisphereLight.intensity = 0.35 + 2.2 * THREE.MathUtils.clamp(ambient / SKY_FILL_REFERENCE_LUX, 0, 1);
    for (const light of this.windowLights ?? []) {
      const opening = context.windows.find((window) => window.object.id === light.userData.openingId);
      if (!opening) {
        light.visible = false;
        continue;
      }
      const radiance = windowRadiance(context, opening);
      light.color.setRGB(state.sky.colour.r, state.sky.colour.g, state.sky.colour.b);
      light.power = radiance * opening.area * Math.PI * WINDOW_LIGHT_GAIN;
      light.visible = radiance > 0 && state.sun.daylight > 0.01;
    }

    this.scene.background.setRGB(state.background.r, state.background.g, state.background.b);
    this.renderer.toneMappingExposure = state.exposure;

    for (const light of this.lightingLights) {
      const lamp = this.roomScene.objects.find((object) => object.id === light.userData.objectId);
      light.power = (lamp?.enabled !== false ? DEFAULT_LAMP_POWER : 0) * (lamp?.intensity ?? 1);
    }
    this.rebuildSunPatches();
    this.rebuildSunShafts();
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
    data.lampsOn = String(this.roomScene.objects.some((object) => object.model === 'lamp' && object.enabled !== false));
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

  /**
   * Draw the visible beam of daylight entering through each open window or door.
   * The shell blocks the sun everywhere else, so without this the shafts are the
   * only cue that light is entering the room at all.
   *
   * A beam is built from nested shells that taper toward its axis, rather than a
   * single hollow box. Additive blending sums the shells a view ray crosses, so
   * the overlapping core reads brightest and the outer shells feather to almost
   * nothing: the cross-section fades the way scattered light does instead of
   * ending at a hard silhouette. Along the beam the vertices dim to zero, so the
   * far end dissolves into the room rather than stopping at a cut edge.
   */
  rebuildSunShafts() {
    this.clearSunShafts();
    const state = this.daylightState;
    if (!state || !this.lightingPreview) return;
    const { width, depth, height } = this.roomScene.room;
    const { direction, colour, daylight } = state.sun;
    if (daylight <= 0.02 || direction.y <= 1e-4) return;

    // Direction the light travels, from the sun into the room.
    const travel = new THREE.Vector3(-direction.x, -direction.y, -direction.z);
    const clipping = ROOM_PLANES(this.roomScene.room);
    const openings = this.roomScene.objects.filter((object) => isOpeningObject(object) && object.open !== false);
    // Brighter when the sun is high and strong, and eased off in the preview so
    // the additive beams layer without blowing the room out.
    const strength = THREE.MathUtils.clamp(daylight, 0, 1);
    const tint = new THREE.Color(colour.r, colour.g, colour.b);
    // Nested shells feather the beam across its width; slicing the length lets
    // the brightness fall off smoothly instead of along one long facet.
    const SHELLS = 4;
    const SEGMENTS = 6;
    const base = 0.11 * (0.4 + strength);

    for (const opening of openings) {
      const inward = { front: [0, 1], back: [0, -1], left: [1, 0], right: [-1, 0] }[opening.wall];
      if (!inward) continue;
      // Skip openings the sun is not shining into.
      if (travel.x * inward[0] + travel.z * inward[1] <= 0.02) continue;

      const alongX = opening.wall === 'back' || opening.wall === 'front';
      const plane = opening.wall === 'front' ? -depth / 2
        : opening.wall === 'back' ? depth / 2
          : opening.wall === 'left' ? -width / 2 : width / 2;
      const centre = alongX ? opening.position.x - width / 2 : opening.position.z - depth / 2;
      const half = opening.dimensions.width / 2;
      const y0 = opening.position.y;
      const y1 = y0 + opening.dimensions.height;
      const corners = [[centre - half, y0], [centre + half, y0], [centre + half, y1], [centre - half, y1]]
        .map(([s, y]) => (alongX ? new THREE.Vector3(s, y, plane) : new THREE.Vector3(plane, y, s)));
      const length = Math.max(width, depth, height) * 3;
      const far = corners.map((corner) => corner.clone().addScaledVector(travel, length));
      const openingCentre = corners.reduce((sum, corner) => sum.add(corner), new THREE.Vector3()).multiplyScalar(1 / corners.length);
      const farCentre = openingCentre.clone().addScaledVector(travel, length);

      const positions = [];
      const colors = [];
      const push = (point, scale) => {
        positions.push(point.x, point.y, point.z);
        colors.push(tint.r * scale, tint.g * scale, tint.b * scale);
      };

      for (let shell = 0; shell < SHELLS; shell += 1) {
        const spread = 1 - (shell / SHELLS) * 0.72;
        const shellStrength = 0.12 + 0.88 * (shell / (SHELLS - 1));
        const nearRing = corners.map((corner) => openingCentre.clone().lerp(corner, spread));
        const farRing = far.map((corner) => farCentre.clone().lerp(corner, spread));
        // Brightest at the aperture and dissolving with distance, so the beam
        // fades out instead of ending in a hard edge.
        const shade = (t) => shellStrength * base * (1 - t) ** 2;

        for (let edge = 0; edge < 4; edge += 1) {
          const next = (edge + 1) % 4;
          for (let step = 0; step < SEGMENTS; step += 1) {
            const t0 = step / SEGMENTS;
            const t1 = (step + 1) / SEGMENTS;
            const a0 = nearRing[edge].clone().lerp(farRing[edge], t0);
            const b0 = nearRing[next].clone().lerp(farRing[next], t0);
            const a1 = nearRing[edge].clone().lerp(farRing[edge], t1);
            const b1 = nearRing[next].clone().lerp(farRing[next], t1);
            const s0 = shade(t0);
            const s1 = shade(t1);
            push(a0, s0);
            push(b0, s0);
            push(a1, s1);
            push(b0, s0);
            push(b1, s1);
            push(a1, s1);
          }
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const shaft = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        clippingPlanes: clipping,
        toneMapped: false,
      }));
      shaft.renderOrder = 1;
      shaft.name = `sun-shaft-${opening.id}`;
      shaft.raycast = () => {};
      this.sceneRoot.add(shaft);
      this.sunShaftMeshes.push(shaft);
    }
  }

  clearSunShafts() {
    for (const mesh of this.sunShaftMeshes) {
      this.sceneRoot.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.sunShaftMeshes = [];
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
      light.position.set(0, object.dimensions.height * 0.22, 0);
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
        if (rotor.userData.enabled) rotor.rotation.z += delta * 19;
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
