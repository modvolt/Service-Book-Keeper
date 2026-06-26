import { Router, type IRouter } from "express";
import vehiclesRouter from "./vehicles";
import vehicleImportRouter from "./vehicle-import";
import vehicleCatalogRouter from "./vehicle-catalog";
import serviceRecordsRouter from "./service-records";
import workOrdersRouter, { listWorkOrdersHandler, lookupOpenWorkOrdersForScannerHandler } from "./work-orders";
import materialsRouter, { addWorkOrderMaterialHandler, addMaterialToOpenWorkOrderForScannerHandler } from "./materials";
import scanMaterialsRouter from "./scan-materials";
import dashboardRouter from "./dashboard";
import appointmentsRouter from "./appointments";
import settingsRouter from "./settings";
import aresRouter from "./ares";
import storageRouter from "./storage";
import backupRouter from "./backup";
import gdprRouter from "./gdpr";
import scanHandoffRouter from "./scan-handoff";
import loanersRouter from "./loaners";
import trashRouter from "./trash";
import auditRouter from "./audit";

/**
 * Routes accessible to both admin and scanner sessions (scan workflow).
 * Mounted in app.ts with requireScannerOrAdmin.
 */
export const scannerRouter: IRouter = Router();
scannerRouter.use(vehicleImportRouter);
scannerRouter.use(scanHandoffRouter);
// Material-scan workflow: the scanner looks up the open work order by SPZ, runs
// the AI/QR material scan, and appends the detected materials to that order.
// These are the ONLY work-order/material routes the scanner can reach — every
// other work-order route and the materials catalog CRUD stay admin-only below.
// scannerRouter is mounted before the admin router (app.ts), so scan-materials
// is naturally ahead of workOrdersRouter's "/work-orders/:id" catch-all, and
// these handlers win for both roles (admin reaches them here too).
scannerRouter.use(scanMaterialsRouter);
// GET /work-orders is shared by both roles but role-shaped. scannerRouter is
// mounted before the admin router (app.ts) and an admin also passes
// requireScannerOrAdmin, so this single registration serves BOTH roles — we MUST
// branch here, otherwise the admin would inherit the scanner's scoped behavior
// and lose the full list. Scanner -> scoped, plate-exact, open-only, PII-free
// lookup; admin -> the full list handler.
scannerRouter.get("/work-orders", (req, res) =>
  req.session?.role === "scanner"
    ? lookupOpenWorkOrdersForScannerHandler(req, res)
    : listWorkOrdersHandler(req, res),
);
// POST materials, same dual-role path: scanner -> open-order-only, no catalog
// write; admin -> the full handler (catalog auto-add). Reading a work order's
// materials (GET) stays admin-only — the scan UI never lists them.
scannerRouter.post("/work-orders/:id/materials", (req, res) =>
  req.session?.role === "scanner"
    ? addMaterialToOpenWorkOrderForScannerHandler(req, res)
    : addWorkOrderMaterialHandler(req, res),
);

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
router.use(trashRouter);
router.use(auditRouter);
router.use("/storage", storageRouter);

export default router;
