import { Router, type IRouter, type Request, type Response } from "express";
import { pipeline } from "stream";
import { ObjectStorageService, ObjectNotFoundError, type StoredObject } from "../lib/storage";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

function streamObject(res: Response, obj: StoredObject): void {
  res.setHeader("Content-Type", obj.contentType);
  res.setHeader(
    "Cache-Control",
    `${obj.visibility === "public" ? "public" : "private"}, max-age=3600`,
  );
  if (obj.size != null) {
    res.setHeader("Content-Length", String(obj.size));
  }

  // Tear down the upstream object-store stream if the client disconnects before
  // the pipe finishes — otherwise S3/GCS sockets can leak until upstream EOF.
  const onClose = (): void => {
    if (!obj.stream.destroyed) {
      obj.stream.destroy();
    }
  };
  res.on("close", onClose);

  pipeline(obj.stream, res, (err) => {
    res.removeListener("close", onClose);
    if (err && !res.headersSent) {
      res.status(500).end();
    }
  });
}

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets. Unconditionally public — no auth or ACL checks.
 */
router.get("/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const obj = await objectStorageService.servePublicObject(filePath);
    if (!obj) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    streamObject(res, obj);
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities. Access is gated by the global requireAuth
 * middleware (single-user app), so any authenticated request is the mechanic.
 */
router.get("/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const obj = await objectStorageService.serveObject(`/objects/${wildcardPath}`);
    streamObject(res, obj);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
