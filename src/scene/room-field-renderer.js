import * as THREE from 'three';
import { rotationMatrixXYZ } from '../model/room-scene.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const indexOf = (i, j, k, grid) => (j * grid.nz + k) * grid.nx + i;
const AIRFLOW_DISPLAY_RANGE = 1.2;

function temperatureRange(ambient, outdoor = ambient) {
  return { minimum: Math.min(ambient - 4, outdoor), maximum: Math.max(ambient + 8, outdoor) };
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
  if (mode === 'airflow') return clamp(value / AIRFLOW_DISPLAY_RANGE, 0, 1);
  if (mode === 'temperature') {
    const range = temperatureRange(result.ambientTemperature, result.outdoorTemperature);
    return clamp((value - range.minimum) / Math.max(0.05, range.maximum - range.minimum), 0, 1);
  }
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
      data[index * 4 + 2] = Math.round(clamp(Math.abs(value - result.ambientTemperature) / 8, 0, 1) * 255);
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
      uOpacity: { value: mode === 'airflow' ? 1.8 : mode === 'temperature' ? 1.1 : 2.1 },
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
          vec3 cold = vec3(0.094, 0.043, 0.247);
          vec3 blue = vec3(0.149, 0.231, 0.71);
          vec3 cyan = vec3(0.031, 0.659, 0.847);
          vec3 green = vec3(0.212, 0.843, 0.639);
          vec3 yellow = vec3(0.941, 0.843, 0.22);
          vec3 red = vec3(0.91, 0.29, 0.157);
          if (value < 0.2) return mix(cold, blue, value / 0.2);
          if (value < 0.4) return mix(blue, cyan, (value - 0.2) / 0.2);
          if (value < 0.58) return mix(cyan, green, (value - 0.4) / 0.18);
          if (value < 0.73) return mix(green, yellow, (value - 0.58) / 0.15);
          if (value < 0.88) return mix(yellow, red, (value - 0.73) / 0.15);
          return mix(red, vec3(1.0, 0.949, 0.835), (value - 0.88) / 0.12);
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
          float density = smoothstep(0.006, 0.28, field.r);
          if (uFieldMode == 1) { density = 0.24 * smoothstep(0.025, 0.58, field.b); }
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
      getAirflowColor(speed, AIRFLOW_DISPLAY_RANGE).toArray(colors, index * 4);
    } else {
      const temperature = sampleField(fields.temperature, x, height, z, grid, fields.solid, result.ambientTemperature);
      infraredColor(temperature, result.ambientTemperature, color, result.outdoorTemperature).toArray(colors, index * 4);
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

function insideRoom(point, grid) {
  return point.x >= 0 && point.x <= grid.width
    && point.y >= 0 && point.y <= grid.height
    && point.z >= 0 && point.z <= grid.depth;
}

function isFluidPoint(point, grid, solid) {
  if (!insideRoom(point, grid)) return false;
  const i = Math.min(grid.nx - 1, Math.floor(point.x / grid.dx));
  const j = Math.min(grid.ny - 1, Math.floor(point.y / grid.dy));
  const k = Math.min(grid.nz - 1, Math.floor(point.z / grid.dz));
  return !solid[indexOf(i, j, k, grid)];
}

function makeEmitter(position, direction, axis, radius, kind = 'flow') {
  const normal = direction.clone().normalize();
  const spanAxis = axis.clone().addScaledVector(normal, -axis.dot(normal));
  if (spanAxis.lengthSq() < 1e-6) {
    spanAxis.set(0, 0, 1).addScaledVector(normal, -normal.z);
  }
  spanAxis.normalize();
  const sideAxis = new THREE.Vector3().crossVectors(normal, spanAxis).normalize();
  return { position, direction: normal, axis: spanAxis, sideAxis, radius, kind };
}

function findWindowExit(start, end, roomScene, result, targetVelocity) {
  if (!roomScene) return null;
  const { grid } = result;
  const walls = {
    front: { axis: 'z', boundary: 0, along: 'x', normal: new THREE.Vector3(0, 0, -1) },
    back: { axis: 'z', boundary: roomScene.room.depth, along: 'x', normal: new THREE.Vector3(0, 0, 1) },
    left: { axis: 'x', boundary: 0, along: 'z', normal: new THREE.Vector3(-1, 0, 0) },
    right: { axis: 'x', boundary: roomScene.room.width, along: 'z', normal: new THREE.Vector3(1, 0, 0) },
  };
  for (const window of roomScene?.objects ?? []) {
    if (window.model !== 'window' || !window.open) continue;
    const wall = walls[window.wall];
    const delta = end[wall.axis] - start[wall.axis];
    if (Math.abs(delta) < 1e-8) continue;
    const fraction = (wall.boundary - start[wall.axis]) / delta;
    if (fraction <= 0 || fraction > 1) continue;
    const point = start.clone().lerp(end, fraction);
    if (point.y < window.position.y || point.y > window.position.y + window.dimensions.height
      || Math.abs(point[wall.along] - window.position[wall.along]) > window.dimensions.width / 2) continue;

    const interiorPoint = point.clone().addScaledVector(wall.normal, -Math.min(grid.dx, grid.dy, grid.dz) * 0.25);
    sampleVelocity(result, interiorPoint, targetVelocity);
    const outwardSpeed = targetVelocity.dot(wall.normal);
    if (outwardSpeed <= 0.02) continue;
    return { point, velocity: targetVelocity.clone() };
  }
  return null;
}

function getAirEmitters(result, roomScene) {
  const emitters = [];
  for (const fan of roomScene?.objects ?? []) {
    if (fan.model !== 'fan' || fan.enabled === false || (fan.intensity ?? 1) <= 0) continue;
    const matrix = rotationMatrixXYZ(fan.rotation);
    const local = { x: 0, y: fan.dimensions.height * 0.24, z: fan.dimensions.depth * 0.1 };
    const position = new THREE.Vector3(
      fan.position.x + matrix[0][0] * local.x + matrix[0][1] * local.y + matrix[0][2] * local.z,
      fan.position.y + fan.dimensions.height / 2 + matrix[1][0] * local.x + matrix[1][1] * local.y + matrix[1][2] * local.z,
      fan.position.z + matrix[2][0] * local.x + matrix[2][1] * local.y + matrix[2][2] * local.z,
    );
    emitters.push(makeEmitter(
      position,
      new THREE.Vector3(matrix[0][2], matrix[1][2], matrix[2][2]),
      new THREE.Vector3(matrix[0][0], matrix[1][0], matrix[2][0]),
      Math.max(0.06, fan.dimensions.width * 0.32),
      'fan',
    ));
  }

  for (const heater of roomScene?.objects ?? []) {
    if (heater.model !== 'heater' || (heater.intensity ?? 1) <= 0) continue;
    const topCell = Math.min(result.grid.ny - 1, Math.ceil((heater.position.y + heater.dimensions.height) / result.grid.dy));
    const position = new THREE.Vector3(
      heater.position.x,
      Math.min(result.grid.height - result.grid.dy * 0.5, (topCell + 0.5) * result.grid.dy),
      heater.position.z,
    );
    if (!isFluidPoint(position, result.grid, result.fields.solid)) continue;
    emitters.push(makeEmitter(
      position,
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
      Math.max(heater.dimensions.width, heater.dimensions.depth) * 0.46,
      'heater',
    ));
  }

  for (const window of roomScene?.objects ?? []) {
    if (window.model !== 'window' || !window.open || (window.flowRate ?? 0.35) <= 0) continue;
    const alongX = window.wall === 'back' || window.wall === 'front';
    const flowDirection = window.flowDirection ?? 'exchange';
    const outdoorAirIsWarmer = (roomScene.room.outdoorTemperature ?? result.outdoorTemperature ?? result.ambientTemperature)
      > result.ambientTemperature;
    const inletFraction = outdoorAirIsWarmer ? 0.75 : 0.25;
    const outward = {
      front: new THREE.Vector3(0, 0, -1),
      back: new THREE.Vector3(0, 0, 1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
    }[window.wall];
    const axis = alongX ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
    const addWindowEmitter = (fraction, direction) => emitters.push(makeEmitter(
      new THREE.Vector3(window.position.x, window.position.y + window.dimensions.height * fraction, window.position.z),
      direction,
      axis,
      Math.max(0.08, window.dimensions.width * 0.36),
      'window',
    ));
    if (flowDirection !== 'outlet') addWindowEmitter(inletFraction, outward.clone().negate());
    if (flowDirection !== 'inlet') addWindowEmitter(1 - inletFraction, outward);
  }

  if (emitters.length) return emitters;
  const { grid, fields } = result;
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
      emitters.push(makeEmitter(candidate.position, candidate.direction, new THREE.Vector3(1, 0, 0), 0.13));
      if (emitters.length === 5) break;
    }
  }
  return emitters;
}

function createGasLayer(result, roomScene) {
  const { grid, fields } = result;
  const emitters = getAirEmitters(result, roomScene);
  const particleCount = Math.min(1320, emitters.length * 220);
  const trailCount = 11;
  const pointCount = particleCount * trailCount;
  const positions = new Float32Array(pointCount * 3);
  const tangentValues = new Float32Array(pointCount * 3);
  const lifeValues = new Float32Array(pointCount);
  const speedValues = new Float32Array(pointCount);
  const trailValues = new Float32Array(pointCount);
  const current = new Float32Array(particleCount * 3);
  const ages = new Float32Array(particleCount);
  const lifetimes = new Float32Array(particleCount);
  const exitAges = new Float32Array(particleCount).fill(-1);
  const exitVelocities = new Float32Array(particleCount * 3);
  const history = new Float32Array(pointCount * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aTangent', new THREE.BufferAttribute(tangentValues, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aLife', new THREE.BufferAttribute(lifeValues, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speedValues, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('aTrail', new THREE.BufferAttribute(trailValues, 1));
  for (let particle = 0; particle < particleCount; particle += 1) {
    for (let trail = 0; trail < trailCount; trail += 1) trailValues[particle * trailCount + trail] = 1 - trail / trailCount;
  }
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    uniforms: { uSize: { value: 112 } },
    vertexShader: `
      uniform float uSize;
      attribute float aLife;
      attribute float aSpeed;
      attribute float aTrail;
      attribute vec3 aTangent;
      varying float vLife;
      varying float vSpeed;
      varying float vTrail;
      varying vec2 vTangent;
      void main() {
        vLife = aLife;
        vSpeed = aSpeed;
        vTrail = aTrail;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vec3 viewTangent = (modelViewMatrix * vec4(aTangent, 0.0)).xyz;
        vTangent = length(viewTangent.xy) > 0.0001 ? normalize(viewTangent.xy) : vec2(1.0, 0.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(uSize * (0.7 + aSpeed * 0.45) / max(1.0, -viewPosition.z), 2.0, 18.0);
      }
    `,
    fragmentShader: `
      varying float vLife;
      varying float vSpeed;
      varying float vTrail;
      varying vec2 vTangent;
      void main() {
        vec2 tangent = normalize(vTangent);
        vec2 normal = vec2(-tangent.y, tangent.x);
        vec2 point = gl_PointCoord - vec2(0.5);
        float along = dot(point, tangent);
        float across = dot(point, normal);
        float vapor = exp(-along * along * 12.0 - across * across * 170.0);
        float haze = exp(-along * along * 4.0 - across * across * 48.0);
        float alpha = (vapor * 0.7 + haze * 0.2) * vLife * (0.05 + vTrail * 0.11);
        if (alpha < 0.006) discard;
        vec3 slow = vec3(0.12, 0.52, 0.78);
        vec3 fast = vec3(0.46, 0.91, 1.0);
        vec3 gas = mix(slow, fast, clamp(vSpeed, 0.0, 1.0));
        gl_FragColor = vec4(gas, alpha);
      }
    `,
  });
  const layer = new THREE.Points(geometry, material);
  layer.name = 'advected-room-gas';
  layer.renderOrder = 2;
  layer.frustumCulled = false;

  const position = new THREE.Vector3();
  const midpoint = new THREE.Vector3();
  const next = new THREE.Vector3();
  const contact = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const middleVelocity = new THREE.Vector3();
  const trailInterval = 0.04;
  const pushHistory = (index) => {
    const firstHistory = index * trailCount * 3;
    history.copyWithin(firstHistory + 3, firstHistory, firstHistory + (trailCount - 1) * 3);
    const offset = index * 3;
    history[firstHistory] = current[offset];
    history[firstHistory + 1] = current[offset + 1];
    history[firstHistory + 2] = current[offset + 2];
  };
  const moveParticle = (index, dt) => {
    const offset = index * 3;
    if (exitAges[index] >= 0) {
      current[offset] += exitVelocities[offset] * dt;
      current[offset + 1] += exitVelocities[offset + 1] * dt;
      current[offset + 2] += exitVelocities[offset + 2] * dt;
      return Math.hypot(exitVelocities[offset], exitVelocities[offset + 1], exitVelocities[offset + 2]);
    }

    position.set(current[offset], current[offset + 1], current[offset + 2]);
    sampleVelocity(result, position, velocity);
    const speed = velocity.length();
    midpoint.copy(position).addScaledVector(velocity, dt * 0.5);
    sampleVelocity(result, midpoint, middleVelocity);
    next.copy(position).addScaledVector(middleVelocity, dt);
    if (isFluidPoint(next, grid, fields.solid)) {
      current[offset] = next.x;
      current[offset + 1] = next.y;
      current[offset + 2] = next.z;
      return speed;
    }

    if (!insideRoom(next, grid)) {
      const exit = findWindowExit(position, next, roomScene, result, velocity);
      if (exit) {
        current[offset] = exit.point.x;
        current[offset + 1] = exit.point.y;
        current[offset + 2] = exit.point.z;
        const exitSpeed = Math.min(1.5, exit.velocity.length());
        const scale = exitSpeed / Math.max(1e-6, exit.velocity.length());
        exitVelocities[offset] = exit.velocity.x * scale;
        exitVelocities[offset + 1] = exit.velocity.y * scale;
        exitVelocities[offset + 2] = exit.velocity.z * scale;
        exitAges[index] = ages[index];
      } else {
        lifetimes[index] = Math.min(lifetimes[index], ages[index] + 0.3);
      }
      return speed;
    }

    let low = 0;
    let high = 1;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const fraction = (low + high) * 0.5;
      contact.copy(position).lerp(next, fraction);
      if (isFluidPoint(contact, grid, fields.solid)) low = fraction;
      else high = fraction;
    }
    contact.copy(position).lerp(next, Math.max(0, low - 0.02));
    const i = clamp(Math.floor(next.x / grid.dx), 0, grid.nx - 1);
    const j = clamp(Math.floor(next.y / grid.dy), 0, grid.ny - 1);
    const k = clamp(Math.floor(next.z / grid.dz), 0, grid.nz - 1);
    normal.set(
      (contact.x - (i + 0.5) * grid.dx) / grid.dx,
      (contact.y - (j + 0.5) * grid.dy) / grid.dy,
      (contact.z - (k + 0.5) * grid.dz) / grid.dz,
    );
    if (normal.lengthSq() < 1e-6) normal.set(-middleVelocity.x, -middleVelocity.y, -middleVelocity.z);
    normal.normalize();
    sampleVelocity(result, contact, middleVelocity);
    const intoSurface = middleVelocity.dot(normal);
    if (intoSurface < 0) middleVelocity.addScaledVector(normal, -intoSurface);
    if (middleVelocity.lengthSq() > 0.0004) {
      next.copy(contact).addScaledVector(middleVelocity, dt);
      if (isFluidPoint(next, grid, fields.solid)) contact.copy(next);
    } else {
      lifetimes[index] = Math.min(lifetimes[index], ages[index] + 0.3);
    }
    current[offset] = contact.x;
    current[offset + 1] = contact.y;
    current[offset + 2] = contact.z;
    return speed;
  };
  const respawn = (index, warmStart = false) => {
    const emitter = emitters[index % emitters.length];
    const offset = index * 3;
    const along = (Math.random() - 0.5) * emitter.radius;
    const side = (Math.random() - 0.5) * emitter.radius * 0.72;
    current[offset] = emitter.position.x + emitter.axis.x * along + emitter.sideAxis.x * side;
    current[offset + 1] = emitter.position.y + emitter.axis.y * along + emitter.sideAxis.y * side;
    current[offset + 2] = emitter.position.z + emitter.axis.z * along + emitter.sideAxis.z * side;
    ages[index] = 0;
    lifetimes[index] = 5 + Math.random() * 4;
    exitAges[index] = -1;
    for (let trail = 0; trail < trailCount; trail += 1) {
      const pointOffset = (index * trailCount + trail) * 3;
      history[pointOffset] = current[offset];
      history[pointOffset + 1] = current[offset + 1];
      history[pointOffset + 2] = current[offset + 2];
    }
    if (!warmStart) return;
    const maxPhase = emitter.kind === 'window' ? 0.55 : 2.6;
    const phase = Math.random() * Math.min(maxPhase, lifetimes[index] * 0.6);
    let elapsed = 0;
    let historyClock = 0;
    while (elapsed < phase) {
      const step = Math.min(1 / 30, phase - elapsed);
      moveParticle(index, step);
      ages[index] += step;
      elapsed += step;
      historyClock += step;
      if (historyClock >= trailInterval) {
        pushHistory(index);
        historyClock -= trailInterval;
      }
      if (ages[index] >= lifetimes[index]) break;
    }
  };
  if (particleCount) for (let index = 0; index < particleCount; index += 1) respawn(index, true);
  let lastTime = null;
  let trailClock = 0;
  const update = (time) => {
    if (!particleCount) return;
    const dt = lastTime === null ? 1 / 60 : clamp(time - lastTime, 0, 0.05);
    lastTime = time;
    trailClock += dt;
    const captureTrail = trailClock >= trailInterval;
    if (captureTrail) trailClock -= trailInterval;
    const speedRange = Math.max(result.stats.maxSpeed, 0.25);

    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      if (ages[index] >= lifetimes[index]
        || (exitAges[index] >= 0 && ages[index] - exitAges[index] >= 0.8)) respawn(index);
      const speed = moveParticle(index, dt);
      ages[index] += dt;
      if (captureTrail) pushHistory(index);
      const life = smoothstep01(ages[index] / 0.22)
        * (1 - smoothstep01((ages[index] / lifetimes[index] - 0.78) / 0.22));
      const exitFade = exitAges[index] < 0 ? 1 : 1 - smoothstep01((ages[index] - exitAges[index]) / 0.75);
      for (let trail = 0; trail < trailCount; trail += 1) {
        const pointIndex = index * trailCount + trail;
        const pointOffset = pointIndex * 3;
        const sample = trail === 0 ? offset : (index * trailCount + trail - 1) * 3;
        positions[pointOffset] = (trail === 0 ? current[offset] : history[sample]) - grid.width / 2;
        positions[pointOffset + 1] = trail === 0 ? current[offset + 1] : history[sample + 1];
        positions[pointOffset + 2] = (trail === 0 ? current[offset + 2] : history[sample + 2]) - grid.depth / 2;
        const tangentFrom = trail < 2 ? offset : (index * trailCount + trail - 2) * 3;
        const tangentTo = (index * trailCount + trail) * 3;
        let tx = (trail < 2 ? current[tangentFrom] : history[tangentFrom]) - history[tangentTo];
        let ty = (trail < 2 ? current[tangentFrom + 1] : history[tangentFrom + 1]) - history[tangentTo + 1];
        let tz = (trail < 2 ? current[tangentFrom + 2] : history[tangentFrom + 2]) - history[tangentTo + 2];
        const tangentLength = Math.hypot(tx, ty, tz);
        if (tangentLength > 1e-6) {
          tx /= tangentLength;
          ty /= tangentLength;
          tz /= tangentLength;
        } else {
          tx = emitters[index % emitters.length].direction.x;
          ty = emitters[index % emitters.length].direction.y;
          tz = emitters[index % emitters.length].direction.z;
        }
        tangentValues[pointOffset] = tx;
        tangentValues[pointOffset + 1] = ty;
        tangentValues[pointOffset + 2] = tz;
        lifeValues[pointIndex] = life * exitFade * (1 - trail / (trailCount + 0.3));
        speedValues[pointIndex] = clamp(speed / speedRange, 0, 1);
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aTangent.needsUpdate = true;
    geometry.attributes.aLife.needsUpdate = true;
    geometry.attributes.aSpeed.needsUpdate = true;
    geometry.computeBoundingSphere();
  };
  return { layer, update, particleCount };
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

const INFRARED_STOPS = [
  [0, 0x180b3f],
  [0.2, 0x263bb5],
  [0.4, 0x08a8d8],
  [0.58, 0x36d7a3],
  [0.73, 0xf0d738],
  [0.88, 0xe84a28],
  [1, 0xfff2d5],
].map(([position, color]) => ({ position, color: new THREE.Color(color) }));

function infraredColor(value, ambient, target, outdoor = ambient) {
  const range = temperatureRange(ambient, outdoor);
  const normalized = clamp((value - range.minimum) / (range.maximum - range.minimum), 0, 1);
  const upperIndex = INFRARED_STOPS.findIndex((stop) => stop.position >= normalized);
  const upper = INFRARED_STOPS[Math.max(1, upperIndex)];
  const lower = INFRARED_STOPS[Math.max(0, upperIndex - 1)];
  return target.copy(lower.color).lerp(upper.color, (normalized - lower.position) / (upper.position - lower.position));
}

function createInfraredPlane(result, scene, wall) {
  const { grid } = result;
  const floor = wall === 'floor';
  const alongX = floor || wall === 'front' || wall === 'back';
  const span = alongX ? grid.width : grid.depth;
  const segmentsX = alongX ? grid.nx - 1 : grid.nz - 1;
  const segmentsY = floor ? grid.nz - 1 : grid.ny - 1;
  const geometry = new THREE.PlaneGeometry(span, floor ? grid.depth : grid.height, segmentsX, segmentsY);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }));
  mesh.name = `infrared-${wall}`;
  if (floor) {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.012;
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
  const openings = scene?.objects?.filter((object) => object.model === 'window' && object.wall === wall) ?? [];
  const positions = geometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    const x = point.x + grid.width / 2;
    const y = floor ? Math.max(0.04, grid.dy * 0.55) : point.y;
    const z = point.z + grid.depth / 2;
    const temperature = sampleField(result.fields.temperature, x, y, z, grid, result.fields.solid, result.ambientTemperature);
    infraredColor(temperature, result.ambientTemperature, color, result.outdoorTemperature).toArray(colors, index * 4);
    const along = wall === 'left' || wall === 'right' ? z : x;
    const insideOpening = openings.some((window) => {
      const center = wall === 'left' || wall === 'right' ? window.position.z : window.position.x;
      return Math.abs(along - center) <= window.dimensions.width / 2
        && point.y >= window.position.y && point.y <= window.position.y + window.dimensions.height;
    });
    colors[index * 4 + 3] = insideOpening ? 0 : floor ? 0.86 : 0.78;
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  mesh.renderOrder = 1;
  return mesh;
}

export function createTemperatureSurfaceLayer(result, roomScene) {
  const layer = new THREE.Group();
  layer.name = 'infrared-temperature-surfaces';
  for (const wall of ['floor', 'front', 'back', 'left', 'right']) {
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
      const colors = new Float32Array(vertices.count * 3);
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
        infraredColor(temperature, result.ambientTemperature, color, result.outdoorTemperature).toArray(colors, vertex * 3);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
  return { streamlines: null, tracers: gas.layer, update: gas.update, particleCount: gas.particleCount };
}
