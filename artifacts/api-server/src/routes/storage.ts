import { Router, type IRouter, type Request, type Response, json } from "express";
import { pipeline } from "stream";
import { z } from "zod";
import { db, photosTable } from "@workspace/db";
import { getObjectStorageService, ObjectNotFoundError, type StoredObject } from "../lib/storage";
import { audit } from "../lib/audit";
import { getActor } from "../lib/actor";
import { mapLimit } from "../lib/concurrency";

const router: IRouter = Router();
const objectStorageService = getObjectStorageService();

// Photo blobs always live under this private prefix (see uploadPrivateObject).
// Orphan detection is scoped to it so we never flag backups/ objects.
const UPLOADS_PREFIX = "uploads/";

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

/**
 * GET /storage/integrity
 *
 * Cross-reference photo DB rows against the storage backend. Reports photo rows
 * whose object is missing from storage, and (where the driver can enumerate
 * objects) stored upload objects that no photo row references (orphans). Read-
 * only; admin-only via the mounting middleware.
 */
router.get("/integrity", async (req: Request, res: Response): Promise<void> => {
  try {
    const photos = await db
      .select({
        id: photosTable.id,
        url: photosTable.url,
        filename: photosTable.filename,
        workOrderId: photosTable.workOrderId,
        deletedAt: photosTable.deletedAt,
      })
      .from(photosTable);

    const presence = await mapLimit(photos, 8, (p) => objectStorageService.objectExists(p.url));
    const missingObjects = photos
      .filter((_, i) => !presence[i])
      .map((p) => ({
        photoId: p.id,
        url: p.url,
        filename: p.filename,
        workOrderId: p.workOrderId,
        deleted: p.deletedAt != null,
      }));

    let orphanScanSupported = objectStorageService.canListObjects();
    let orphanObjects: string[] = [];
    if (orphanScanSupported) {
      try {
        const stored = await objectStorageService.listObjects(UPLOADS_PREFIX);
        const referenced = new Set(photos.map((p) => p.url));
        orphanObjects = stored.filter((path) => !referenced.has(path));
      } catch (err) {
        // Some S3-compatible providers withhold the list permission; degrade
        // gracefully rather than failing the whole integrity report.
        req.log.warn({ err }, "Orphan scan unavailable (listing denied)");
        orphanScanSupported = false;
      }
    }

    res.json({
      checkedPhotos: photos.length,
      missingObjects,
      orphanScanSupported,
      orphanObjects,
    });
  } catch (err) {
    req.log.error({ err }, "Storage integrity check failed");
    res.status(500).json({ error: "Kontrola souborů selhala" });
  }
});

const CleanupBody = z.object({
  paths: z.array(z.string()).min(1),
});

/**
 * POST /storage/integrity/cleanup
 *
 * Delete confirmed orphan upload objects. Guarded: each path must be under the
 * uploads/ prefix AND not referenced by any photo row, or it is refused. Audits
 * the outcome.
 */
router.post(
  "/integrity/cleanup",
  json({ limit: "1mb" }),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CleanupBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Neplatný seznam souborů" });
      return;
    }

    if (!objectStorageService.canListObjects()) {
      res.status(409).json({ error: "Úložiště nepodporuje výpis souborů" });
      return;
    }

    try {
      const referenced = new Set(
        (await db.select({ url: photosTable.url }).from(photosTable)).map((r) => r.url),
      );

      const deleted: string[] = [];
      const refused: string[] = [];
      const failed: string[] = [];

      for (const path of parsed.data.paths) {
        const isUpload = path.startsWith(`/objects/${UPLOADS_PREFIX}`);
        if (!isUpload || referenced.has(path)) {
          refused.push(path);
          continue;
        }
        try {
          await objectStorageService.deleteObject(path);
          deleted.push(path);
        } catch (err) {
          req.log.error({ err, path }, "Orphan cleanup delete failed");
          failed.push(path);
        }
      }

      if (deleted.length > 0) {
        await audit("storage_orphans_cleaned", {
          actor: getActor(req),
          detail: `Smazáno ${deleted.length} osamocených souborů`,
          snapshot: { deleted },
        });
      }

      res.json({ deleted, refused, failed });
    } catch (err) {
      req.log.error({ err }, "Storage orphan cleanup failed");
      res.status(500).json({ error: "Vyčištění souborů selhalo" });
    }
  },
);

export default router;
