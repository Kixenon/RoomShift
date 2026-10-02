# RoomShift

Try a room change before moving anything. The demo focuses on one decision: testing a fan position against two occupied areas in a living room.

## Run it

```sh
npm run dev
```

Open <http://127.0.0.1:4173>. No dependencies or build step are required.

```sh
npm test
```

## Try the room

- Edit room width and length (3–8 m) from the room badge.
- Drag or tap the fan in the test room; use arrow keys to nudge it or **Rotate** to change direction.
- Compare estimated airflow at the work desk and sofa against the starting setup.
- Choose **Find best spot** to search clear positions and fan directions. The search favors average comfort while also raising the least-served spot, with a small preference for less movement.
- **Reset** returns to the suggested starting test.

## What the score means

The map is a relative, illustrative estimate—not measured wind speed or a guarantee of comfort. The small model combines distance falloff, fan direction, and a simple line-of-sight penalty for the coffee table. It compares only the work desk and sofa. It does not model fan power, ceiling height, room temperature, real drafts, or other furniture. Treat it as a way to compare options, then verify the result in the physical room.

## Structure

- `src/simulation.js` — airflow scoring, obstruction checks, placement search.
- `src/planner.js` — before/after comparisons and movement constraints.
- `src/scenario.js` — editable room and sample layout.
- `src/app.js` — SVG map, interaction, and result rendering.
- `tests/airflow.test.js` — model, recommendation, placement, and comparison tests.
