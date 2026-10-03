import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { mountViewportCanvas } from './mount-canvas.js';
import { createRoomFieldLayer } from './room-field-layer-3d.js';

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

function createWindow(group, dimensions, open) {
  const { width, height, depth } = dimensions;
  const frame = 0.045;
  const rail = (size, position) => box(group, size, position, COLORS.windowFrame);
  rail({ width: frame, height, depth }, { x: -width / 2 + frame / 2, y: 0, z: 0 });
  rail({ width: frame, height, depth }, { x: width / 2 - frame / 2, y: 0, z: 0 });
  rail({ width, height: frame, depth }, { x: 0, y: -height / 2 + frame / 2, z: 0 });
  rail({ width, height: frame, depth }, { x: 0, y: height / 2 - frame / 2, z: 0 });
  rail({ width: frame * 0.55, height: height - frame * 2, depth }, { x: 0, y: 0, z: 0 });
  if (!open) {
    box(group, { width: width - frame * 2, height: height - frame * 2, depth: 0.012 }, { x: 0, y: 0, z: 0 }, COLORS.windowGlass, {
      transparent: true,
      opacity: 0.34,
      roughness: 0.18,
      depthWrite: false,
    }).castShadow = false;
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
  for (const window of windows.filter((item) => item.wall === wall)) {
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
  constructor(container, { onSelect = () => {}, onTransform = () => {}, onDragChange = () => {}, onPlacementError = () => {} } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.onTransform = onTransform;
    this.onDragChange = onDragChange;
    this.onPlacementError = onPlacementError;
    this.roomScene = null;
    this.selectedId = null;
    this.groups = new Map();
    this.fanRotors = new Map();
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
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
    if (selectedId && this.groups.has(selectedId)) this.transform.attach(this.groups.get(selectedId));
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
    const windows = this.roomScene.objects.filter((object) => object.model === 'window');
    const mesh = new THREE.Mesh(
      createWallGeometry(span, height, windows, wall.side, this.roomScene.room),
      material(0xf9fbf6, { transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.name = `room-wall-${wall.side}`;
    mesh.position.set(...wall.position);
    mesh.rotation.set(...wall.rotation);
    mesh.castShadow = false;
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
    if (object.model === 'window') createWindow(group, object.dimensions, object.open);
    else if (builder) builder(group, object.dimensions);
    else box(group, object.dimensions, { x: 0, y: 0, z: 0 }, COLORS.metal);
    group.userData.open = object.open;
    if (object.model === 'fan') {
      const rotor = group.getObjectByName('fan-rotor');
      rotor.userData.enabled = object.enabled !== false;
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
    if (initialScene) this.fitRoom(false);
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
    this.hemisphereLight.intensity = enabled ? 0.34 : 2.1;
    this.keyLight.intensity = enabled ? 0.08 : 2.6;
    this.renderer.toneMappingExposure = enabled ? 0.92 : 1.04;
    this.scene.background.set(enabled ? 0xf3f3f1 : 0xf6f8f6);
    for (const light of this.lightingLights) {
      this.scene.remove(light);
      light.dispose?.();
    }
    this.lightingLights = [];

    this.sceneRoot.traverse((child) => {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const item of materials) this.applyLightingToMaterial(item, enabled);
    });

    if (enabled) {
      for (const object of this.roomScene.objects.filter((item) => item.model === 'lamp')) {
        const group = this.groups.get(object.id);
        if (!group) continue;
        const source = new THREE.PointLight(0xffffff, 1, 9, 2);
        source.power = 4500 * (object.intensity ?? 1);
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
    }
    this.renderer.domElement.dataset.lightingPreview = String(enabled);
    if (enabled) {
      this.renderer.domElement.dataset.fieldMode = 'light';
      this.renderer.domElement.dataset.fieldVolumeVoxels = '0';
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
    if (this.isTopView) {
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(0, this.roomScene.room.height + distance, 0.001);
    } else {
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(distance * 0.88, distance * 0.7, distance * 0.96);
    }
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }

  fitRoom(resetView = true) {
    if (resetView) this.isTopView = false;
    this.setView(this.isTopView ? 'top' : '3d');
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
    if (source.model === 'window') this.rebuildWalls([source.wall, updated.object.wall]);
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
