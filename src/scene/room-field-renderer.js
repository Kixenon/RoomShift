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
    const value = mode === 'airflow'
      ? Math.hypot(fields.u[index], fields.v[index], fields.w[index])
      : mode === 'temperature' ? fields.temperature[index] : fields.light[index];
    data[index * 4] = Math.round(normalizeScalar(result, mode, value) * 255);
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
      uOpacity: { value: mode === 'airflow' ? 1.2 : 1.55 },
      uFieldMode: { value: mode === 'airflow' ? 0 : mode === 'temperature' ? 1 : 2 },
    },
    side: THREE.FrontSide,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vLocalPosition;
      varying vec3 vRayDirection;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vLocalPosition = position;
        vRayDirection = normalize(worldPosition.xyz - cameraPosition);
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
      varying vec3 vRayDirection;
      out vec4 fragColor;

      vec3 palette(float value) {
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
        vec3 direction = normalize(vRayDirection);
        float stepLength = uStepLength;
        vec4 accumulated = vec4(0.0);
        vec3 halfSize = uVolumeSize * 0.5;
        for (int index = 0; index < 192; index++) {
          float distance = float(index) * stepLength;
          vec3 point = vLocalPosition + direction * distance;
          if (any(greaterThan(abs(point), halfSize))) break;
          vec3 roomCoordinate = point / uVolumeSize + 0.5;
          vec3 textureCoordinate = vec3(roomCoordinate.x, roomCoordinate.z, roomCoordinate.y);
          vec4 field = texture(uField, textureCoordinate);
          float density = smoothstep(0.035, 0.72, field.r);
          if (uFieldMode == 1) { density = pow(density, 0.7); }
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
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 0.9 } },
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

function createTracerLayer(paths) {
  const particles = [];
  for (const path of paths) {
    if (path.length < 2) continue;
    for (let index = 0; index < 2; index += 1) {
      particles.push({ path, phase: index * 0.5 });
    }
  }
  if (particles.length === 0) return null;
  const positions = new Float32Array(particles.length * 3);
  const lifeValues = new Float32Array(particles.length);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aLife', new THREE.BufferAttribute(lifeValues, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    toneMapped: false,
    uniforms: { uSize: { value: 9 } },
    vertexShader: `
      uniform float uSize;
      attribute float aLife;
      varying float vLife;
      void main() {
        vLife = aLife;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize;
      }
    `,
    fragmentShader: `
      varying float vLife;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5));
        float alpha = (1.0 - smoothstep(0.18, 0.5, radius)) * vLife;
        if (alpha < 0.02) discard;
        gl_FragColor = vec4(0.06, 0.58, 0.82, alpha);
      }
    `,
  });
  const layer = new THREE.Points(geometry, material);
  layer.name = 'airflow-tracers';
  layer.userData.particles = particles;
  layer.renderOrder = 3;
  layer.frustumCulled = false;
  return layer;
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
  const tracers = createTracerLayer(paths);
  const particlePosition = new THREE.Vector3();
  const update = (time) => {
    if (streamlines) streamlines.material.uniforms.uTime.value = time;
    if (!tracers) return;
    const positions = tracers.geometry.attributes.position;
    const lifeValues = tracers.geometry.attributes.aLife;
    const particlePaths = tracers.userData.particles;
    const progress = ((time * 0.24) % 1 + 1) % 1;
    for (let index = 0; index < particlePaths.length; index += 1) {
      const particle = particlePaths[index];
      const phase = (progress + particle.phase) % 1;
      samplePath(particle.path, phase, particlePosition);
      positions.setXYZ(index, particlePosition.x, particlePosition.y, particlePosition.z);
      lifeValues.setX(index, smoothstep01(phase / 0.12) * (1 - smoothstep01((phase - 0.82) / 0.18)));
    }
    positions.needsUpdate = true;
    lifeValues.needsUpdate = true;
  };
  update(0);
  return { streamlines, tracers, update };
}

function smoothstep01(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}
