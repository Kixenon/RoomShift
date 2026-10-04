import * as THREE from 'three';
import { rotationMatrixXYZ } from '../model/room-scene.js';
import { isOpeningObject } from '../model/openings.js';
import { temperatureDisplayRange } from '../simulation/room-field-display.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const indexOf = (i, j, k, grid) => (j * grid.nz + k) * grid.nx + i;
const airflowDisplayRange = (result) => result.displayRanges?.speedMaximum ?? 2.5;

function normalizeTemperature(value, result) {
  const { minimum, maximum } = temperatureDisplayRange(result);
  return clamp((value - minimum) / (maximum - minimum), 0, 1) ** 0.82;
}

function normalizeWifi(value) {
  return clamp((value + 75) / 40, 0, 1);
}

export function getAirflowColor(speed, maximumSpeed) {
  const intensity = clamp(Number.isFinite(speed) ? speed / Math.max(0.001, maximumSpeed) : 0, 0, 1);
  return new THREE.Color().setHSL(0.62 - intensity * 0.6, 0.9, 0.24 + intensity * 0.22);
}

export function getTemperatureColor(temperature, ambientTemperature, maximumTemperature) {
  const range = Math.max(0.05, maximumTemperature - ambientTemperature);
  const intensity = clamp((temperature - ambientTemperature) / range, 0, 1);
  return new THREE.Color().setHSL(0.63 - intensity * 0.63, 0.88, 0.31 + intensity * 0.17);
}

export function getLightColor(intensity) {
  const level = clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
  return new THREE.Color().setHSL(0.12 - level * 0.055, 0.3 + level * 0.58, 0.24 + level * 0.48);
}

export function getWifiColor(signalDbm) {
  const level = normalizeWifi(signalDbm);
  const weak = new THREE.Color(0xc0392b);
  const moderate = new THREE.Color(0xe1b12c);
  const strong = new THREE.Color(0x27ae60);
  return level < 0.52
    ? weak.lerp(moderate, level / 0.52)
    : moderate.lerp(strong, (level - 0.52) / 0.48);
}

function sampleField(field, x, y, z, grid, solid, fallback = 0) {
  const gx = clamp(x / grid.dx - 0.5, 0, grid.nx - 1);
  const gy = clamp(y / grid.dy - 0.5, 0, grid.ny - 1);
  const gz = clamp(z / grid.dz - 0.5, 0, grid.nz - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const tx = gx - x0;
  const ty = gy - y0;
  const tz = gz - z0;
  let value = 0;

  for (let oy = 0; oy <= 1; oy += 1) {
    for (let oz = 0; oz <= 1; oz += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const i = Math.min(x0 + ox, grid.nx - 1);
        const j = Math.min(y0 + oy, grid.ny - 1);
        const k = Math.min(z0 + oz, grid.nz - 1);
        const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
        const index = indexOf(i, j, k, grid);
        value += (solid?.[index] ? fallback : field[index]) * weight;
      }
    }
  }
  return value;
}

function normalizeScalar(result, mode, value) {
  if (mode === 'airflow') return clamp(value / airflowDisplayRange(result), 0, 1);
  if (mode === 'temperature') return normalizeTemperature(value, result);
  if (mode === 'wifi') return normalizeWifi(value);
  return clamp((value - result.ambientLevel) / Math.max((result.stats.maxLevel ?? result.stats.maxLight) - result.ambientLevel, 0.05), 0, 1);
}

function createFieldTexture(result, mode) {
  const { grid, fields } = result;
  const voxelCount = grid.nx * grid.ny * grid.nz;
  const data = new Uint8Array(voxelCount * 4);
  for (let index = 0; index < voxelCount; index += 1) {
    const value = mode === 'airflow'
      ? Math.hypot(fields.u[index], fields.v[index], fields.w[index])
      : mode === 'temperature' ? fields.temperature[index] : mode === 'wifi' ? fields.wifi[index] : fields.light[index];
    data[index * 4] = Math.round(normalizeScalar(result, mode, value) * 255);
    data[index * 4 + 1] = fields.solid?.[index] ? 255 : 0;
    if (mode === 'temperature') {
      const { minimum, maximum } = temperatureDisplayRange(result);
      const span = Math.max(0.5, value < result.ambientTemperature
        ? result.ambientTemperature - minimum
        : maximum - result.ambientTemperature);
      data[index * 4 + 2] = Math.round(clamp(Math.abs(value - result.ambientTemperature) / span, 0, 1) * 255);
    }
  }

  const texture = new THREE.Data3DTexture(data, grid.nx, grid.nz, grid.ny);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function createFieldVolume(result, mode) {
  const { grid } = result;
  const texture = createFieldTexture(result, mode);
  const stepLength = Math.max(Math.min(grid.dx, grid.dy, grid.dz) * 0.7, Math.hypot(grid.width, grid.height, grid.depth) / 176);
  const geometry = new THREE.BoxGeometry(grid.width, grid.height, grid.depth);
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uField: { value: texture },
      uVolumeSize: { value: new THREE.Vector3(grid.width, grid.height, grid.depth) },
      uStepLength: { value: stepLength },
      uOpacity: { value: mode === 'airflow' ? 1.2 : mode === 'temperature' ? 1.5 : 2.1 },
      uFieldMode: { value: mode === 'airflow' ? 0 : mode === 'temperature' ? 1 : mode === 'wifi' ? 3 : 2 },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vRayOrigin;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vLocalPosition = position;
        // Camera position in the volume's local space, so the raymarch can start
        // at the eye instead of assuming it sits outside the box.
        vRayOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      precision highp sampler3D;
      uniform sampler3D uField;
      uniform vec3 uVolumeSize;
      uniform float uStepLength;
      uniform float uOpacity;
      uniform int uFieldMode;
      varying vec3 vLocalPosition;
      varying vec3 vRayOrigin;
      out vec4 fragColor;

      vec3 palette(float value) {
        if (uFieldMode == 1) {
          vec3 navy = vec3(0.0052, 0.0116, 0.2307);
          vec3 blue = vec3(0.0091, 0.1046, 0.7370);
          vec3 cyan = vec3(0.0027, 0.4780, 0.7480);
          vec3 green = vec3(0.0350, 0.6940, 0.1710);
          vec3 yellow = vec3(0.8710, 0.7450, 0.0380);
          vec3 orange = vec3(0.8670, 0.1450, 0.0210);
          if (value < 0.18) return mix(navy, blue, value / 0.18);
          if (value < 0.38) return mix(blue, cyan, (value - 0.18) / 0.20);
          if (value < 0.58) return mix(cyan, green, (value - 0.38) / 0.20);
          if (value < 0.76) return mix(green, yellow, (value - 0.58) / 0.18);
          if (value < 0.9) return mix(yellow, orange, (value - 0.76) / 0.14);
          return mix(orange, vec3(1.0, 0.905, 0.723), (value - 0.9) / 0.1);
        }
        if (uFieldMode == 3) {
          vec3 weak = vec3(0.527, 0.047, 0.024);
          vec3 moderate = vec3(0.753, 0.434, 0.025);
          vec3 strong = vec3(0.020, 0.423, 0.117);
          if (value < 0.52) return mix(weak, moderate, value / 0.52);
          return mix(moderate, strong, (value - 0.52) / 0.48);
        }
        vec3 navy = vec3(0.015, 0.025, 0.11);
        vec3 blue = vec3(0.02, 0.22, 0.95);
        vec3 cyan = vec3(0.0, 0.86, 1.0);
      vec3 green = vec3(0.12, 0.92, 0.46);
      vec3 yellow = vec3(1.0, 0.78, 0.05);
      vec3 red = vec3(1.0, 0.08, 0.018);
        if (uFieldMode == 2) return vec3(value);
        if (value < 0.25) return mix(navy, blue, value * 4.0);
        if (value < 0.5) return mix(blue, cyan, (value - 0.25) * 4.0);
        if (value < 0.72) return mix(cyan, green, (value - 0.5) * 4.545);
        if (value < 0.88) return mix(green, yellow, (value - 0.72) * 6.25);
        return mix(yellow, red, (value - 0.88) * 8.333);
      }

      void main() {
        vec3 halfSize = uVolumeSize * 0.5;
        vec3 rayOrigin = vRayOrigin;
        vec3 direction = vLocalPosition - rayOrigin;
        float rayLength = length(direction);
        if (rayLength < 1e-6) discard;
        direction /= rayLength;
        bool cameraInside = all(lessThan(abs(rayOrigin), halfSize));
        // Rasterise exactly one surface per pixel: the entry face when the camera
        // is outside, the exit face once it is inside. Both faces otherwise
        // composite the same segment and double the opacity.
        if (gl_FrontFacing == cameraInside) discard;

        // Clip the view ray to the volume so the march starts at the surface the
        // camera actually sees through, which is the camera itself when inside.
        vec3 inverseDirection = 1.0 / direction;
        vec3 near = (-halfSize - rayOrigin) * inverseDirection;
        vec3 far = (halfSize - rayOrigin) * inverseDirection;
        vec3 entry = min(near, far);
        vec3 exit = max(near, far);
        float startDistance = max(max(entry.x, entry.y), entry.z);
        float endDistance = min(min(exit.x, exit.y), exit.z);
        startDistance = max(startDistance, 0.0);
        if (endDistance <= startDistance) discard;

        float stepLength = uStepLength;
        int stepCount = min(192, int(ceil((endDistance - startDistance) / stepLength)));
        vec4 accumulated = vec4(0.0);
        for (int index = 0; index < 192; index++) {
          if (index >= stepCount) break;
          float distance = startDistance + (float(index) + 0.5) * stepLength;
          vec3 point = rayOrigin + direction * distance;
          vec3 roomCoordinate = point / uVolumeSize + 0.5;
          vec3 textureCoordinate = vec3(roomCoordinate.x, roomCoordinate.z, roomCoordinate.y);
          vec4 field = texture(uField, textureCoordinate);
          float density = 0.012 * smoothstep(0.002, 0.035, field.r)
            + 0.28 * smoothstep(0.04, 0.22, field.r);
          if (uFieldMode == 1) { density = 0.015 + 0.65 * smoothstep(0.002, 0.08, field.b); }
          if (uFieldMode == 3) { density = 0.018 + 0.24 * smoothstep(0.0, 0.14, field.r); }
          density *= 1.0 - step(0.5, field.g);
          float alpha = 1.0 - exp(-density * 2.35 * stepLength * uOpacity);
          float contribution = (1.0 - accumulated.a) * alpha;
          accumulated.rgb += palette(field.r) * contribution;
          accumulated.a += contribution;
          if (accumulated.a > 0.985) break;
        }
        if (accumulated.a < 0.004) discard;
        fragColor = linearToOutputTexel(vec4(accumulated.rgb, accumulated.a));
      }
    `,
  });
  const volume = new THREE.Mesh(geometry, material);
  volume.name = `field-volume-${mode}`;
  volume.position.y = grid.height / 2;
  volume.renderOrder = 1;
  volume.userData.voxelCount = grid.nx * grid.ny * grid.nz;
  // World-space bounds of the marched volume, so the viewport can tell when the
  // camera is inside it and drop depth testing for the overlay.
  volume.userData.boundsCenter = new THREE.Vector3(0, grid.height / 2, 0);
  volume.userData.boundsHalfSize = new THREE.Vector3(grid.width / 2, grid.height / 2, grid.depth / 2);
  return volume;
}

export function createScalarSliceLayer(result, mode, height) {
  const { grid, fields } = result;
  const geometry = new THREE.PlaneGeometry(grid.width, grid.depth, grid.nx - 1, grid.nz - 1);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 4);
  const point = new THREE.Vector3();
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index);
    const x = point.x + grid.width / 2;
    const z = grid.depth / 2 - point.y;
    if (mode === 'airflow') {
      const speed = Math.hypot(
        sampleField(fields.u, x, height, z, grid, fields.solid),
        sampleField(fields.v, x, height, z, grid, fields.solid),
        sampleField(fields.w, x, height, z, grid, fields.solid),
      );
      getAirflowColor(speed, airflowDisplayRange(result)).toArray(colors, index * 4);
    } else if (mode === 'wifi') {
      const signal = sampleField(fields.wifi, x, height, z, grid, fields.solid, -100);
      getWifiColor(signal).toArray(colors, index * 4);
    } else {
      const temperature = sampleField(fields.temperature, x, height, z, grid, fields.solid, result.ambientTemperature);
      infraredColor(temperature, result, color).toArray(colors, index * 4);
    }
    colors[index * 4 + 3] = 0.82;
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  mesh.name = `field-slice-${mode}`;
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = clamp(height, 0, grid.height);
  mesh.renderOrder = 1;
  if (mode !== 'airflow') return mesh;
  const layer = new THREE.Group();
  layer.name = mesh.name;
  layer.add(mesh);
  const spacing = Math.max(0.4, grid.width / 12, grid.depth / 12);
  for (let x = spacing / 2; x < grid.width; x += spacing) for (let z = spacing / 2; z < grid.depth; z += spacing) {
    const id = (Math.min(grid.ny - 1, Math.floor(height / grid.dy)) * grid.nz + Math.min(grid.nz - 1, Math.floor(z / grid.dz))) * grid.nx + Math.min(grid.nx - 1, Math.floor(x / grid.dx));
    if (fields.solid[id]) continue;
    const velocity = new THREE.Vector3(...['u', 'v', 'w'].map((key) => sampleField(fields[key], x, height, z, grid, fields.solid)));
    const speed = velocity.length();
    if (speed < 0.02) continue;
    const length = Math.min(spacing * 0.65, 0.05 + speed * 0.15);
    const arrow = new THREE.ArrowHelper(velocity.normalize(), new THREE.Vector3(x - grid.width / 2, height + 0.015, z - grid.depth / 2), length, 0xffffff, length * 0.35, length * 0.2);
    layer.add(arrow);
  }
  return layer;
}

const INFRARED_STOPS = [
  [0, 0x101b84],
  [0.18, 0x185bde],
  [0.38, 0x09b8e0],
  [0.58, 0x35d973],
  [0.76, 0xf0df37],
  [0.9, 0xef6b28],
  [1, 0xfff4dd],
].map(([position, color]) => ({ position, color: new THREE.Color(color) }));

function infraredColor(value, result, target) {
  const normalized = normalizeTemperature(value, result);
  const upperIndex = INFRARED_STOPS.findIndex((stop) => stop.position >= normalized);
  const upper = INFRARED_STOPS[Math.max(1, upperIndex)];
  const lower = INFRARED_STOPS[Math.max(0, upperIndex - 1)];
  return target.copy(lower.color).lerp(upper.color, (normalized - lower.position) / (upper.position - lower.position));
}

function createInfraredPlane(result, scene, wall) {
  const { grid } = result;
  const floor = wall === 'floor';
  const ceiling = wall === 'ceiling';
  const horizontal = floor || ceiling;
  const alongX = horizontal || wall === 'front' || wall === 'back';
  const span = alongX ? grid.width : grid.depth;
  const segmentsX = alongX ? grid.nx - 1 : grid.nz - 1;
  const segmentsY = horizontal ? grid.nz - 1 : grid.ny - 1;
  const geometry = new THREE.PlaneGeometry(span, horizontal ? grid.depth : grid.height, segmentsX, segmentsY);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: false,
    alphaTest: 0.5,
    depthWrite: true,
    side: THREE.FrontSide,
    toneMapped: false,
  }));
  mesh.name = `infrared-${wall}`;
  if (horizontal) {
    mesh.rotation.x = floor ? -Math.PI / 2 : Math.PI / 2;
    mesh.position.y = floor ? 0.012 : grid.height - 0.012;
  } else {
    mesh.position.y = grid.height / 2;
    if (wall === 'front') mesh.position.z = -grid.depth / 2 + 0.008;
    if (wall === 'back') {
      mesh.position.z = grid.depth / 2 - 0.008;
      mesh.rotation.y = Math.PI;
    }
    if (wall === 'left') {
      mesh.position.x = -grid.width / 2 + 0.008;
      mesh.rotation.y = Math.PI / 2;
    }
    if (wall === 'right') {
      mesh.position.x = grid.width / 2 - 0.008;
      mesh.rotation.y = -Math.PI / 2;
    }
  }
  mesh.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  const colors = new Float32Array(geometry.attributes.position.count * 4);
  const openings = scene?.objects?.filter((object) => isOpeningObject(object) && object.open && object.wall === wall) ?? [];
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    const x = point.x + grid.width / 2;
    const y = floor ? Math.max(0.04, grid.dy * 0.55)
      : ceiling ? Math.min(grid.height - 0.04, grid.height - grid.dy * 0.55) : point.y;
    const z = point.z + grid.depth / 2;
    const temperature = sampleField(result.fields.temperature, x, y, z, grid, result.fields.solid, result.ambientTemperature);
    infraredColor(temperature, result, color).toArray(colors, index * 4);
    const along = wall === 'left' || wall === 'right' ? z : x;
    const insideOpening = openings.some((window) => {
      const center = wall === 'left' || wall === 'right' ? window.position.z : window.position.x;
      return Math.abs(along - center) <= window.dimensions.width / 2
        && point.y >= window.position.y && point.y <= window.position.y + window.dimensions.height;
    });
    colors[index * 4 + 3] = insideOpening ? 0 : 1;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  mesh.renderOrder = 1;
  return mesh;
}

export function createTemperatureSurfaceLayer(result, roomScene) {
  const layer = new THREE.Group();
  layer.name = 'infrared-temperature-surfaces';
  for (const wall of ['floor', 'ceiling', 'front', 'back', 'left', 'right']) {
    layer.add(createInfraredPlane(result, roomScene, wall));
  }
  return layer;
}

export function createTemperatureObjectLayer(result, objectGroups = new Map()) {
  const layer = new THREE.Group();
  layer.name = 'infrared-object-surfaces';
  if (!objectGroups?.size) return layer;
  const { grid } = result;
  const offset = Math.max(0.05, Math.min(grid.dx, grid.dy, grid.dz) * 0.62);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const color = new THREE.Color();
  const normalMatrix = new THREE.Matrix3();

  for (const [id, source] of objectGroups) {
    source.updateWorldMatrix(true, true);
    const overlay = source.clone(true);
    overlay.name = `infrared-object-${id}`;
    const sourceMeshes = [];
    const overlayMeshes = [];
    source.traverse((child) => { if (child.isMesh) sourceMeshes.push(child); });
    overlay.traverse((child) => { if (child.isMesh) overlayMeshes.push(child); });

    for (let meshIndex = 0; meshIndex < sourceMeshes.length; meshIndex += 1) {
      const sourceMesh = sourceMeshes[meshIndex];
      const overlayMesh = overlayMeshes[meshIndex];
      const geometry = sourceMesh.geometry.clone();
      const vertices = geometry.attributes.position;
      const normals = geometry.attributes.normal;
      const colors = new Float32Array(vertices.count * 4);
      normalMatrix.getNormalMatrix(sourceMesh.matrixWorld);
      for (let vertex = 0; vertex < vertices.count; vertex += 1) {
        point.fromBufferAttribute(vertices, vertex).applyMatrix4(sourceMesh.matrixWorld);
        if (normals) {
          normal.fromBufferAttribute(normals, vertex).applyMatrix3(normalMatrix).normalize();
          point.addScaledVector(normal, offset);
        }
        const temperature = sampleField(
          result.fields.temperature,
          point.x + grid.width / 2,
          point.y,
          point.z + grid.depth / 2,
          grid,
          result.fields.solid,
          result.ambientTemperature,
        );
        infraredColor(temperature, result, color).toArray(colors, vertex * 4);
        colors[vertex * 4 + 3] = 1;
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
      overlayMesh.geometry = geometry;
      overlayMesh.material = material;
      overlayMesh.renderOrder = 3;
    }
    layer.add(overlay);
  }
  return layer;
}
