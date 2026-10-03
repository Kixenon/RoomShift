# RoomShift

A browser-based 3D room editor for trying out layout changes before moving furniture or devices.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (normally <http://127.0.0.1:4173>).

```sh
npm test
npm run build
```

`npm test` runs the headless-safe unit and model tests. The Playwright browser tests live in `browser-tests/` and are excluded from it, because they need a real GPU: two of them assert a WebGPU backend that headless Chromium does not expose (`navigator.gpu` is undefined), and the whole file renders through WebGL. Run them separately:

```sh
npx playwright install chromium
npm run test:browser     # or: npm run test:all to run everything
```

They default to Playwright's bundled Chromium. Set `ROOMSHIFT_BROWSER` to a browser executable path to use a different one.

## Editor

- Edit room width, depth, and height in meters.
- Add generic boxes, then change their name and visual/semantic model (fan, sofa, bed, desk, table, lamp, heater) independently; choosing a model does not change its box dimensions or name.
- Hover near an object to highlight it; click the object or its list item to select it. Drag the gizmo or edit position, size, and X/Y/Z rotation in the inspector.
- Add a window, then drag it toward a wall; it snaps to the nearest wall. Open windows can exchange air, act as an inlet, or act as an outlet. Fan, heater, lamp, and window flow strengths are adjustable; fans can be switched off in the inspector. Drag the canvas to orbit in **3D**; **Top** locks the camera vertically; **Ortho** switches the 3D view to orthographic projection.
- Undo with **⌘Z / Ctrl+Z**; redo with **⌘⇧Z / Ctrl+Y**. Use the **i** button in the viewport toolbar for the full shortcut list. A gizmo drag is one undo step.
- **Air** and **Heat** update continuously in the background while selected. Geometry or model edits trigger a fresh estimate; **Light** switches immediately to a real-time shadow preview.

## Time of day in Light mode

The light preview is driven by the real solar position for a fixed site: **Hong Kong**, 22.32° N, 114.17° E, UTC+8, using the NOAA solar position algorithm. The compass is pinned so the scene's -z is north and +x is east, because nothing in the scene model implied an orientation.

- Drag the clock (or press the time control) and the sun's altitude and azimuth change. Colour and intensity follow: warm and low at dawn and dusk, near-neutral and high at midday, nothing below the horizon.
- **Sun patches.** Each open window projects a parallelogram of direct sun onto the floor, clipped to the room. A patch is dropped when the sun is below the horizon, is on the wrong side of the wall, or the window is closed. Patches pull away from their wall as the sun climbs, and graze it dimly when the light is oblique.
- **Lamps** switch on by themselves when the sun drops below 6°, and the **Lamps** button reads as lit whenever they are. It is a plain on/off switch: it flips whatever the lamps are doing now, so you can turn them off at night as well as on during the day. Until you press it, the dusk threshold decides.
- The site being inside the tropics is not incidental: between the solstices the sun passes north of the zenith, so its azimuth sweeps through the whole compass and a room's aspect changes through the day. In June it stays in the northern half of the sky all day.

This is still a **visual preview, not lux-calibrated photometry**. The solar position is geometric and meaningful; the light intensities are hand-tuned curves chosen to read well, not measured irradiance. The room is a rectangular box with flat walls, and the sun patches are parallel projections with no occlusion by furniture. A near-overhead sun barely reaches any vertical wall, so patches shrink to slivers around local noon.

## Simulation scope and limits

The editor uses Three.js for the room and visualizations, a Web Worker for field solves, WebGPU when available, and a bounded CPU fallback. These are **planning estimates**, not validated computational fluid dynamics (CFD), an engineering-grade thermal model, calibrated photometry, or a safety tool.

- WebGPU uses a 0.05 m grid by default and coarsens only as needed to fit 1.5 million cells and device limits. It advances twelve simulated seconds with twenty pressure iterations. The CPU fallback uses a 0.15 m grid, is capped at 38,400 cells, and also advances twelve simulated seconds.
- Air's **Gas** view renders a continuously advected 3D passive-tracer volume over the final solved velocity field. The dye moves, but airflow velocity is not currently advanced during playback; it can settle into a stable plume. **Speed volume** and **Slice** show the solved speed field directly.
- Heat advects and diffuses air temperature, relaxes it toward a 20 °C ambient default, applies heater sources, and couples temperature to buoyancy. Outdoor temperature enters only through open-window inflow. The infrared view maps nearby air temperature onto room and object surfaces; it does not calculate material-surface temperature. Heater intensity is an estimated temperature source, **not watts**.
- **Light** is a real-time monochrome render with point lights at lamp bulbs and cast shadows. It is not lux-calibrated and does not model indirect light bounce, glass transmission, or measured lamp output.
- An open window can bias flow toward intake or exhaust, or permit vertically balanced exchange. Fan speeds, thermal sources, and opening flow rates are adjustable estimates rather than calibrated device or opening models. The solver omits a calibrated turbulence closure, no-slip wall treatment, wall/material heat capacity, radiation, HVAC, and reference-case calibration. Do not use its output to claim real-world comfort, temperature, ventilation, lighting, or safety performance.

The scene model is solver-independent (`src/model/room-scene.js`); rendering and field solving consume the same scene without mixing simulation state into object geometry. Scene persistence and schema migration are not implemented.

## Structure

- `src/model/room-scene.js` — room objects and windows, naming, transformations, and geometry bounds.
- `src/model/undo-history.js` — bounded undo/redo history.
- `src/model/editor-state.js` — editor selection, view, transform mode, and reset state.
- `src/simulation/room-fields-webgpu.js` — WebGPU 3D airflow and temperature estimates.
- `src/simulation/room-fields-3d.js` — bounded CPU preview and shared room geometry checks.
- `src/simulation/sun-position.js` — solar altitude, azimuth, sunrise and sunset for the site.
- `src/simulation/daylight.js` — maps a clock time and the scene to sun, sky, lamp, exposure and sun-patch state. Pure, with no three.js.
- `src/simulation/room-light.js` — retained scalar light estimator; the editor's Light mode uses rendered shadows instead.
- `src/simulation/room-field-worker.js` and `src/simulation/room-field-controller.js` — background solving and coalesced live updates.
- `src/scene/room-field-layer-3d.js` and `src/scene/room-field-renderer.js` — 3D tracer advection, infrared surface mapping, and volumetric field rendering.
- `src/scene/room-viewport.js` — Three.js room, model meshes, camera, selection, and transform controls.
- `src/app.js` — editor and simulation controls.
- `tests/` — headless-safe model, solver, and scene-graph tests, run by `npm test`.
- `browser-tests/` — Playwright browser interaction tests, run separately by `npm run test:browser`.
