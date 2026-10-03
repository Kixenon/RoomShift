import { app } from './app.js';
import { installAiScan } from './features/ai-scan.js';
import { installScanImport } from './features/scan-import.js';
import { installFloorPlan } from './features/floor-plan.js';
import { installVariants } from './features/variants.js';
import { installReport } from './features/report.js';
import { installArExport } from './features/ar-export.js';
import { installRoomDrawer } from './features/room-drawer.js';
import { installMeasure } from './features/measure.js';
import { installJourneys } from './features/journeys.js';

for (const install of [installAiScan, installScanImport, installFloorPlan, installVariants, installReport, installArExport, installRoomDrawer, installMeasure, installJourneys]) install(app);
app.boot();
