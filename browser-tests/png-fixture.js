import { deflateSync } from 'node:zlib';

// A minimal PNG encoder, so the browser test can hand the panel a real image
// file rather than a stub. Keeps the test suite dependency-free.

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode an RGB byte array of width*height*3 bytes as a PNG. */
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 3 + 1);
    raw[target] = 0; // filter: none
    rgb.copy(raw, target + 1, y * width * 3, (y + 1) * width * 3);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: truecolour
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A synthetic interior: the floor-wall and ceiling-wall junctions of a known
 * room, drawn as full-width horizontals so the horizon estimator has something
 * real to find, plus the side-wall verticals.
 */
export function renderSyntheticRoom({
  width = 1200,
  height = 800,
  focal = 900,
  cameraHeight = 1.6,
  room = { width: 4.4, depth: 5.5, height: 2.6 },
  inset = 5,
  yawDeg = 16,
} = {}) {
  const rgb = Buffer.alloc(width * height * 3);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 3;
    rgb[offset] = r;
    rgb[offset + 1] = g;
    rgb[offset + 2] = b;
  };
  const yaw = (yawDeg * Math.PI) / 180;
  const across = { x: Math.cos(yaw), z: Math.sin(yaw) };
  const along = { x: -Math.sin(yaw), z: Math.cos(yaw) };
  const centre = { x: 0, z: inset + room.depth / 2 };
  const project = (point) => ({
    x: width / 2 + (focal * point.x) / point.z,
    y: height / 2 + (focal * point.y) / point.z,
  });
  const half = { u: room.width / 2, v: room.depth / 2 };
  const at = (u, v) => ({
    x: centre.x + across.x * u + along.x * v,
    z: centre.z + across.z * u + along.z * v,
  });

  // Faint floor and ceiling fill so the frame is not pure background.
  for (let y = 0; y < height; y += 1) {
    const shade = y > height * 0.62 ? [58, 56, 52] : [176, 178, 182];
    for (let x = 0; x < width; x += 1) put(x, y, shade);
  }

  const line = (a, b, colour, weight = 3) => {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)) * 2;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      for (let w = -weight; w <= weight; w += 1) put(x + w, y, colour);
    }
  };

  const junction = (u, v, atCeiling) => project({
    x: at(u, v).x,
    y: atCeiling ? cameraHeight - room.height : cameraHeight,
    z: at(u, v).z,
  });

  const DARK = [28, 30, 34];
  // Far wall: a full-width horizontal pair, which is what fixes the horizon.
  line(junction(-half.u, half.v, false), junction(half.u, half.v, false), DARK, 4);
  line(junction(-half.u, half.v, true), junction(half.u, half.v, true), DARK, 4);
  // Side walls receding from the far corners to the near corners.
  line(junction(-half.u, half.v, false), junction(-half.u, -half.v, false), DARK, 3);
  line(junction(half.u, half.v, false), junction(half.u, -half.v, false), DARK, 3);
  line(junction(-half.u, half.v, true), junction(-half.u, -half.v, true), DARK, 3);
  line(junction(half.u, half.v, true), junction(half.u, -half.v, true), DARK, 3);

  return {
    png: encodePng(width, height, rgb),
    // Where a user would click, in image pixels.
    floorCorners: [
      junction(-half.u, -half.v, false),
      junction(half.u, -half.v, false),
      junction(half.u, half.v, false),
      junction(-half.u, half.v, false),
    ],
    ceilingPoint: junction(0, half.v, true),
    horizonRow: height / 2,
    room,
    cameraHeight,
    imageSize: { width, height },
  };
}
