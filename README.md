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

## App

- **Rooms page** (Drive-style): templates, search, sort, grid/list, multi-select duplicate / download / delete, autosave in the browser, import/export room files.
- **Editor**: full-bleed 3D room with floating panels, ⌘K command palette (type `sofa 210x90x80` to add at an exact size), keyboard shortcuts (`?`), view cube, light/dark theme, drag-to-place dock, resize handles, L-shaped and rounded rooms, per-object colour, material, size presets and real-unit intensity (W, lm, dB, dBm, fan speed), doors and windows that open.
- **Five lenses**: Air (WebGPU Navier–Stokes with advected particles, BS 5925 ventilation), Heat (buoyant heat field + steady-state heat balance with solar gain and running cost), Light (sun position for city/date/time, lux volume with bounce light), WiFi (ITU-R P.1238 + material losses) and Sound (Eyring RT60 + direct/diffuse level). Hover to trace the level back to its source; click to pin live measurements.
- **Livability**: walkway, door-swing, clearance, daylight, WiFi and comfort checks with a score, plus a simulated-annealing layout suggestion that respects locked objects.
- **Capture**: room size from a photo (corner clicks), on-device furniture detection and classification (TensorFlow.js), Claude AI room scan and shop-link product import (bring your own API key, browser only), Polycam / RoomPlan 3D-scan import (GLB, OBJ, USDZ, PLY), and floor-plan underlays.
- **Share**: layout variants with side-by-side comparison, printable room report, USDZ (iPhone AR Quick Look) and GLB export.
- **Room drawing**: any outline with snapping and typed edge lengths, interior walls (drywall, brick, glass) with doorways that the airflow, WiFi, sound, light and walkway checks all respect.
- **Furniture**: parametric styles per type (table tops and legs, sofa arms and chaise, headboards, chair kinds, wardrobe doors, shelf kinds, lamp kinds, TV mounts, fridge layouts) with main and frame colours; photo detection reads proportions, colours and leg style; doors (angle, hinge, swing), windows (sliding, casement, top-hung, fixed, open amount, coverings), fans (head yaw, tilt, oscillation), AC louver.
- **More physics**: radiosity bounce light and a lux map on surfaces, image-source sound reflections, ISO 7730 comfort at seats, façade noise against the WHO night guideline, direct sun hours, sun patches as heat sources.
- **Guidance**: eight-category livability analysis with a clearance overlay, guided plans for five personas, a measuring tape (M), combinable lenses (Shift-click).

## Simulation scope and limits

RoomShift includes bounded **3D estimates** to visualize airflow and temperature plus a grayscale lighting preview. It is **not validated CFD**, an engineering-grade thermal model, calibrated photometry, or a safety tool. A Web Worker uses WebGPU compute for airflow and heat; Three.js renders volumetric fields and provides point-light shadow maps for the lighting preview.

- Airflow and heat use a default 0.05 m volume grid, automatically coarsened only as needed to fit 1.5 million cells and WebGPU dimension limits. GPU airflow/heat use 240 steps at 0.01 s with twenty pressure iterations. The solver includes advection, diffusion, pressure projection, a simplified temperature-driven buoyancy term, and box obstacles.
- When WebGPU is unavailable, airflow and heat use a clearly labelled CPU preview at 0.15 m resolution, capped at 38,400 cells. Fields render as 3D volumes; airflow adds streamlines and tracers that fade before they respawn.
- Heat uses advection, effective diffusion, relaxation toward a 20 °C ambient default, and a simple heater source. Source strength is an estimated °C/s term, **not watts**; displayed temperatures are estimates, not measured room temperatures.
- **Light** is a real-time monochrome material render with point lights at lamp bulbs and cast shadows. It is a visual preview, not lux-calibrated photometry; it does not model indirect light bounce, glass transmission, or measured lamp output.
- Closed room walls block flow. An open window creates a simplified one-way exhaust boundary with a small imposed outward velocity and ambient-temperature exchange. It illustrates heat and air leaving, but is not a calibrated opening-flow model. The estimates omit validated turbulence, wall/material heat capacity, radiation, HVAC, and measured calibration. Do not use them to claim real-world comfort, temperature, ventilation, lighting, or safety performance.

The scene model is solver-independent (`src/model/room-scene.js`); rendering and field solving consume the same scene without mixing simulation state into object geometry. Scenes persist per browser (localStorage) and migrate on load via `normalizeScene`.

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
