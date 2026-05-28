import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vehiclesRouter from "./vehicles";
import serviceRecordsRouter from "./service-records";
import workOrdersRouter from "./work-orders";
import dashboardRouter from "./dashboard";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vehiclesRouter);
router.use(serviceRecordsRouter);
router.use(workOrdersRouter);
router.use(dashboardRouter);
router.use("/storage", storageRouter);

export default router;
