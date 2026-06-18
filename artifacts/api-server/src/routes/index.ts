import { Router, type IRouter } from "express";
import vehiclesRouter from "./vehicles";
import vehicleImportRouter from "./vehicle-import";
import vehicleCatalogRouter from "./vehicle-catalog";
import serviceRecordsRouter from "./service-records";
import workOrdersRouter from "./work-orders";
import materialsRouter from "./materials";
import dashboardRouter from "./dashboard";
import appointmentsRouter from "./appointments";
import settingsRouter from "./settings";
import aresRouter from "./ares";
import storageRouter from "./storage";
import backupRouter from "./backup";
import gdprRouter from "./gdpr";
import scanHandoffRouter from "./scan-handoff";
import loanersRouter from "./loaners";

/**
 * Routes accessible to both admin and scanner sessions (scan workflow).
 * Mounted in app.ts with requireScannerOrAdmin.
 */
export const scannerRouter: IRouter = Router();
scannerRouter.use(vehicleImportRouter);
scannerRouter.use(scanHandoffRouter);

/**
 * Admin-only routes — the full application minus the scanner-accessible ones.
 * Mounted in app.ts with requireAdmin.
 */
const router: IRouter = Router();
router.use(vehicleCatalogRouter);
router.use(vehiclesRouter);
router.use(serviceRecordsRouter);
router.use(workOrdersRouter);
router.use(materialsRouter);
router.use(dashboardRouter);
router.use(appointmentsRouter);
router.use(settingsRouter);
router.use(aresRouter);
router.use(backupRouter);
router.use(gdprRouter);
router.use(loanersRouter);
router.use("/storage", storageRouter);

export default router;
