export const DEFAULT_ROOM = Object.freeze({ width: 5.2, height: 4 });
export const ROOM_LIMITS = Object.freeze({ minimum: 3, maximum: 8 });

export function createScenario(room = DEFAULT_ROOM) {
  if (!(room.width > 0) || !(room.height > 0)) {
    throw new RangeError('Room width and height must be greater than zero.');
  }

  const deskZone = { x: room.width * 0.82, y: room.height * 0.26 };
  const sofaZone = { x: room.width * 0.82, y: room.height * 0.76 };
  const table = {
    x: room.width * 0.5 - 0.42,
    y: room.height * 0.55 - 0.24,
    width: 0.84,
    height: 0.48,
  };

  return {
    room: { ...room },
    baselineFan: { x: room.width * 0.16, y: room.height * 0.78, angle: -35 },
    zones: [
      { id: 'desk', label: 'Work desk', x: deskZone.x, y: deskZone.y, weight: 1.2, symbol: '⌘' },
      { id: 'sofa', label: 'Sofa', x: sofaZone.x, y: sofaZone.y, weight: 1, symbol: '⌂' },
    ],
    obstacles: [table],
    furniture: [
      { id: 'desk', type: 'desk', x: deskZone.x - 0.53, y: deskZone.y - 0.25, width: 1.06, height: 0.5 },
      { id: 'sofa', type: 'sofa', x: sofaZone.x - 0.67, y: sofaZone.y - 0.36, width: 1.34, height: 0.72 },
      { id: 'table', type: 'table', ...table },
    ],
  };
}
