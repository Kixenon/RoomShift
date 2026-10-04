# RoomShift

A browser-based room editor for comparing layout changes before moving furniture or devices.

## Run

```sh
npm install
npm run dev
npm test
npm run build
```

Open the local URL printed by Vite. Browser checks require Chromium:

```sh
npx playwright install chromium
npm run test:browser
npm run validate:simulation
```

`ROOMSHIFT_BROWSER` selects an existing browser executable. The browser tests request WebGPU; numerical parity is explicitly skipped if no adapter is available. The app automatically falls back to CPU.

## Compare a change

1. Set the room dimensions, initial air temperature, outdoor temperature, and envelope heat-transfer coefficient (W/m² K).
2. Place furniture and devices. Heaters have a power setting in watts; device strength and on/off controls remain independent.
3. Press **Set baseline**, then change the layout. The baseline remains a separate snapshot.
4. Select **Air** or **Heat**. Set an **elapsed time** from 0 to 120 seconds. Expand **Measurement point** to enable its purple marker; its speed, air temperature, and changes from baseline are reported numerically.
5. Repeat at **Fine** detail. A result that changes substantially with resolution is unsuitable for deciding between layouts.
6. Use the **Room ⋯** menu to save, load, delete, or reset layouts and manage a baseline. Save named scenarios to revisit them. The current scene, baseline, and up to twenty named scenarios persist in this browser. Saving the same name replaces that scenario. Unsupported or invalid saved data is ignored.

Time is elapsed since the initial uniformly tempered, stationary air state with the current device/opening configuration. Every geometry, source, or room-physics change starts a fresh experiment. Scrubbing forward continues resident solver state; already computed points are cached. An earlier uncached point starts again from the same initial state. Air and Heat share the same solve. Display scales stay fixed across time and layouts; the temperature scale is adjustable.

The first partial result appears before a long solve finishes. The inspector explicitly shows the time represented by the visible result, room mean temperature, and whether a requested point is still being calculated. Baseline comparisons use the same time and resolution; comparisons across different room/grid dimensions are refused. A point inside an obstacle is reported as obstructed rather than as still air.

**Air** defaults to a speed volume; a static speed slice with direction arrows is also available. The animated Gas view was removed: its dye playback did not evolve the airflow solution or measure ventilation, and consumed substantial rendering work.

Use **⌘Z / Ctrl+Z** to undo and **⌘⇧Z / Ctrl+Y** to redo. Drag the canvas to orbit, or use the camera controls for projection and top/angled views.

## Daylight and lamps

Light preview uses NOAA solar geometry for Hong Kong (22.32° N, 114.17° E, UTC+8). Set the date, local clock, and room heading clockwise from north. At heading zero, -z is north and +x is east.

Direct sunlight is rendered through wall apertures with furniture shadows. Closed glass windows admit light while blocking airflow; closed doors block both. There are no extra floor-patch overlays that bypass furniture occlusion. The **Lamp map** is a separate relative lamp-only estimator; it does not include daylight. Neither view predicts lux, glass transmission, glare, indirect bounce, or measured lamp output.

## Physics and numerical limits

This is an **uncalibrated planning model**. It has numerical regression tests, not real-room validation. Its output cannot yet establish real-world comfort, ventilation performance, or reliable placement rankings.

- Both backends use the same grid, sources, integration order, and twenty warm-started pressure sweeps. The requested cell sizes are 0.075 m (Fine), 0.15 m (Standard), and 0.25 m (Quick). Dimensions are bounded at 80 × 48 × 80 cells; the actual spacing is shown because large rooms coarsen. Standard/Quick step by 0.05 s; Fine steps by 0.02 s. Unsafe explicit-diffusion settings are rejected.
- Velocity advection shares interpolation work across all components and temperature. Pressure applies a velocity correction without repeatedly averaging away the input jet. CPU/GPU parity checks cover a driven room and subzero window inflow, with a 0.001 maximum field-difference tolerance at one second. These are numerical checks, not accuracy claims.
- Furniture rendering, airflow obstacles, fan blockage, and lamp-map shadows share component geometry. Thin pieces conservatively occupy intersected voxels. This can overstate blockage on coarse grids; placement collision checks still use conservative whole-object bounding boxes.
- Fans are a prescribed force distribution with fixed physical extent and voxel-averaged sampling. Their strength is not a measured fan curve. Numerical diffusion, coarse-grid vorticity confinement, slip walls, and incomplete pressure convergence can affect results. Significant boundary-flow imbalance is displayed.
- Heater watts are distributed over surrounding fluid cells and normalized to total power using air density 1.204 kg/m³ and heat capacity 1006 J/(kg K). Heat-source rates are precomputed once per scene. Envelope conduction uses a uniform U-value and outdoor temperature; it omits wall/furniture heat storage, radiation, solar gains, people, humidity, and HVAC. A zero U-value represents an insulated envelope. Surface colors represent nearby air temperature, not material temperature.
- Exchange openings use an approximate hydrostatic pressure head based on the initial indoor/outdoor temperature difference and aperture height; it vanishes when temperatures match. It is not an exterior wind/stack-network model and does not update that head as the room warms. Intake/exhaust modes use prescribed exterior pressure from the wind setting.
- Two resident simulations support current/baseline layouts. Snapshot caches are bounded by count and memory. Cached arrays are copied before transfer to the main thread. Canceled work never replaces a newer result.

## Validation and next evidence

`npm run validate:simulation` prints fan-probe values across grids and times, plus time-step sensitivity. Resolution dependence remains material: changing cell size can substantially change point speed. Fine detail is a check, not proof of convergence.

A three-run alternating test of fused versus separate advection reduced CPU time from 1.38–1.55 s to 0.77–0.88 s for sixty steps, with identical arrays in the tested fan-only case. Those timings isolate the advection optimization at that stage; later physics changes mean they are not an end-to-end prediction for every room. Grid/time settings and GPU availability also affect latency.

Before claiming predictive usefulness, measure one specific decision: for example, fan orientation at a seated position. Record fan dimensions/settings, room and furniture geometry, opening conditions, and repeated air-speed measurements at several points. Compare predicted **changes and rankings**, reserve some layouts for validation, and repeat at finer grids and smaller time steps. Thermal validation additionally needs measured power, starting temperatures, envelope properties, and a time series. Those measurement datasets are not included in this repository.

## Structure

- `src/model/` — scene edits, shared furniture parts, collision bounds, undo, and saved-workspace validation.
- `src/simulation/room-fields-3d.js` and `room-fields-webgpu.js` — reusable numerical sessions.
- `src/simulation/room-field-backend.js`, `room-field-worker.js`, and `room-field-controller.js` — bounded caches, progress, cancellation, and display requests.
- `src/simulation/room-field-analysis.js` — measurement-point sampling and matched comparisons.
- `src/simulation/daylight.js`, `sun-position.js`, and `room-light.js` — solar geometry and relative lamp estimates.
- `src/scene/` — viewport, slices, volumes, and air-temperature surface mapping.
- `tests/` and `browser-tests/` — numerical/model regressions and browser workflows.

## Devices from main

The starter room includes a router, ceiling fan with light, wall-mounted AC, window, and door. Wi-Fi has volume and slice views; its propagation model estimates distance loss and obstruction attenuation, not measured coverage. AC uses a default 1500 W cooling source scaled by its output setting; heating and cooling share the same power-normalized CPU/GPU source calculation.
