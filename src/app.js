import { isPlacementClear, recommendPlacement, scoreZone } from './simulation.js';
import { boundFanPosition, comparePlacements } from './planner.js';
import { createScenario, DEFAULT_ROOM, ROOM_LIMITS } from './scenario.js';

const MAP = Object.freeze({ width: 520, height: 400, edge: 32, maxWidth: 456, maxHeight: 348 });
const SAMPLE_STEP = 0.42;
const KEYBOARD_STEP = 0.2;

let scenario = createScenario(DEFAULT_ROOM);
let baselineFan = { ...scenario.baselineFan };
let startingProposal = recommendPlacement({
  room: scenario.room,
  zones: scenario.zones,
  obstacles: scenario.obstacles,
  initialFan: baselineFan,
}).fan;
let proposedFan = { ...startingProposal };
let proposalStatus = 'Suggested start';
let draggingFan = false;

const currentMap = document.querySelector('#current-map');
const proposalMap = document.querySelector('#proposal-map');
const zoneResults = document.querySelector('#zone-results');
const $ = (selector) => document.querySelector(selector);

function roomFrame(room) {
  const scale = Math.min(MAP.maxWidth / room.width, MAP.maxHeight / room.height);
  const width = room.width * scale;
  const height = room.height * scale;
  return {
    x: (MAP.width - width) / 2,
    y: (MAP.height - height) / 2,
    width,
    height,
    scale,
  };
}

function toMap(point, frame) {
  return { x: frame.x + point.x * frame.scale, y: frame.y + point.y * frame.scale };
}

function colorForScore(score) {
  if (score < 32) return '#e4a17a';
  if (score < 58) return '#e4c16c';
  return '#62b294';
}

function renderHeat(fan, frame) {
  const cells = [];
  const room = scenario.room;
  const cellSize = SAMPLE_STEP * frame.scale;

  for (let x = SAMPLE_STEP / 2; x < room.width; x += SAMPLE_STEP) {
    for (let y = SAMPLE_STEP / 2; y < room.height; y += SAMPLE_STEP) {
      const score = scoreZone({
        fan,
        zone: { x, y },
        room,
        obstacles: scenario.obstacles,
      });
      const point = toMap({ x, y }, frame);
      const color = colorForScore(score);
      const opacity = (0.08 + score / 100 * 0.16).toFixed(2);
      const inset = Math.min(1.4, cellSize * 0.06);
      cells.push(`<rect x="${(point.x - cellSize / 2 + inset).toFixed(1)}" y="${(point.y - cellSize / 2 + inset).toFixed(1)}" width="${(cellSize - inset * 2).toFixed(1)}" height="${(cellSize - inset * 2).toFixed(1)}" rx="${Math.min(6, cellSize * 0.16).toFixed(1)}" fill="${color}" fill-opacity="${opacity}" />`);
    }
  }

  return cells.join('');
}

function renderRoomGrid(frame) {
  const lines = [];
  const interval = 0.5;
  for (let x = interval; x < scenario.room.width; x += interval) {
    const px = (frame.x + x * frame.scale).toFixed(1);
    lines.push(`<line x1="${px}" y1="${frame.y.toFixed(1)}" x2="${px}" y2="${(frame.y + frame.height).toFixed(1)}" />`);
  }
  for (let y = interval; y < scenario.room.height; y += interval) {
    const py = (frame.y + y * frame.scale).toFixed(1);
    lines.push(`<line x1="${frame.x.toFixed(1)}" y1="${py}" x2="${(frame.x + frame.width).toFixed(1)}" y2="${py}" />`);
  }
  return `<g aria-hidden="true" stroke="#dfe4dc" stroke-width=".65" stroke-dasharray="1.4 4" opacity=".72">${lines.join('')}</g>`;
}

function renderFurniture(frame) {
  return scenario.furniture.map((item) => {
    const { x, y } = toMap(item, frame);
    const width = item.width * frame.scale;
    const height = item.height * frame.scale;

    if (item.type === 'desk') {
      return `<g aria-hidden="true" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <rect x="3" y="2" width="${(width - 6).toFixed(1)}" height="${(height - 5).toFixed(1)}" rx="5" fill="#e3d6ba" stroke="#cbbd9f" stroke-width="1" />
        <path d="M7 ${height.toFixed(1)}v5m${(width - 14).toFixed(1)}-5v5" stroke="#b9ab90" stroke-width="2" stroke-linecap="round" />
        <rect x="${(width * .37).toFixed(1)}" y="${(height * .17).toFixed(1)}" width="${(width * .28).toFixed(1)}" height="${(height * .3).toFixed(1)}" rx="2" fill="#a9c0b6" stroke="#809d8d" stroke-width=".8" />
        <path d="M${(width * .43).toFixed(1)} ${(height * .2).toFixed(1)}h${(width * .15).toFixed(1)}" stroke="#eef5ee" stroke-width=".8" />
      </g>`;
    }

    if (item.type === 'sofa') {
      return `<g aria-hidden="true" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <rect x="1" y="2" width="${(width - 2).toFixed(1)}" height="${(height - 3).toFixed(1)}" rx="9" fill="#d9e3d5" stroke="#b8cbbc" stroke-width="1.1" />
        <rect x="5" y="5" width="${(width - 10).toFixed(1)}" height="${(height * .42).toFixed(1)}" rx="5" fill="#ecf0e6" stroke="#ccd8ca" stroke-width=".8" />
        <path d="M${(width / 2).toFixed(1)} 7v${(height * .36).toFixed(1)}" stroke="#d1dccf" stroke-width=".8" />
        <rect x="7" y="${(height * .62).toFixed(1)}" width="${(width - 14).toFixed(1)}" height="${(height * .23).toFixed(1)}" rx="4" fill="#c5d5c5" />
        <path d="M7 ${height.toFixed(1)}v3m${(width - 14).toFixed(1)}-3v3" stroke="#91a994" stroke-width="2" stroke-linecap="round" />
      </g>`;
    }

    return `<g aria-hidden="true" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
      <ellipse cx="${(width / 2).toFixed(1)}" cy="${(height / 2).toFixed(1)}" rx="${(width / 2 - 1).toFixed(1)}" ry="${(height / 2 - 1).toFixed(1)}" fill="#e7dfcf" stroke="#d3cab8" stroke-width="1" />
      <ellipse cx="${(width / 2).toFixed(1)}" cy="${(height / 2).toFixed(1)}" rx="${(width / 2 - 6).toFixed(1)}" ry="${(height / 2 - 5).toFixed(1)}" fill="#f0eadb" stroke="#dcd3c1" stroke-width=".8" />
    </g>`;
  }).join('');
}

function renderOccupant(zone, frame) {
  const point = toMap(zone, frame);
  const label = zone.id === 'desk' ? 'WORK' : 'LOUNGE';
  return `<g aria-hidden="true" transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})">
    <circle r="11" fill="#fff" fill-opacity=".91" stroke="#92af9d" stroke-width="1" />
    <circle cy="-3.1" r="2" fill="#477663" />
    <path d="M-4 4c.3-2.8 1.7-4.2 4-4.2S3.8 1.2 4 4" fill="#6a9a7c" />
    <text y="21" text-anchor="middle" fill="#708177" font-size="7" font-family="DM Sans, sans-serif" font-weight="700" letter-spacing=".5">${label}</text>
  </g>`;
}

function renderFan(fan, frame, interactive) {
  const point = toMap(fan, frame);
  const roundedX = fan.x.toFixed(1);
  const roundedY = fan.y.toFixed(1);
  const roleAttrs = interactive
    ? `tabindex="0" role="button" aria-label="Fan at ${roundedX} meters from the west wall and ${roundedY} meters from the north wall. Use arrow keys to move."`
    : 'aria-hidden="true"';
  const handleAttrs = interactive ? 'data-fan-handle="true"' : '';
  return `<g transform="translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})" ${handleAttrs} ${roleAttrs}>
    <circle r="25" fill="transparent" />
    <g transform="rotate(${fan.angle.toFixed(1)})" aria-hidden="true">
      <path d="M13 -6 C58 -25 99 -27 139 -16 C149 -4 149 4 139 16 C99 27 58 25 13 6Z" fill="url(#air-beam)" />
      <path d="M13 0h30m-6-5 6 5-6 5" fill="none" stroke="#3a9375" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".74" />
    </g>
    <path d="M0 14v16m-7 0h14" fill="none" stroke="#56796b" stroke-width="2.5" stroke-linecap="round" />
    <circle r="16" fill="#e7f1e9" fill-opacity=".9" stroke="#3d866c" stroke-width="1.2" />
    <g fill="#5b9b7d" aria-hidden="true">
      <path d="M-2-3C-12-14-9-19-5-18 0-17 3-10 2-3Z" />
      <path d="M-2-3C-12-14-9-19-5-18 0-17 3-10 2-3Z" transform="rotate(120)" />
      <path d="M-2-3C-12-14-9-19-5-18 0-17 3-10 2-3Z" transform="rotate(240)" />
    </g>
    <circle r="3" fill="#f7fff8" stroke="#317459" stroke-width="1.2" />
  </g>`;
}

function renderMap(svg, fan, interactive) {
  const room = scenario.room;
  const frame = roomFrame(room);
  const roomRight = frame.x + frame.width;
  const roomBottom = frame.y + frame.height;
  const windowStart = frame.x + frame.width * 0.33;
  const windowEnd = frame.x + frame.width * 0.67;
  const doorY = frame.y + frame.height * 0.81;
  const mapId = svg.id;

  svg.innerHTML = `
    <defs>
      <pattern id="${mapId}-floor" width="24" height="24" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r=".55" fill="#9caa9c" opacity=".16" />
      </pattern>
      <linearGradient id="air-beam" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#65b699" stop-opacity=".26" />
        <stop offset="1" stop-color="#65b699" stop-opacity="0" />
      </linearGradient>
      <clipPath id="${mapId}-clip"><rect x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="4" /></clipPath>
    </defs>
    <rect x="${(frame.x + 3).toFixed(1)}" y="${(frame.y + 3).toFixed(1)}" width="${frame.width.toFixed(1)}" height="${frame.height.toFixed(1)}" rx="4" fill="#e7ebe4" />
    <rect x="${frame.x.toFixed(1)}" y="${frame.y.toFixed(1)}" width="${frame.width.toFixed(1)}" height="${frame.height.toFixed(1)}" rx="4" fill="#f6f5ee" stroke="#ccd7ce" stroke-width="1.4" />
    <g clip-path="url(#${mapId}-clip)">
      <rect x="${frame.x.toFixed(1)}" y="${frame.y.toFixed(1)}" width="${frame.width.toFixed(1)}" height="${frame.height.toFixed(1)}" fill="url(#${mapId}-floor)" />
      ${renderHeat(fan, frame)}
      ${renderRoomGrid(frame)}
      ${renderFurniture(frame)}
      ${scenario.zones.map((zone) => renderOccupant(zone, frame)).join('')}
    </g>
    <g aria-hidden="true">
      <path d="M${windowStart.toFixed(1)} ${frame.y.toFixed(1)}v7m${(windowEnd - windowStart).toFixed(1)}-7v7M${windowStart.toFixed(1)} ${(frame.y + 5).toFixed(1)}h${(windowEnd - windowStart).toFixed(1)}" fill="none" stroke="#92b7b1" stroke-width="2" stroke-linecap="round" />
      <path d="M${roomRight.toFixed(1)} ${doorY.toFixed(1)}v${(roomBottom - doorY - 22).toFixed(1)}M${roomRight.toFixed(1)} ${(roomBottom - 22).toFixed(1)}h-22" fill="none" stroke="#f6f5ee" stroke-width="3.5" />
      <path d="M${roomRight.toFixed(1)} ${(roomBottom - 22).toFixed(1)}a22 22 0 0 0-22-22" fill="none" stroke="#a7b4a8" stroke-width=".9" stroke-dasharray="2 2" />
      <text x="${(frame.x + frame.width / 2).toFixed(1)}" y="${(frame.y - 8).toFixed(1)}" text-anchor="middle" fill="#91a19a" font-size="7" font-family="DM Sans, sans-serif" letter-spacing=".7">WINDOW</text>
      <text x="${(frame.x - 11).toFixed(1)}" y="${(frame.y + frame.height / 2).toFixed(1)}" text-anchor="middle" fill="#9aa69d" font-size="7" font-family="DM Sans, sans-serif" transform="rotate(-90 ${frame.x - 11} ${frame.y + frame.height / 2})">${room.height.toFixed(1)} m</text>
      <text x="${(frame.x + frame.width / 2).toFixed(1)}" y="${(roomBottom + 14).toFixed(1)}" text-anchor="middle" fill="#9aa69d" font-size="7" font-family="DM Sans, sans-serif">${room.width.toFixed(1)} m</text>
    </g>
    ${renderFan(fan, frame, interactive)}
  `;
}

function locationText(fan) {
  return `Fan · ${fan.x.toFixed(1)} m from west / ${fan.y.toFixed(1)} m from north`;
}

function formatDelta(value, suffix = '') {
  const rounded = Math.round(value);
  if (rounded === 0) return `0${suffix}`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}${suffix}`;
}

function barLine(label, score, variant) {
  return `<div class="zone-bar-line">
    <span class="zone-bar-label">${label}</span>
    <span class="zone-bar"><span class="zone-bar-fill ${variant}" style="width:${Math.max(3, score)}%"></span></span>
    <span class="zone-bar-value">${score}</span>
  </div>`;
}

function renderResults(comparison) {
  const before = comparison.before.average;
  const after = comparison.after.average;
  const change = comparison.delta;
  $('#before-average').textContent = before;
  $('#after-average').textContent = after;
  $('#after-average-label').textContent = after;
  $('#average-change').textContent = formatDelta(change);
  $('#average-change').classList.toggle('down', change < -0.5);
  $('#average-change').classList.toggle('neutral', Math.abs(change) <= 0.5);
  $('#before-track').style.width = `${before}%`;
  $('#after-track').style.width = `${after}%`;

  zoneResults.innerHTML = comparison.changes.map((zone) => {
    const deltaClass = Math.abs(zone.delta) < 0.5 ? 'neutral' : zone.delta > 0 ? '' : 'down';
    return `<div class="zone-row">
      <div class="zone-row-heading">
        <span class="zone-title"><i class="seat-symbol" aria-hidden="true">${zone.id === 'desk' ? '▤' : '⌂'}</i>${zone.label}</span>
        <span class="zone-delta ${deltaClass}">${formatDelta(zone.delta)}</span>
      </div>
      <div class="zone-bars" aria-label="${zone.label}: current ${zone.before}, test ${zone.score} out of 100">
        ${barLine('NOW', zone.before, 'before')}
        ${barLine('TEST', zone.score, 'after')}
      </div>
    </div>`;
  }).join('');

  $('#tradeoff-message').textContent = comparison.message;
}

function render() {
  renderMap(currentMap, baselineFan, false);
  renderMap(proposalMap, proposedFan, true);
  $('#current-location').textContent = locationText(baselineFan);
  $('#proposal-location').textContent = locationText(proposedFan);
  $('#proposal-status').textContent = proposalStatus;
  const comparison = comparePlacements({
    baselineFan,
    proposedFan,
    zones: scenario.zones,
    room: scenario.room,
    obstacles: scenario.obstacles,
  });
  renderResults(comparison);
}

function eventPoint(svg, event) {
  const matrix = svg.getScreenCTM();
  if (!matrix) return null;
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const local = point.matrixTransform(matrix.inverse());
  const frame = roomFrame(scenario.room);
  return {
    x: (local.x - frame.x) / frame.scale,
    y: (local.y - frame.y) / frame.scale,
  };
}

function moveProposal(point, status = 'Manual test') {
  const candidate = boundFanPosition({ ...proposedFan, ...point }, scenario.room);
  if (!isPlacementClear(candidate, scenario.zones, scenario.obstacles)) {
    proposalStatus = 'Keep clear of furniture';
    $('#proposal-status').textContent = proposalStatus;
    return;
  }
  proposedFan = candidate;
  proposalStatus = status;
  render();
}

function installMapControls(svg) {
  svg.addEventListener('pointerdown', (event) => {
    const point = eventPoint(svg, event);
    if (!point) return;
    draggingFan = Boolean(event.target.closest('[data-fan-handle]'));
    if (draggingFan && svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
    if (!draggingFan && point.x >= 0 && point.x <= scenario.room.width && point.y >= 0 && point.y <= scenario.room.height) {
      moveProposal(point);
    }
    event.preventDefault();
  });

  svg.addEventListener('pointermove', (event) => {
    if (!draggingFan || (event.buttons !== 1 && event.pointerType !== 'touch')) return;
    const point = eventPoint(svg, event);
    if (point) moveProposal(point);
  });

  svg.addEventListener('pointerup', () => { draggingFan = false; });
  svg.addEventListener('pointercancel', () => { draggingFan = false; });
  svg.addEventListener('keydown', (event) => {
    const steps = {
      ArrowLeft: { x: -KEYBOARD_STEP, y: 0 },
      ArrowRight: { x: KEYBOARD_STEP, y: 0 },
      ArrowUp: { x: 0, y: -KEYBOARD_STEP },
      ArrowDown: { x: 0, y: KEYBOARD_STEP },
    };
    const change = steps[event.key];
    if (!change || !event.target.closest('[data-fan-handle]')) return;
    event.preventDefault();
    moveProposal({ x: proposedFan.x + change.x, y: proposedFan.y + change.y });
    proposalMap.querySelector('[data-fan-handle]')?.focus();
  });
}

installMapControls(proposalMap);

$('#rotate-fan').addEventListener('click', () => {
  proposedFan = { ...proposedFan, angle: ((proposedFan.angle + 15 + 180) % 360) - 180 };
  proposalStatus = 'Manual test';
  render();
});

$('#find-best').addEventListener('click', () => {
  const recommendation = recommendPlacement({
    room: scenario.room,
    zones: scenario.zones,
    obstacles: scenario.obstacles,
    initialFan: proposedFan,
  });
  proposedFan = { ...recommendation.fan };
  proposalStatus = 'Suggested spot';
  render();
});

$('#reset-test').addEventListener('click', () => {
  proposedFan = { ...startingProposal };
  proposalStatus = 'Suggested start';
  render();
});

$('#room-size-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const width = Number(form.get('width'));
  const height = Number(form.get('height'));
  const isInRange = [width, height].every((value) => (
    Number.isFinite(value) && value >= ROOM_LIMITS.minimum && value <= ROOM_LIMITS.maximum
  ));
  if (!isInRange) {
    $('#room-width').reportValidity();
    $('#room-height').reportValidity();
    return;
  }

  scenario = createScenario({ width, height });
  baselineFan = { ...scenario.baselineFan };
  startingProposal = recommendPlacement({
    room: scenario.room,
    zones: scenario.zones,
    obstacles: scenario.obstacles,
    initialFan: baselineFan,
  }).fan;
  proposedFan = { ...startingProposal };
  proposalStatus = 'Suggested start';
  $('#room-size-label').textContent = `${width.toFixed(1)} × ${height.toFixed(1)} m`;
  $('#panel-room-dimensions').textContent = `${width.toFixed(1)} × ${height.toFixed(1)} m`;
  $('#room-editor').open = false;
  render();
});

render();
