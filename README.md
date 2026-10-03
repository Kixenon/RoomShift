# RoomShift

A browser-based 3D room editor for trying out layout changes before moving furniture or devices.

## Run

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:4173>.

```sh
npm test
npm run build
```

The browser interaction tests use Playwright and a local Chromium-compatible browser. On this machine they default to Brave at `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`; set `ROOMSHIFT_BROWSER` to another browser executable if needed.

## Editor

- Edit room width, depth, and height in meters.
- Add generic boxes, then change their name and visual/semantic model (fan, sofa, bed, desk, table, lamp, heater) independently; choosing a model does not change its box dimensions or name.
- Hover near an object to highlight it; click the object or its list item to select it. Drag the gizmo or edit position, size, and X/Y/Z rotation in the inspector.
- Add windows on room walls and toggle them open to exhaust air and heat. Drag the canvas to orbit in **3D**; **Top** locks the camera vertically; **Ortho** switches the 3D view to orthographic projection.
- Undo with **⌘Z / Ctrl+Z**; redo with **⌘⇧Z / Ctrl+Y**. Use the **i** button in the viewport toolbar for the full shortcut list. A gizmo drag is one undo step.
- **Air** and **Heat** update continuously in the background while selected. Geometry or model edits trigger a fresh estimate; **Light** switches immediately to a real-time shadow preview.
- **From photo** opens an estimator that fills in the room's W/D/H from a photograph. See below.

## Simulation scope and limits

RoomShift includes bounded **3D estimates** to visualize airflow and temperature plus a grayscale lighting preview. It is **not validated CFD**, an engineering-grade thermal model, calibrated photometry, or a safety tool. A Web Worker uses WebGPU compute for airflow and heat; Three.js renders volumetric fields and provides point-light shadow maps for the lighting preview.

- Airflow and heat use a default 0.05 m volume grid, automatically coarsened only as needed to fit 1.5 million cells and WebGPU dimension limits. GPU airflow/heat use 240 steps at 0.01 s with twenty pressure iterations. The solver includes advection, diffusion, pressure projection, a simplified temperature-driven buoyancy term, and box obstacles.
- When WebGPU is unavailable, airflow and heat use a clearly labelled CPU preview at 0.15 m resolution, capped at 38,400 cells. Fields render as 3D volumes; airflow adds streamlines and tracers that fade before they respawn.
- Heat uses advection, effective diffusion, relaxation toward a 20 °C ambient default, and a simple heater source. Source strength is an estimated °C/s term, **not watts**; displayed temperatures are estimates, not measured room temperatures.
- **Light** is a real-time monochrome material render with point lights at lamp bulbs and cast shadows. It is a visual preview, not lux-calibrated photometry; it does not model indirect light bounce, glass transmission, or measured lamp output.
- Closed room walls block flow. An open window creates a simplified one-way exhaust boundary with a small imposed outward velocity and ambient-temperature exchange. It illustrates heat and air leaving, but is not a calibrated opening-flow model. The estimates omit validated turbulence, wall/material heat capacity, radiation, HVAC, and measured calibration. Do not use them to claim real-world comfort, temperature, ventilation, lighting, or safety performance.

The scene model is solver-independent (`src/model/room-scene.js`); rendering and field solving consume the same scene without mixing simulation state into object geometry. Scene persistence and schema migration are not implemented.

## Room dimensions from a photograph

**From photo** in the asset rail estimates the room shell (width, depth, height) from a single photograph and prefills the W/D/H fields. It places no objects; the layout is still yours to arrange.

This is single-view metrology, and it is an **estimate, not a measurement**. What it can and cannot do:

- **Scale comes from you.** The geometry recovers proportions only. Absolute metres require a scale reference, so the panel asks for the camera height, and every dimension is wrong by the same factor if that number is wrong. There is no second reference to cross-check it against.
- **The photo must be taken from outside the room looking in**, with all four floor corners visible — typically from the doorway. A photo taken from inside the room cannot show the fourth corner, and the estimator needs a closed floor rectangle.
- **The horizon is estimated, not detected.** The strongest pair of horizontal junctions is bisected, which is exact only when the ceiling is at twice the camera height. Drag the horizon line to correct it; every dimension inherits its error.
- **One ceiling click cannot identify its wall.** All four readings are geometrically valid, so the panel offers each with its implied height and picks one by assuming a typical ceiling. Choose explicitly if the result looks wrong.
- **Focal length needs converging edges.** A dead-on shot makes opposing edges parallel, the vanishing points vanish, and the focal length falls back to an assumed 65° field of view. That assumption distorts the footprint rather than shifting it uniformly, and the panel says so.
- Rectangular rooms, level camera, no tilt or roll. It will struggle with fisheye lenses, strongly tilted shots, open-plan spaces, and non-rectangular rooms.

It does not detect furniture or build a layout, and it is no help with real-world performance claims.

## Structure

- `src/model/room-scene.js` — room objects and windows, naming, transformations, and geometry bounds.
- `src/model/room-photo-metrics.js` — single-view room metrology: horizon estimation, vanishing points, focal length, floor footprint, and ceiling height. Pure, with no DOM.
- `src/model/undo-history.js` — bounded undo/redo history.
- `src/model/editor-state.js` — editor selection, view, transform mode, and reset state.
- `src/simulation/room-fields-webgpu.js` — WebGPU 3D airflow and temperature estimates.
- `src/simulation/room-fields-3d.js` — bounded CPU preview and shared room geometry checks.
- `src/simulation/room-light.js` — retained scalar light estimator; the editor's Light mode uses rendered shadows instead.
- `src/simulation/room-field-worker.js` and `src/simulation/room-field-controller.js` — background solving and coalesced live updates.
- `src/scene/room-field-layer-3d.js` and `src/scene/room-field-renderer.js` — volumetric field rendering, animated airflow streamlines, and tracers.
- `src/scene/room-viewport.js` — Three.js room, model meshes, camera, selection, and transform controls.
- `src/scene/room-photo-panel.js` — the photograph estimator panel: image loading, row edge energy, point placement, and the live readout.
- `src/app.js` — editor and simulation controls.
- `tests/` — model/solver tests plus Playwright browser interaction, geometry, and map checks.
