import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getReadiness } from "../lib/readiness";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const readiness = getReadiness();
  const data = HealthCheckResponse.parse({
    status: readiness.ready ? "ok" : "starting",
    ready: readiness.ready,
    database: readiness.database,
    storage: readiness.storage,
  });
  // 200 only once every dependency is reachable, so the platform's startup
  // probe keeps polling (instead of cutting over) while we're still warming up.
  res.status(readiness.ready ? 200 : 503).json(data);
});

export default router;
