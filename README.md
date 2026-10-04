hackathon project

# RoomShift

Test changes to a room before making them in real life.

Supports airflow, temperature, lighting, and Wi-Fi coverage simulations.

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

## Launch site and deck

`npm run site` serves the launch site at <http://127.0.0.1:4173/site/>, with the product page and the presentation deck at `/site/slides/`. Scripts in `site/scripts/` regenerate the renders and orbit clips from the editor and solver.
