import * as THREE from 'three';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const indexOf = (i, j, k, grid) => (j * grid.nz + k) * grid.nx + i;

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

function sampleVelocity(result, point) {
  const { grid, fields } = result;
  return new THREE.Vector3(
    sampleField(fields.u, point.x, point.y, point.z, grid, fields.solid),
    sampleField(fields.v, point.x, point.y, point.z, grid, fields.solid),
    sampleField(fields.w, point.x, point.y, point.z, grid, fields.solid),
  );
}

function sampleScalar(result, mode, point) {
  const { grid, fields } = result;
  if (mode === 'airflow') {
    return sampleVelocity(result, point).length();
  }
  if (mode === 'temperature') {
    return sampleField(fields.temperature, point.x, point.y, point.z, grid, fields.solid, result.ambientTemperature);
  }
  return sampleField(fields.light, point.x, point.y, point.z, grid, fields.solid, result.ambientLevel);
}

function normalizeScalar(result, mode, value) {
  if (mode === 'airflow') return clamp(value / Math.max(result.stats.maxSpeed, 0.001), 0, 1);
  if (mode === 'temperature') {
    return clamp((value - result.ambientTemperature) / Math.max(result.stats.maxTemperature - result.ambientTemperature, 0.05), 0, 1);
  }
  return clamp((value - result.ambientLevel) / Math.max((result.stats.maxLevel ?? result.stats.maxLight) - result.ambientLevel, 0.05), 0, 1);
}

function createFieldTexture(result, mode) {
  const { grid, fields } = result;
  const voxelCount = grid.nx * grid.ny * grid.nz;
  const data = new Uint8Array(voxelCount * 4);
  for (let index = 0; index < voxelCount; index += 1) {
    const normalized = fields.signal ? fields.signal[index] : normalizeScalar(result, mode, mode === 'airflow'
      ? Math.hypot(fields.u[index], fields.v[index], fields.w[index])
      : mode === 'temperature' ? fields.temperature[index] : fields.light[index]);
    data[index * 4] = Math.round(normalized * 255);
    data[index * 4 + 1] = fields.solid?.[index] ? 255 : 0;
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
      uOpacity: { value: mode === 'airflow' ? 0.55 : 1.55 },
      uFieldMode: { value: { airflow: 0, temperature: 1, light: 2, wifi: 3, sound: 4, lux: 5 }[mode] ?? 2 },
      uTime: { value: 0 },
      uSources: { value: Array.from({ length: 8 }, (_, index) => {
        const source = result.sources?.[index];
        return source ? new THREE.Vector3(source.x - grid.width / 2, source.y - grid.height / 2, source.z - grid.depth / 2) : new THREE.Vector3();
      }) },
      // Per-source strength: 1 for real sources, the wall's reflection factor for image sources.
      uSourceGain: { value: Array.from({ length: 8 }, (_, index) => result.sources?.[index]?.gain ?? 1) },
      uSourceCount: { value: Math.min(8, result.sources?.length ?? 0) },
      // Visual wavelength (m) and phase speed: sound uses a real 500 Hz wavelength
      // (0.69 m) slowed down; WiFi's 6 cm wave is drawn at 0.3 m to stay visible.
      uWaveNumber: { value: mode === 'sound' ? 2 * Math.PI / 0.69 : 2 * Math.PI / 0.6 },
      uWaveSpeed: { value: mode === 'sound' ? 3.5 : 5 },
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
      uniform float uTime;
      uniform vec3 uSources[8];
      uniform float uSourceGain[8];
      uniform int uSourceCount;
      uniform float uWaveNumber;
      uniform float uWaveSpeed;
      varying vec3 vLocalPosition;
      varying vec3 vRayOrigin;
      out vec4 fragColor;

      vec3 palette(float value) {
        if (uFieldMode == 5) {
          vec3 dim = vec3(0.16, 0.12, 0.3);
          vec3 warm = vec3(0.95, 0.55, 0.22);
          vec3 bright = vec3(1.0, 0.86, 0.5);
          vec3 sun = vec3(1.0, 0.98, 0.9);
          if (value < 0.35) return mix(dim, warm, value / 0.35);
          if (value < 0.75) return mix(warm, bright, (value - 0.35) / 0.4);
          return mix(bright, sun, (value - 0.75) / 0.25);
        }
        if (uFieldMode == 3) {
          vec3 weak = vec3(0.86, 0.29, 0.25);
          vec3 fair = vec3(0.95, 0.66, 0.26);
          vec3 good = vec3(0.45, 0.82, 0.48);
          vec3 strong = vec3(0.1, 0.62, 0.95);
          if (value < 0.33) return mix(weak, fair, value / 0.33);
          if (value < 0.66) return mix(fair, good, (value - 0.33) / 0.33);
          return mix(good, strong, (value - 0.66) / 0.34);
        }
        if (uFieldMode == 4) {
          vec3 quiet = vec3(0.16, 0.2, 0.5);
          vec3 mid = vec3(0.62, 0.32, 0.72);
          vec3 loud = vec3(1.0, 0.55, 0.3);
          vec3 peak = vec3(1.0, 0.92, 0.62);
          if (value < 0.4) return mix(quiet, mid, value / 0.4);
          if (value < 0.8) return mix(mid, loud, (value - 0.4) / 0.4);
          return mix(loud, peak, (value - 0.8) / 0.2);
        }
        if (uFieldMode == 1) {
          vec3 cold = vec3(0.015, 0.035, 0.22);
          vec3 cyan = vec3(0.0, 0.65, 1.0);
          vec3 yellow = vec3(1.0, 0.88, 0.03);
          vec3 red = vec3(1.0, 0.12, 0.015);
          if (value < 0.28) return mix(cold, cyan, value / 0.28);
          if (value < 0.58) return mix(cyan, yellow, (value - 0.28) / 0.3);
          if (value < 0.84) return mix(yellow, red, (value - 0.58) / 0.26);
          return mix(red, vec3(1.0), (value - 0.84) / 0.16);
        }
        vec3 navy = vec3(0.015, 0.025, 0.11);
        vec3 blue = vec3(0.02, 0.22, 0.95);
        vec3 cyan = vec3(0.0, 0.86, 1.0);
        vec3 green = vec3(0.12, 0.92, 0.46);
        vec3 yellow = vec3(1.0, 0.78, 0.05);
        vec3 red = vec3(1.0, 0.08, 0.018);
        if (uFieldMode == 2) {
          navy = vec3(0.08, 0.025, 0.2);
          blue = vec3(0.28, 0.09, 0.85);
          cyan = vec3(0.96, 0.08, 0.66);
          green = vec3(1.0, 0.31, 0.18);
          yellow = vec3(1.0, 0.82, 0.28);
          red = vec3(1.0, 0.98, 0.77);
        }
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
          float density = smoothstep(0.035, 0.72, field.r);
          if (uFieldMode == 1) { density = pow(density, 0.7); }
          vec3 color = palette(field.r);
          if (uFieldMode == 5) {
            // Light: a soft glow that thickens only where it is bright.
            density = pow(field.r, 4.0) * 0.9;
          } else if (uFieldMode >= 3) {
            // Expanding spherical wavefronts from each source. Their brightness is
            // the local field strength, so they fade with distance and in the
            // shadow of absorbing or blocking furniture.
            float wave = 0.0;
            for (int s = 0; s < 8; s++) {
              if (s >= uSourceCount) break;
              float d = length(point - uSources[s]);
              // Shells thin out and fade with distance like a spreading wavefront.
              wave += uSourceGain[s] * pow(0.5 + 0.5 * sin(d * uWaveNumber - uTime * uWaveSpeed), 48.0) * smoothstep(0.05, 0.3, d) / (1.0 + d * 0.35);
            }
            float strength = field.r;
            density = 0.01 + strength * strength * 0.06 + wave * strength * 1.2;
            color = mix(color, vec3(1.0), wave * strength * 0.35);
          }
          density *= 1.0 - step(0.5, field.g);
          float alpha = 1.0 - exp(-density * 2.35 * stepLength * uOpacity);
          float contribution = (1.0 - accumulated.a) * alpha;
          accumulated.rgb += color * contribution;
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

function findStreamlineSeeds(result, maximumSeeds = 64) {
  const { grid, fields, stats } = result;
  const strides = [
    Math.max(1, Math.ceil(grid.nx / 18)),
    Math.max(1, Math.ceil(grid.ny / 8)),
    Math.max(1, Math.ceil(grid.nz / 18)),
  ];
  const threshold = Math.max(0.002, stats.maxSpeed * 0.09);
  const candidates = [];
  for (let j = 0; j < grid.ny; j += strides[1]) {
    for (let k = 0; k < grid.nz; k += strides[2]) {
      for (let i = 0; i < grid.nx; i += strides[0]) {
        const index = indexOf(i, j, k, grid);
        if (fields.solid[index]) continue;
        const speed = Math.hypot(fields.u[index], fields.v[index], fields.w[index]);
        if (speed < threshold) continue;
        candidates.push({
          speed,
          point: new THREE.Vector3((i + 0.5) * grid.dx, (j + 0.5) * grid.dy, (k + 0.5) * grid.dz),
        });
      }
    }
  }
  candidates.sort((a, b) => b.speed - a.speed);
  const minimumDistance = Math.max(0.2, Math.min(grid.dx, grid.dy, grid.dz) * 1.2);
  const minimumDistanceSquared = minimumDistance ** 2;
  const seeds = [];
  for (const candidate of candidates) {
    if (seeds.every((seed) => seed.point.distanceToSquared(candidate.point) >= minimumDistanceSquared)) {
      seeds.push(candidate);
      if (seeds.length === maximumSeeds) break;
    }
  }
  return seeds;
}

function traceStreamline(result, seed) {
  const { grid, fields, stats } = result;
  const stepSize = Math.min(grid.dx, grid.dy, grid.dz) * 0.3;
  const minimumSpeed = Math.max(0.002, stats.maxSpeed * 0.015);
  const maximumSteps = Math.min(240, Math.ceil(Math.hypot(grid.width, grid.height, grid.depth) * 2.2 / stepSize));
  const path = [{ position: seed.point.clone(), speed: seed.speed }];
  let position = seed.point.clone();

  for (let step = 0; step < maximumSteps; step += 1) {
    const velocity = sampleVelocity(result, position);
    if (velocity.length() < minimumSpeed) break;
    const midpoint = position.clone().addScaledVector(velocity.normalize(), stepSize * 0.5);
    const middleVelocity = sampleVelocity(result, midpoint);
    const speed = middleVelocity.length();
    if (speed < minimumSpeed) break;
    const next = position.clone().addScaledVector(middleVelocity.normalize(), stepSize);
    if (!isFluidPoint(next, grid, fields.solid)) break;
    path.push({ position: next.clone(), speed });
    position = next;
    if (path.length > 12 && position.distanceToSquared(seed.point) < stepSize ** 2) break;
  }
  return path;
}

function createStreamlineGeometry(paths, maximumSpeed) {
  const positionValues = [];
  const progressValues = [];
  const speedValues = [];
  const indices = [];
  const halfWidth = 0.018;
  let vertexIndex = 0;
  for (const path of paths) {
    if (path.length < 2) continue;
    const distances = [0];
    for (let i = 1; i < path.length; i += 1) {
      distances.push(distances[i - 1] + path[i].position.distanceTo(path[i - 1].position));
    }
    const totalDistance = Math.max(distances.at(-1), 0.001);
    for (let i = 1; i < path.length; i += 1) {
      const start = path[i - 1].position;
      const end = path[i].position;
      const direction = end.clone().sub(start).normalize();
      const reference = Math.abs(direction.y) > 0.92
        ? new THREE.Vector3(1, 0, 0)
        : new THREE.Vector3(0, 1, 0);
      const side = new THREE.Vector3().crossVectors(direction, reference).normalize().multiplyScalar(halfWidth);
      const vertices = [
        start.clone().add(side),
        start.clone().sub(side),
        end.clone().add(side),
        end.clone().sub(side),
      ];
      for (const point of vertices) positionValues.push(point.x, point.y, point.z);
      const startProgress = distances[i - 1] / totalDistance;
      const endProgress = distances[i] / totalDistance;
      const startSpeed = path[i - 1].speed / maximumSpeed;
      const endSpeed = path[i].speed / maximumSpeed;
      progressValues.push(startProgress, startProgress, endProgress, endProgress);
      speedValues.push(startSpeed, startSpeed, endSpeed, endSpeed);
      indices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2, vertexIndex + 2, vertexIndex + 1, vertexIndex + 3);
      vertexIndex += 4;
    }
  }
  if (positionValues.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positionValues, 3));
  geometry.setAttribute('aProgress', new THREE.Float32BufferAttribute(progressValues, 1));
  geometry.setAttribute('aSpeed', new THREE.Float32BufferAttribute(speedValues, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function createStreamlineMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.16 } },
    vertexShader: `
      attribute float aProgress;
      attribute float aSpeed;
      varying float vProgress;
      varying float vSpeed;
      void main() {
        vProgress = aProgress;
        vSpeed = clamp(aSpeed, 0.0, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      varying float vProgress;
      varying float vSpeed;
      void main() {
        float head = fract(vProgress - uTime * 0.32);
        float pulse = pow(max(0.0, 1.0 - abs(head - 0.5) * 5.0), 3.0);
        vec3 cool = vec3(0.02, 0.38, 0.62);
        vec3 warm = vec3(0.82, 0.2, 0.04);
        vec3 color = mix(cool, warm, vSpeed);
        color = mix(color, vec3(0.42, 0.82, 0.96), pulse * 0.5);
        float alpha = (0.48 + pulse * 0.35) * uOpacity;
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });
}

function samplePath(path, progress, target) {
  const scaled = clamp(progress, 0, 1) * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  return target.copy(path[index].position).lerp(path[index + 1].position, scaled - index);
}

// Particles advected through the solved velocity field in real time. They are
// emitted where the air moves fastest (fan and AC jets, window inflow), travel at
// the simulated speed, and fade as the flow slows, so direction and dissipation
// read directly. Positions are kept in grid space and offset to the room centre.
// Air as smoke: thousands of short streaks advected through the solved velocity
// field. Most are emitted where the air moves (fans, AC, open windows), the rest
// anywhere in the room so slow drift is visible too. Each streak points along the
// flow, stretches with speed and fades as the jet dissipates. Positions are kept
// in grid space and offset to the room centre.
const TRAIL_SECONDS = 0.14;
function createParticleLayer(result, count = 4500) {
  const { grid, fields, stats } = result;
  const maximumSpeed = Math.max(stats.maxSpeed, 0.001);
  const fast = [];
  const fastWeights = [];
  const anywhere = [];
  let total = 0;
  for (let j = 0; j < grid.ny; j += 1) {
    for (let k = 0; k < grid.nz; k += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const index = indexOf(i, j, k, grid);
        if (fields.solid[index]) continue;
        const speed = Math.hypot(fields.u[index], fields.v[index], fields.w[index]) / maximumSpeed;
        if ((i + j + k) % 3 === 0) anywhere.push(i, j, k);
        if (speed < 0.08) continue;
        total += speed ** 2;
        fast.push(i, j, k);
        fastWeights.push(total);
      }
    }
  }
  if (!fastWeights.length && !anywhere.length) return null;
  const heads = new Float32Array(count * 3);
  const trail = new Float32Array(count * 6);
  const trailAlpha = new Float32Array(count * 2);
  const trailSpeed = new Float32Array(count * 2);
  const grid3 = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const speedValues = new Float32Array(count);
  const age = new Float32Array(count);
  const life = new Float32Array(count);
  let seed = 12345;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const spawn = (index) => {
    let cell;
    if (fastWeights.length && random() < 0.72) {
      const target = random() * total;
      let lo = 0;
      let hi = fastWeights.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (fastWeights[mid] < target) lo = mid + 1;
        else hi = mid;
      }
      cell = [fast[lo * 3], fast[lo * 3 + 1], fast[lo * 3 + 2]];
    } else {
      const pick = Math.floor(random() * (anywhere.length / 3)) * 3;
      cell = [anywhere[pick], anywhere[pick + 1], anywhere[pick + 2]];
    }
    grid3[index * 3] = (cell[0] + random()) * grid.dx;
    grid3[index * 3 + 1] = (cell[1] + random()) * grid.dy;
    grid3[index * 3 + 2] = (cell[2] + random()) * grid.dz;
    age[index] = 0;
    life[index] = 2 + random() * 4;
  };
  for (let index = 0; index < count; index += 1) {
    spawn(index);
    age[index] = random() * life[index];
  }

  const headGeometry = new THREE.BufferGeometry();
  headGeometry.setAttribute('position', new THREE.BufferAttribute(heads, 3));
  headGeometry.setAttribute('aLife', new THREE.BufferAttribute(alpha, 1));
  headGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(speedValues, 1));
  const shared = {
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  };
  const colorFn = `
    vec3 airColor(float speed) {
      vec3 still = vec3(0.35, 0.62, 0.95);
      vec3 breeze = vec3(0.45, 0.95, 0.95);
      vec3 jet = vec3(1.0, 0.62, 0.32);
      return speed < 0.5 ? mix(still, breeze, speed * 2.0) : mix(breeze, jet, (speed - 0.5) * 2.0);
    }`;
  const points = new THREE.Points(headGeometry, new THREE.ShaderMaterial({
    ...shared,
    uniforms: { uSize: { value: 9 } },
    vertexShader: `
      uniform float uSize;
      attribute float aLife;
      attribute float aSpeed;
      varying float vLife;
      varying float vSpeed;
      void main() {
        vLife = aLife;
        vSpeed = aSpeed;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(uSize / max(0.5, -mvPosition.z), 1.0, 5.0);
      }
    `,
    fragmentShader: `
      varying float vLife;
      varying float vSpeed;
      ${colorFn}
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float alpha = (1.0 - smoothstep(0.1, 0.5, radius)) * vLife * 0.8;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(airColor(clamp(vSpeed, 0.0, 1.0)) * alpha, alpha);
      }
    `,
  }));
  points.name = 'airflow-tracers';
  points.renderOrder = 3;
  points.frustumCulled = false;

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.BufferAttribute(trail, 3));
  trailGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(trailAlpha, 1));
  trailGeometry.setAttribute('aSpeed', new THREE.BufferAttribute(trailSpeed, 1));
  const streaks = new THREE.LineSegments(trailGeometry, new THREE.ShaderMaterial({
    ...shared,
    vertexShader: `
      attribute float aAlpha;
      attribute float aSpeed;
      varying float vAlpha;
      varying float vSpeed;
      void main() {
        vAlpha = aAlpha;
        vSpeed = aSpeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      varying float vSpeed;
      ${colorFn}
      void main() {
        if (vAlpha < 0.01) discard;
        gl_FragColor = vec4(airColor(clamp(vSpeed, 0.0, 1.0)) * vAlpha, vAlpha);
      }
    `,
  }));
  streaks.name = 'airflow-streaks';
  streaks.renderOrder = 3;
  streaks.frustumCulled = false;
  points.userData.streaks = streaks;

  const point = new THREE.Vector3();
  let lastTime = null;
  points.userData.step = (time) => {
    const dt = lastTime === null ? 0.016 : clamp(time - lastTime, 0, 0.05);
    lastTime = time;
    const offsetX = grid.width / 2;
    const offsetZ = grid.depth / 2;
    for (let index = 0; index < count; index += 1) {
      point.set(grid3[index * 3], grid3[index * 3 + 1], grid3[index * 3 + 2]);
      const velocity = sampleVelocity(result, point);
      const speed = velocity.length() / maximumSpeed;
      grid3[index * 3] += velocity.x * dt;
      grid3[index * 3 + 1] += velocity.y * dt;
      grid3[index * 3 + 2] += velocity.z * dt;
      // Slow air ages faster, so particles die out where the jet dissipates.
      age[index] += dt * (1 + 1.5 * (1 - Math.min(1, speed * 4)));
      point.set(grid3[index * 3], grid3[index * 3 + 1], grid3[index * 3 + 2]);
      if (age[index] > life[index] || !isFluidPoint(point, grid, fields.solid)) spawn(index);
      const t = age[index] / life[index];
      const visibility = smoothstep01(t / 0.15) * (1 - smoothstep01((t - 0.65) / 0.35)) * Math.min(1, 0.22 + speed * 2.4);
      alpha[index] = visibility;
      speedValues[index] = speed;
      const x = grid3[index * 3] - offsetX;
      const y = grid3[index * 3 + 1];
      const z = grid3[index * 3 + 2] - offsetZ;
      heads[index * 3] = x;
      heads[index * 3 + 1] = y;
      heads[index * 3 + 2] = z;
      const base = index * 6;
      trail[base] = x;
      trail[base + 1] = y;
      trail[base + 2] = z;
      trail[base + 3] = x - velocity.x * TRAIL_SECONDS;
      trail[base + 4] = y - velocity.y * TRAIL_SECONDS;
      trail[base + 5] = z - velocity.z * TRAIL_SECONDS;
      trailAlpha[index * 2] = visibility * 0.9;
      trailAlpha[index * 2 + 1] = 0;
      trailSpeed[index * 2] = speed;
      trailSpeed[index * 2 + 1] = speed;
    }
    headGeometry.attributes.position.needsUpdate = true;
    headGeometry.attributes.aLife.needsUpdate = true;
    headGeometry.attributes.aSpeed.needsUpdate = true;
    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.aAlpha.needsUpdate = true;
    trailGeometry.attributes.aSpeed.needsUpdate = true;
  };
  return points;
}

export function createAirflowLayers(result) {
  const seeds = findStreamlineSeeds(result);
  const paths = seeds.map((seed) => traceStreamline(result, seed)).filter((path) => path.length > 1);
  for (const path of paths) {
    for (const point of path) {
      point.position.x -= result.grid.width / 2;
      point.position.z -= result.grid.depth / 2;
    }
  }
  const geometry = createStreamlineGeometry(paths, Math.max(result.stats.maxSpeed, 0.001));
  const streamlines = geometry ? new THREE.Mesh(geometry, createStreamlineMaterial()) : null;
  if (streamlines) {
    streamlines.name = 'airflow-streamlines';
    streamlines.renderOrder = 2;
  }
  const tracers = createParticleLayer(result);
  const update = (time) => {
    if (streamlines) streamlines.material.uniforms.uTime.value = time;
    tracers?.userData.step(time);
  };
  update(0);
  return { streamlines, tracers, update };
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
