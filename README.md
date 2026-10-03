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
- `src/simulation/room-light.js` — retained scalar light estimator; the editor's Light mode uses rendered shadows instead.
- `src/simulation/room-field-worker.js` and `src/simulation/room-field-controller.js` — background solving and coalesced live updates.
- `src/scene/room-field-layer-3d.js` and `src/scene/room-field-renderer.js` — 3D tracer advection, infrared surface mapping, and volumetric field rendering.
- `src/scene/room-viewport.js` — Three.js room, model meshes, camera, selection, and transform controls.
- `src/app.js` — editor and simulation controls.
- `tests/` — headless-safe model, solver, and scene-graph tests, run by `npm test`.
- `browser-tests/` — Playwright browser interaction tests, run separately by `npm run test:browser`.
