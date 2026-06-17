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
  // 200 once the REQUIRED dependencies are reachable (database). Storage status is
  // still reported in the body but does not gate the probe: the platform's startup
  // probe keeps polling (503) only while the DB is still warming up, and a degraded
  // object store no longer makes the proxy refuse to route the whole site.
  res.status(readiness.ready ? 200 : 503).json(data);
});

export default router;
