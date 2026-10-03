import * as THREE from 'three';
import { rotationMatrixXYZ } from '../model/room-scene.js';
import { isOpeningObject } from '../model/openings.js';
import { temperatureDisplayRange } from '../simulation/room-field-display.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const indexOf = (i, j, k, grid) => (j * grid.nz + k) * grid.nx + i;
const airflowDisplayRange = (result) => Math.max(0.05, result.stats?.maxSpeed ?? 1.2);

function normalizeTemperature(value, result) {
  const { minimum, maximum } = temperatureDisplayRange(result);
  return clamp((value - minimum) / (maximum - minimum), 0, 1) ** 0.82;
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

function sampleVelocity(result, point, target = new THREE.Vector3()) {
  const { grid, fields } = result;
  return target.set(
    sampleField(fields.u, point.x, point.y, point.z, grid, fields.solid),
    sampleField(fields.v, point.x, point.y, point.z, grid, fields.solid),
    sampleField(fields.w, point.x, point.y, point.z, grid, fields.solid),
  );
}

function normalizeScalar(result, mode, value) {
  if (mode === 'airflow') return clamp(value / airflowDisplayRange(result), 0, 1);
  if (mode === 'temperature') return normalizeTemperature(value, result);
  return clamp((value - result.ambientLevel) / Math.max((result.stats.maxLevel ?? result.stats.maxLight) - result.ambientLevel, 0.05), 0, 1);
}

function createFieldTexture(result, mode) {
  const { grid, fields } = result;
  const voxelCount = grid.nx * grid.ny * grid.nz;
  const data = new Uint8Array(voxelCount * 4);
  for (let index = 0; index < voxelCount; index += 1) {
    const value = mode === 'airflow'
      ? Math.hypot(fields.u[index], fields.v[index], fields.w[index])
      : mode === 'temperature' ? fields.temperature[index] : fields.light[index];
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
      uFieldMode: { value: mode === 'airflow' ? 0 : mode === 'temperature' ? 1 : 2 },
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
  return mesh;
}

function isGasPointOpen(x, y, z, volume) {
  const { grid, margin, blocked, roomGrid, roomSolid } = volume;
  if (x < -margin || x > grid.width - margin || y < 0 || y > grid.height
    || z < -margin || z > grid.depth - margin) return false;
  if (x >= 0 && x <= roomGrid.width && y >= 0 && y <= roomGrid.height
    && z >= 0 && z <= roomGrid.depth) {
    const roomI = clamp(Math.floor(x / roomGrid.dx), 0, roomGrid.nx - 1);
    const roomJ = clamp(Math.floor(y / roomGrid.dy), 0, roomGrid.ny - 1);
    const roomK = clamp(Math.floor(z / roomGrid.dz), 0, roomGrid.nz - 1);
    if (roomSolid[indexOf(roomI, roomJ, roomK, roomGrid)]) return false;
  }
  const i = clamp(Math.floor((x + margin) / grid.dx), 0, grid.nx - 1);
  const j = clamp(Math.floor(y / grid.dy), 0, grid.ny - 1);
  const k = clamp(Math.floor((z + margin) / grid.dz), 0, grid.nz - 1);
  return !blocked[indexOf(i, j, k, grid)];
}

function clipGasBacktrace(volume, x, y, z, endX, endY, endZ, target) {
  const distance = Math.hypot(endX - x, endY - y, endZ - z);
  const stepLength = Math.min(volume.grid.dx, volume.grid.dy, volume.grid.dz) * 0.4;
  const steps = Math.max(1, Math.ceil(distance / stepLength));
  let clippedX = x;
  let clippedY = y;
  let clippedZ = z;
  for (let step = 1; step <= steps; step += 1) {
    const fraction = step / steps;
    const candidateX = x + (endX - x) * fraction;
    const candidateY = y + (endY - y) * fraction;
    const candidateZ = z + (endZ - z) * fraction;
    if (!isGasPointOpen(candidateX, candidateY, candidateZ, volume)) break;
    clippedX = candidateX;
    clippedY = candidateY;
    clippedZ = candidateZ;
  }
  return target.set(clippedX, clippedY, clippedZ);
}

function makeEmitter(position, direction, axis, radius, kind = 'flow', weight = 1) {
  const normal = direction.clone().normalize();
  const spanAxis = axis.clone().addScaledVector(normal, -axis.dot(normal));
  if (spanAxis.lengthSq() < 1e-6) {
    spanAxis.set(0, 0, 1).addScaledVector(normal, -normal.z);
  }
  spanAxis.normalize();
  const sideAxis = new THREE.Vector3().crossVectors(normal, spanAxis).normalize();
  return { position, direction: normal, axis: spanAxis, sideAxis, radius, kind, weight };
}

function getAirEmitters(result, roomScene) {
  const { grid, fields } = result;
  const emitters = [];
  for (const fan of roomScene?.objects ?? []) {
    if (fan.model !== 'fan' || fan.enabled === false || (fan.intensity ?? 1) <= 0) continue;
    const matrix = rotationMatrixXYZ(fan.rotation);
    const local = {
      x: 0,
      y: fan.dimensions.height * 0.24,
      z: fan.dimensions.depth / 2 + Math.min(grid.dx, grid.dy, grid.dz) * 0.5,
    };
    const position = new THREE.Vector3(
      fan.position.x + matrix[0][0] * local.x + matrix[0][1] * local.y + matrix[0][2] * local.z,
      fan.position.y + fan.dimensions.height / 2 + matrix[1][0] * local.x + matrix[1][1] * local.y + matrix[1][2] * local.z,
      fan.position.z + matrix[2][0] * local.x + matrix[2][1] * local.y + matrix[2][2] * local.z,
    );
    const direction = new THREE.Vector3(matrix[0][2], matrix[1][2], matrix[2][2]);
    const radius = Math.max(0.06, fan.dimensions.width * 0.32);
    const grillePoint = position.clone().addScaledVector(direction, Math.min(0.04, Math.min(grid.dx, grid.dy, grid.dz) * 0.5));
    const sampledSpeed = Math.max(0, sampleVelocity(result, grillePoint).dot(direction));
    const intensity = fan.intensity ?? 1;
    const outletSpeed = Math.min(1.2 * intensity, Math.max(sampledSpeed, 0.15 * intensity));
    emitters.push(makeEmitter(
      position,
      direction,
      new THREE.Vector3(matrix[0][0], matrix[1][0], matrix[2][0]),
      radius,
      'fan',
      Math.max(0.002, outletSpeed * Math.PI * radius ** 2),
    ));
  }

  for (const window of roomScene?.objects ?? []) {
    if (!isOpeningObject(window) || !window.open) continue;
    const alongX = window.wall === 'back' || window.wall === 'front';
    const outward = {
      front: new THREE.Vector3(0, 0, -1),
      back: new THREE.Vector3(0, 0, 1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
    }[window.wall];
    const axis = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const side = window.wall === 'left' ? 1 : window.wall === 'right' ? 2
      : window.wall === 'front' ? 16 : 32;
    const alongSpacing = alongX ? grid.dx : grid.dz;
    const alongCells = alongX ? grid.nx : grid.nz;
    const alongPosition = alongX ? window.position.x : window.position.z;
    const firstAlong = clamp(Math.floor((alongPosition - window.dimensions.width / 2) / alongSpacing), 0, alongCells - 1);
    const lastAlong = clamp(Math.floor((alongPosition + window.dimensions.width / 2) / alongSpacing), 0, alongCells - 1);
    const firstJ = clamp(Math.floor(window.position.y / grid.dy), 0, grid.ny - 1);
    const lastJ = clamp(Math.floor((window.position.y + window.dimensions.height) / grid.dy), 0, grid.ny - 1);
    const middleJ = Math.floor((firstJ + lastJ) / 2);
    const inflow = [0, 1].map(() => ({ weight: 0, position: new THREE.Vector3() }));
    for (let j = firstJ; j <= lastJ; j += 1) {
      for (let along = firstAlong; along <= lastAlong; along += 1) {
        const i = alongX ? along : window.wall === 'left' ? 0 : grid.nx - 1;
        const k = alongX ? window.wall === 'front' ? 0 : grid.nz - 1 : along;
        const index = indexOf(i, j, k, grid);
        if (!(fields.outlets[index] & side)) continue;
        const outwardSpeed = fields.windowFlow[index] * outward.x
          + fields.windowFlow[index] * outward.z;
        if (outwardSpeed >= -0.01) continue;
        const band = j <= middleJ ? 0 : 1;
        const weight = -outwardSpeed;
        inflow[band].weight += weight;
        inflow[band].position.add(new THREE.Vector3(
          (i + 0.5) * grid.dx,
          (j + 0.5) * grid.dy,
          (k + 0.5) * grid.dz,
        ).multiplyScalar(weight));
      }
    }
    for (const opening of inflow) {
      if (opening.weight <= 0.01) continue;
      const position = opening.position.multiplyScalar(1 / opening.weight)
        .addScaledVector(outward, -0.02);
      emitters.push(makeEmitter(
        position,
        outward.clone().negate(),
        axis,
        Math.max(0.08, window.dimensions.width * 0.36),
        'window',
        opening.weight * alongSpacing * grid.dy,
      ));
    }
  }

  if (emitters.length) return emitters;
  const candidates = [];
  for (let j = 1; j < grid.ny - 1; j += 2) {
    for (let k = 1; k < grid.nz - 1; k += 2) {
      for (let i = 1; i < grid.nx - 1; i += 2) {
        const index = indexOf(i, j, k, grid);
        if (fields.solid[index]) continue;
        const speed = Math.hypot(fields.u[index], fields.v[index], fields.w[index]);
        if (speed < Math.max(0.02, result.stats.maxSpeed * 0.16)) continue;
        candidates.push({
          speed,
          position: new THREE.Vector3((i + 0.5) * grid.dx, (j + 0.5) * grid.dy, (k + 0.5) * grid.dz),
          direction: new THREE.Vector3(fields.u[index], fields.v[index], fields.w[index]).normalize(),
        });
      }
    }
  }
  candidates.sort((a, b) => b.speed - a.speed);
  for (const candidate of candidates) {
    if (emitters.every((emitter) => emitter.position.distanceTo(candidate.position) > 0.55)) {
      emitters.push(makeEmitter(candidate.position, candidate.direction, new THREE.Vector3(1, 0, 0), 0.13, 'flow', candidate.speed * grid.dx * grid.dz));
      if (emitters.length === 5) break;
    }
  }
  return emitters;
}

const MAX_GAS_VOXELS = 125_000;
const GAS_STEP = 1 / 30;
const GAS_DIFFUSIVITY = 0.012;
const GAS_TRACER_DECAY_RATE = 0.08;
const WINDOW_WALLS = Object.freeze({
  front: { axis: 'z', along: 'x', boundary: (room) => 0, normal: new THREE.Vector3(0, 0, -1), side: 16 },
  back: { axis: 'z', along: 'x', boundary: (room) => room.depth, normal: new THREE.Vector3(0, 0, 1), side: 32 },
  left: { axis: 'x', along: 'z', boundary: (room) => 0, normal: new THREE.Vector3(-1, 0, 0), side: 1 },
  right: { axis: 'x', along: 'z', boundary: (room) => room.width, normal: new THREE.Vector3(1, 0, 0), side: 2 },
});

function windowCorridor(x, y, z, roomScene, margin, spread) {
  if (!roomScene) return null;
  const { room } = roomScene;
  for (const window of roomScene.objects) {
    if (!isOpeningObject(window) || !window.open) continue;
    const wall = WINDOW_WALLS[window.wall];
    if (!wall) continue;
    const boundary = wall.boundary(room);
    const distance = (wall.axis === 'x' ? x : z) - boundary;
    const outwardDistance = distance * wall.normal[wall.axis];
    const along = wall.along === 'x' ? x : z;
    const windowAlong = window.position[wall.along];
    if (outwardDistance < -1e-6 || outwardDistance > margin
      || Math.abs(along - windowAlong) > window.dimensions.width / 2 + spread
      || y < window.position.y - spread
      || y > window.position.y + window.dimensions.height + spread) continue;
    return { window, wall, boundary, outwardDistance };
  }
  return null;
}

function sampleExteriorVelocity(x, y, z, result, roomScene, margin, target) {
  const corridor = windowCorridor(x, y, z, roomScene, margin, 0.18);
  if (!corridor) return target.set(0, 0, 0);
  const { window, wall, boundary } = corridor;
  const interior = target.clone().set(x, y, z);
  interior[wall.axis] = boundary;
  interior.addScaledVector(wall.normal, -Math.min(result.grid.dx, result.grid.dy, result.grid.dz) * 0.25);
  const i = clamp(Math.floor(interior.x / result.grid.dx), 0, result.grid.nx - 1);
  const j = clamp(Math.floor(interior.y / result.grid.dy), 0, result.grid.ny - 1);
  const k = clamp(Math.floor(interior.z / result.grid.dz), 0, result.grid.nz - 1);
  const index = indexOf(i, j, k, result.grid);
  if (!(result.fields.outlets?.[index] & wall.side)) return target.set(0, 0, 0);
  const outwardSpeed = (result.fields.windowFlow?.[index] ?? 0) * wall.normal[wall.axis];
  sampleVelocity(result, interior, target);
  target.addScaledVector(wall.normal, outwardSpeed - target.dot(wall.normal));
  return target;
}

function sampleGasDensity(density, x, y, z, volume) {
  const { grid, margin, blocked } = volume;
  if (x < -margin || x > grid.width - margin
    || y < 0 || y > grid.height
    || z < -margin || z > grid.depth - margin) return 0;
  const gx = clamp((x + margin) / grid.dx - 0.5, 0, grid.nx - 1);
  const gy = clamp(y / grid.dy - 0.5, 0, grid.ny - 1);
  const gz = clamp((z + margin) / grid.dz - 0.5, 0, grid.nz - 1);
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const z0 = Math.floor(gz);
  const tx = gx - x0;
  const ty = gy - y0;
  const tz = gz - z0;
  let value = 0;
  let totalWeight = 0;
  for (let oy = 0; oy <= 1; oy += 1) {
    for (let oz = 0; oz <= 1; oz += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const i = Math.min(x0 + ox, grid.nx - 1);
        const j = Math.min(y0 + oy, grid.ny - 1);
        const k = Math.min(z0 + oz, grid.nz - 1);
        const weight = (ox ? tx : 1 - tx) * (oy ? ty : 1 - ty) * (oz ? tz : 1 - tz);
        const id = indexOf(i, j, k, grid);
        if (blocked[id]) continue;
        value += density[id] * weight;
        totalWeight += weight;
      }
    }
  }
  return totalWeight > 1e-8 ? value / totalWeight : 0;
}

function addGasSources(volume, emitters) {
  const { grid, margin, blocked, sourceRate } = volume;
  const sourceWeight = new Float32Array(sourceRate.length);
  const ids = [];
  const weights = [];
  for (const emitter of emitters) {
    if (emitter.weight <= 0) continue;
    ids.length = 0;
    weights.length = 0;
    let totalWeight = 0;
    const extent = Math.max(emitter.radius * 1.8, grid.dx * 1.5);
    const minI = clamp(Math.floor((emitter.position.x + margin - extent) / grid.dx), 0, grid.nx - 1);
    const maxI = clamp(Math.ceil((emitter.position.x + margin + extent) / grid.dx), 0, grid.nx - 1);
    const minJ = clamp(Math.floor((emitter.position.y - extent) / grid.dy), 0, grid.ny - 1);
    const maxJ = clamp(Math.ceil((emitter.position.y + extent) / grid.dy), 0, grid.ny - 1);
    const minK = clamp(Math.floor((emitter.position.z + margin - extent) / grid.dz), 0, grid.nz - 1);
    const maxK = clamp(Math.ceil((emitter.position.z + margin + extent) / grid.dz), 0, grid.nz - 1);
    const sigma = Math.max(emitter.radius * 0.68, Math.min(grid.dx, grid.dy, grid.dz) * 0.55);
    const axialSigma = Math.min(grid.dx, grid.dy, grid.dz) * 0.62;
    for (let j = minJ; j <= maxJ; j += 1) {
      for (let k = minK; k <= maxK; k += 1) {
        for (let i = minI; i <= maxI; i += 1) {
          const id = indexOf(i, j, k, grid);
          if (blocked[id]) continue;
          const x = (i + 0.5) * grid.dx - margin - emitter.position.x;
          const y = (j + 0.5) * grid.dy - emitter.position.y;
          const z = (k + 0.5) * grid.dz - margin - emitter.position.z;
          const axial = x * emitter.direction.x + y * emitter.direction.y + z * emitter.direction.z;
          if (Math.abs(axial) > axialSigma * 1.8) continue;
          const radialX = x * emitter.axis.x + y * emitter.axis.y + z * emitter.axis.z;
          const radialY = x * emitter.sideAxis.x + y * emitter.sideAxis.y + z * emitter.sideAxis.z;
          const weight = Math.exp(-0.5 * ((radialX ** 2 + radialY ** 2) / sigma ** 2 + axial ** 2 / axialSigma ** 2));
          if (weight < 0.01) continue;
          ids.push(id);
          weights.push(weight);
          totalWeight += weight;
        }
      }
    }
    const voxelVolume = grid.dx * grid.dy * grid.dz;
    for (let index = 0; index < ids.length; index += 1) {
      sourceWeight[ids[index]] += emitter.weight * weights[index] / Math.max(totalWeight, 1e-8) / voxelVolume;
    }
  }
  sourceRate.set(sourceWeight);
}

function createGasVolume(result, roomScene, emitters, margin = 0.8) {
  const { grid: roomGrid, fields } = result;
  const displaySpeedRange = airflowDisplayRange(result);
  const requestedCellSize = Math.max(0.1, Math.min(0.15, Math.max(roomGrid.dx, roomGrid.dy, roomGrid.dz) * 2));
  const dimensions = { width: roomGrid.width + margin * 2, height: roomGrid.height, depth: roomGrid.depth + margin * 2 };
  let cellSize = requestedCellSize;
  let grid;
  let voxelCount;
  do {
    grid = {
      ...dimensions,
      nx: Math.ceil(dimensions.width / cellSize),
      ny: Math.ceil(dimensions.height / cellSize),
      nz: Math.ceil(dimensions.depth / cellSize),
    };
    voxelCount = grid.nx * grid.ny * grid.nz;
    if (voxelCount > MAX_GAS_VOXELS) cellSize *= Math.cbrt(voxelCount / MAX_GAS_VOXELS) * 1.001;
  } while (voxelCount > MAX_GAS_VOXELS);
  grid.dx = dimensions.width / grid.nx;
  grid.dy = dimensions.height / grid.ny;
  grid.dz = dimensions.depth / grid.nz;
  grid.cellSize = Math.max(grid.dx, grid.dy, grid.dz);
  grid.requestedCellSize = requestedCellSize;
  const density = new Float32Array(voxelCount);
  const nextDensity = new Float32Array(voxelCount);
  const sourceRate = new Float32Array(voxelCount);
  const blocked = new Uint8Array(voxelCount);
  const velocityX = new Float32Array(voxelCount);
  const velocityY = new Float32Array(voxelCount);
  const velocityZ = new Float32Array(voxelCount);
  const data = new Uint8Array(voxelCount * 4);
  const sample = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const id = indexOf(i, j, k, grid);
        const x = (i + 0.5) * grid.dx - margin;
        const y = (j + 0.5) * grid.dy;
        const z = (k + 0.5) * grid.dz - margin;
        if (x >= 0 && x <= roomGrid.width && y >= 0 && y <= roomGrid.height && z >= 0 && z <= roomGrid.depth) {
          const roomI = clamp(Math.floor(x / roomGrid.dx), 0, roomGrid.nx - 1);
          const roomJ = clamp(Math.floor(y / roomGrid.dy), 0, roomGrid.ny - 1);
          const roomK = clamp(Math.floor(z / roomGrid.dz), 0, roomGrid.nz - 1);
          const roomId = indexOf(roomI, roomJ, roomK, roomGrid);
          blocked[id] = fields.solid[roomId];
          if (blocked[id]) continue;
          position.set(x, y, z);
          sampleVelocity(result, position, sample);
        } else {
          if (!windowCorridor(x, y, z, roomScene, margin, 0.18)) {
            blocked[id] = 1;
            continue;
          }
          sampleExteriorVelocity(x, y, z, result, roomScene, margin, sample);
        }
        velocityX[id] = sample.x;
        velocityY[id] = sample.y;
        velocityZ[id] = sample.z;
      }
    }
  }
  addGasSources({ grid, margin, blocked, sourceRate }, emitters);

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

  const volumeSize = new THREE.Vector3(dimensions.width, dimensions.height, dimensions.depth);
  const stepLength = Math.max(Math.min(grid.dx, grid.dy, grid.dz) * 0.7,
    Math.hypot(dimensions.width, dimensions.height, dimensions.depth) / 176);
  const vertexShader = [
    'varying vec3 vLocalPosition;',
    'varying vec3 vRayOrigin;',
    'void main() {',
    '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
    '  vLocalPosition = position;',
    '  vRayOrigin = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * worldPosition;',
    '}',
  ].join('\n');
  const fragmentShader = [
    'precision highp sampler3D;',
    'uniform sampler3D uGas;',
    'uniform vec3 uVolumeSize;',
    'uniform vec3 uVoxelSize;',
    'uniform float uStepLength;',
    'varying vec3 vLocalPosition;',
    'varying vec3 vRayOrigin;',
    'out vec4 fragColor;',
    'void main() {',
    '  vec3 halfSize = uVolumeSize * 0.5;',
    '  vec3 direction = vLocalPosition - vRayOrigin;',
    '  float rayLength = length(direction);',
    '  if (rayLength < 1e-6) discard;',
    '  direction /= rayLength;',
    '  bool cameraInside = all(lessThan(abs(vRayOrigin), halfSize));',
    '  if (gl_FrontFacing == cameraInside) discard;',
    '  vec3 inverseDirection = 1.0 / direction;',
    '  vec3 near = (-halfSize - vRayOrigin) * inverseDirection;',
    '  vec3 far = (halfSize - vRayOrigin) * inverseDirection;',
    '  vec3 entry = min(near, far);',
    '  vec3 exit = max(near, far);',
    '  float startDistance = max(max(entry.x, entry.y), entry.z);',
    '  float endDistance = min(min(exit.x, exit.y), exit.z);',
    '  startDistance = max(startDistance, 0.0);',
    '  if (endDistance <= startDistance) discard;',
    '  int stepCount = min(192, int(ceil((endDistance - startDistance) / uStepLength)));',
    '  vec4 accumulated = vec4(0.0);',
    '  for (int index = 0; index < 192; index++) {',
    '    if (index >= stepCount) break;',
    '    float distance = startDistance + (float(index) + 0.5) * uStepLength;',
    '    vec3 point = vRayOrigin + direction * distance;',
    '    vec3 coordinate = point / uVolumeSize + 0.5;',
    '    vec4 gas = texture(uGas, vec3(coordinate.x, coordinate.z, coordinate.y));',
    '    float moving = smoothstep(0.01, 0.035, gas.g);',
    '    float density = 0.55 * smoothstep(0.01, 0.1, gas.r) * moving * (1.0 - step(0.5, gas.b));',
    '    float alpha = 1.0 - exp(-density * 1.6 * uStepLength);',
    '    float contribution = (1.0 - accumulated.a) * alpha;',
    '    float speed = clamp(gas.g, 0.0, 1.0);',
    '    vec3 densityGradient = vec3(',
    '      texture(uGas, coordinate + vec3(uVoxelSize.x, 0.0, 0.0)).r - texture(uGas, coordinate - vec3(uVoxelSize.x, 0.0, 0.0)).r,',
    '      texture(uGas, coordinate + vec3(0.0, uVoxelSize.y, 0.0)).r - texture(uGas, coordinate - vec3(0.0, uVoxelSize.y, 0.0)).r,',
    '      texture(uGas, coordinate + vec3(0.0, 0.0, uVoxelSize.z)).r - texture(uGas, coordinate - vec3(0.0, 0.0, uVoxelSize.z)).r);',
    '    vec3 normal = normalize(-densityGradient + vec3(1e-4));',
    '    float lighting = 0.62 + 0.38 * max(dot(normal, normalize(vec3(-0.4, 0.8, 0.55))), 0.0);',
    '    vec3 blue = vec3(0.03, 0.28, 0.82);',
    '    vec3 cyan = vec3(0.0, 0.86, 1.0);',
    '    vec3 green = vec3(0.14, 0.93, 0.48);',
    '    vec3 yellow = vec3(1.0, 0.84, 0.0);',
    '    vec3 red = vec3(1.0, 0.1, 0.08);',
    '    vec3 flowColor = speed < 0.2 ? mix(vec3(0.07, 0.13, 0.28), blue, speed / 0.2)',
    '      : speed < 0.4 ? mix(blue, cyan, (speed - 0.2) / 0.2)',
    '      : speed < 0.6 ? mix(cyan, green, (speed - 0.4) / 0.2)',
    '      : speed < 0.8 ? mix(green, yellow, (speed - 0.6) / 0.2)',
    '      : mix(yellow, red, (speed - 0.8) / 0.2);',
    '    accumulated.rgb += flowColor * lighting * contribution;',
    '    accumulated.a += contribution;',
    '    if (accumulated.a > 0.9) break;',
    '  }',
    '  if (accumulated.a < 0.008) discard;',
    '  fragColor = linearToOutputTexel(vec4(accumulated.rgb, accumulated.a));',
    '}',
  ].join('\n');
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(dimensions.width, dimensions.height, dimensions.depth), new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uGas: { value: texture },
      uVolumeSize: { value: volumeSize },
      uVoxelSize: { value: new THREE.Vector3(1 / grid.nx, 1 / grid.nz, 1 / grid.ny) },
      uStepLength: { value: stepLength },
    },
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader,
    fragmentShader,
  }));
  mesh.position.y = roomGrid.height / 2;
  mesh.name = 'advected-room-gas-volume';
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;
  mesh.userData.voxelCount = voxelCount;
  mesh.userData.voxelSize = grid.cellSize;
  mesh.userData.boundsCenter = new THREE.Vector3(0, roomGrid.height / 2, 0);
  mesh.userData.boundsHalfSize = new THREE.Vector3(dimensions.width / 2, dimensions.height / 2, dimensions.depth / 2);
  const layer = new THREE.Group();
  layer.name = 'advected-room-gas';
  layer.add(mesh);
  return {
    layer, grid, margin, density, nextDensity, sourceRate, blocked,
    velocityX, velocityY, velocityZ, data, texture, voxelCount, stepLength,
    backtrace: new THREE.Vector3(), displaySpeedRange,
  };
}

function advanceGasVolume(volume, dt) {
  const { grid, margin, density, nextDensity, sourceRate, blocked, velocityX, velocityY, velocityZ, backtrace } = volume;
  const ix = GAS_DIFFUSIVITY * dt / grid.dx ** 2;
  const iy = GAS_DIFFUSIVITY * dt / grid.dy ** 2;
  const iz = GAS_DIFFUSIVITY * dt / grid.dz ** 2;
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const id = indexOf(i, j, k, grid);
        if (blocked[id]) {
          nextDensity[id] = 0;
          continue;
        }
        const x = (i + 0.5) * grid.dx - margin;
        const y = (j + 0.5) * grid.dy;
        const z = (k + 0.5) * grid.dz - margin;
        clipGasBacktrace(
          volume,
          x, y, z,
          x - velocityX[id] * dt,
          y - velocityY[id] * dt,
          z - velocityZ[id] * dt,
          backtrace,
        );
        const advected = sampleGasDensity(density, backtrace.x, backtrace.y, backtrace.z, volume);
        const center = density[id];
        const left = i > 0 && !blocked[id - 1] ? density[id - 1] : center;
        const right = i + 1 < grid.nx && !blocked[id + 1] ? density[id + 1] : center;
        const down = j > 0 && !blocked[id - grid.nz * grid.nx] ? density[id - grid.nz * grid.nx] : center;
        const up = j + 1 < grid.ny && !blocked[id + grid.nz * grid.nx] ? density[id + grid.nz * grid.nx] : center;
        const front = k > 0 && !blocked[id - grid.nx] ? density[id - grid.nx] : center;
        const back = k + 1 < grid.nz && !blocked[id + grid.nx] ? density[id + grid.nx] : center;
        const laplacian = (left - 2 * center + right) * ix
          + (down - 2 * center + up) * iy
          + (front - 2 * center + back) * iz;
        nextDensity[id] = Math.max(0, advected + laplacian + sourceRate[id] * dt)
          * Math.exp(-GAS_TRACER_DECAY_RATE * dt);
      }
    }
  }
  volume.density.set(nextDensity);
}

function updateGasTexture(volume) {
  const { grid, margin, density, blocked, data, texture, velocityX, velocityY, velocityZ, roomGrid, displaySpeedRange } = volume;
  let maxDensity = 0;
  let occupiedVoxels = 0;
  let tracerVolumeM3 = 0;
  let exteriorTracerVolumeM3 = 0;
  const voxelVolume = grid.dx * grid.dy * grid.dz;
  for (let id = 0; id < density.length; id += 1) {
    const concentration = clamp(1 - Math.exp(-density[id]), 0, 1);
    data[id * 4] = Math.round(concentration * 255);
    data[id * 4 + 1] = Math.round(clamp(Math.hypot(velocityX[id], velocityY[id], velocityZ[id]) / displaySpeedRange, 0, 1) * 255);
    data[id * 4 + 2] = blocked[id] ? 255 : 0;
    data[id * 4 + 3] = 255;
    maxDensity = Math.max(maxDensity, concentration);
    tracerVolumeM3 += density[id] * voxelVolume;
    if (concentration > 0.025) occupiedVoxels += 1;
    if (roomGrid) {
      const i = id % grid.nx;
      const k = Math.floor(id / grid.nx) % grid.nz;
      const x = (i + 0.5) * grid.dx - margin;
      const z = (k + 0.5) * grid.dz - margin;
      if (x < 0 || x > roomGrid.width || z < 0 || z > roomGrid.depth) {
        exteriorTracerVolumeM3 += density[id] * voxelVolume;
      }
    }
  }
  texture.needsUpdate = true;
  return { maxDensity, occupiedVoxels, tracerVolumeM3, exteriorTracerVolumeM3 };
}

function createGasLayer(result, roomScene) {
  const emitters = getAirEmitters(result, roomScene);
  const volume = createGasVolume(result, roomScene, emitters);
  volume.roomGrid = result.grid;
  volume.roomSolid = result.fields.solid;
  const { layer } = volume;
  for (let step = 0; step < 15; step += 1) advanceGasVolume(volume, GAS_STEP);
  Object.assign(layer.userData, updateGasTexture(volume));
  const sourceCounts = Object.fromEntries(emitters.map((emitter) => [emitter.kind, 0]));
  for (const emitter of emitters) sourceCounts[emitter.kind] += 1;
  layer.userData.gasVoxelCount = volume.voxelCount;
  layer.userData.gasSourceCounts = sourceCounts;
  layer.userData.maxDensity = 0;
  layer.userData.occupiedVoxels = 0;
  layer.userData.tracerVolumeM3 = 0;
  layer.userData.exteriorTracerVolumeM3 = 0;
  let lastTime = null;
  let accumulator = GAS_STEP;
  const update = (time) => {
    if (lastTime !== null) accumulator += clamp(time - lastTime, 0, 0.05);
    lastTime = time;
    let changed = false;
    while (accumulator >= GAS_STEP) {
      advanceGasVolume(volume, GAS_STEP);
      accumulator -= GAS_STEP;
      changed = true;
    }
    if (changed) Object.assign(layer.userData, updateGasTexture(volume));
  };
  return { layer, update, voxelCount: volume.voxelCount, sourceCounts };
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
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
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
    const thermalContrast = clamp(Math.abs(temperature - result.ambientTemperature) / 2, 0, 1);
    colors[index * 4 + 3] = insideOpening ? 0
      : (horizontal ? 0.24 : 0.16) + thermalContrast * 0.36;
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
    depthWrite: false,
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
        const contrast = clamp(Math.abs(temperature - result.ambientTemperature) / 2, 0, 1);
        colors[vertex * 4 + 3] = 0.22 + contrast * 0.48;
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

export function createAirflowLayers(result, roomScene) {
  const gas = createGasLayer(result, roomScene);
  gas.update(0);
  return { volume: gas.layer, update: gas.update, gasVoxelCount: gas.voxelCount, sourceCounts: gas.sourceCounts };
}
