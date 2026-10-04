hackathon project

# RoomShift

A 3D room editor for exploring how layout changes affect airflow, temperature, lighting, and Wi-Fi coverage.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed in the terminal. Add or move objects, choose a simulation view, and use the timeline to play or inspect results. Layouts can be saved in the Room menu.

## Checks

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Simulations are approximate and uncalibrated. Surface colors show nearby air temperature, not material temperature.
