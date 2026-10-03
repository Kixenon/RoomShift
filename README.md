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
- Add windows on room walls and toggle them open to exhaust air and heat. Drag the canvas to orbit in **3D**; **Top** locks the camera vertically; **Ortho** switches the 3D view to orthographic projection.
- Undo with **⌘Z / Ctrl+Z**; redo with **⌘⇧Z / Ctrl+Y**. Use the **i** button in the viewport toolbar for the full shortcut list. A gizmo drag is one undo step.
- **Air** and **Heat** update continuously in the background while selected. Geometry or model edits trigger a fresh estimate; **Light** switches immediately to a real-time shadow preview.

## Simulation scope and limits

RoomShift includes bounded **3D estimates** to visualize airflow and temperature plus a grayscale lighting preview. It is **not validated CFD**, an engineering-grade thermal model, calibrated photometry, or a safety tool. A Web Worker uses WebGPU compute for airflow and heat; Three.js renders volumetric fields and provides point-light shadow maps for the lighting preview.

- Airflow and heat use a default 0.05 m volume grid, automatically coarsened only as needed to fit 1.5 million cells and WebGPU dimension limits. GPU airflow/heat use 240 steps at 0.01 s with twenty pressure iterations. The solver includes advection, diffusion, pressure projection, a simplified temperature-driven buoyancy term, and box obstacles.
- When WebGPU is unavailable, airflow and heat use a clearly labelled CPU preview at 0.15 m resolution, capped at 38,400 cells. Fields render as 3D volumes; airflow adds streamlines and tracers that fade before they respawn.
- Heat uses advection, effective diffusion, relaxation toward a 20 °C ambient default, and a simple heater source. Source strength is an estimated °C/s term, **not watts**; displayed temperatures are estimates, not measured room temperatures.
- **Light** is a real-time monochrome material render with point lights at lamp bulbs and cast shadows. It is a visual preview, not lux-calibrated photometry; it does not model indirect light bounce, glass transmission, or measured lamp output.
- Closed room walls block flow. An open window creates a simplified one-way exhaust boundary with a small imposed outward velocity and ambient-temperature exchange. It illustrates heat and air leaving, but is not a calibrated opening-flow model. The estimates omit validated turbulence, wall/material heat capacity, radiation, HVAC, and measured calibration. Do not use them to claim real-world comfort, temperature, ventilation, lighting, or safety performance.

The scene model is solver-independent (`src/model/room-scene.js`); rendering and field solving consume the same scene without mixing simulation state into object geometry. Scene persistence and schema migration are not implemented.

## Structure

- `src/model/room-scene.js` — room objects and windows, naming, transformations, and geometry bounds.
- `src/model/undo-history.js` — bounded undo/redo history.
- `src/model/editor-state.js` — editor selection, view, transform mode, and reset state.
- `src/simulation/room-fields-webgpu.js` — WebGPU 3D airflow and temperature estimates.
- `src/simulation/room-fields-3d.js` — bounded CPU preview and shared room geometry checks.
- `src/simulation/room-light.js` — retained scalar light estimator; the editor's Light mode uses rendered shadows instead.
- `src/simulation/room-field-worker.js` and `src/simulation/room-field-controller.js` — background solving and coalesced live updates.
- `src/scene/room-field-layer-3d.js` and `src/scene/room-field-renderer.js` — volumetric field rendering, animated airflow streamlines, and tracers.
- `src/scene/room-viewport.js` — Three.js room, model meshes, camera, selection, and transform controls.
- `src/app.js` — editor and simulation controls.
- `tests/` — headless-safe model, solver, and scene-graph tests, run by `npm test`.
- `browser-tests/` — Playwright browser interaction tests, run separately by `npm run test:browser`.

## Launch site and deck

`npm run site` serves the launch site at <http://127.0.0.1:4173/site/>, with the product page, the experiment (`evidence.html`), the business case (`business.html`), and the presentation deck at `/site/slides/` (add `?pitch` for the shorter pitch cut). Scripts in `site/scripts/` regenerate the renders, orbit clips and experiment data from the editor and solver.

## Credits

Built at HacKU 2026. Open-source libraries and assets: [Three.js](https://threejs.org) (MIT), [GSAP](https://gsap.com) (GSAP standard licence), [Vite](https://vite.dev) (MIT), [Playwright](https://playwright.dev) (Apache-2.0), and the [Archivo](https://fonts.google.com/specimen/Archivo) typeface (SIL Open Font License).
