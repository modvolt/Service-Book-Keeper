import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * GET /storage/integrity cross-references photo rows against the storage backend:
 * it reports photo rows whose object is missing AND (where the driver can list
 * objects) stored upload objects no photo references (orphans). POST
 * /storage/integrity/cleanup deletes confirmed orphans only — it refuses any path
 * that is outside uploads/ or still referenced by a photo row, and audits the run.
 *
 * These tests pin that contract so the integrity report stays trustworthy and the
 * guarded cleanup can never delete a live photo's blob.
 */

const { objectExists, canListObjects, listObjects, deleteObject } = vi.hoisted(() => ({
  objectExists: vi.fn<(url: string) => Promise<boolean>>(),
  canListObjects: vi.fn<() => boolean>(),
  listObjects: vi.fn<(prefix: string) => Promise<string[]>>(),
  deleteObject: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({ objectExists, canListObjects, listObjects, deleteObject }),
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import storageRouter from "../storage";
import { __store, seed, photosTable } from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: { role: string } }).session = { role: "admin" };
    (req as unknown as { log: unknown }).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use("/storage", storageRouter);
  return app;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  canListObjects.mockReturnValue(true);
  objectExists.mockResolvedValue(true);
  listObjects.mockResolvedValue([]);
  deleteObject.mockResolvedValue(undefined);
});

describe("GET /storage/integrity", () => {
  it("reports photo rows whose object is missing from storage", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/uploads/a", filename: "a.jpg", deletedAt: null },
      { id: 2, workOrderId: 10, url: "/objects/uploads/b", filename: "b.jpg", deletedAt: null },
    ]);
    objectExists.mockImplementation(async (url: string) => url !== "/objects/uploads/b");

    const res = await request(makeApp()).get("/storage/integrity");
    expect(res.status).toBe(200);
    expect(res.body.checkedPhotos).toBe(2);
    expect(res.body.missingObjects).toEqual([
      { photoId: 2, url: "/objects/uploads/b", filename: "b.jpg", workOrderId: 10, deleted: false },
    ]);
  });

  it("lists stored objects no photo references as orphans", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/uploads/a", filename: "a.jpg", deletedAt: null },
    ]);
    listObjects.mockResolvedValue(["/objects/uploads/a", "/objects/uploads/orphan"]);

    const res = await request(makeApp()).get("/storage/integrity");
    expect(res.status).toBe(200);
    expect(res.body.orphanScanSupported).toBe(true);
    expect(res.body.orphanObjects).toEqual(["/objects/uploads/orphan"]);
  });

  it("degrades gracefully when the driver can't list objects", async () => {
    canListObjects.mockReturnValue(false);
    const res = await request(makeApp()).get("/storage/integrity");
    expect(res.status).toBe(200);
    expect(res.body.orphanScanSupported).toBe(false);
    expect(res.body.orphanObjects).toEqual([]);
    expect(listObjects).not.toHaveBeenCalled();
  });
});

describe("POST /storage/integrity/cleanup", () => {
  it("deletes confirmed orphans and audits the run", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/uploads/keep", filename: "keep.jpg", deletedAt: null },
    ]);

    const res = await request(makeApp())
      .post("/storage/integrity/cleanup")
      .send({ paths: ["/objects/uploads/orphan"] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual(["/objects/uploads/orphan"]);
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith("/objects/uploads/orphan");
    expect(__store.rows("audit_log")).toHaveLength(1);
  });

  it("refuses paths that are referenced by a photo row", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/uploads/keep", filename: "keep.jpg", deletedAt: null },
    ]);

    const res = await request(makeApp())
      .post("/storage/integrity/cleanup")
      .send({ paths: ["/objects/uploads/keep"] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toEqual([]);
    expect(res.body.refused).toEqual(["/objects/uploads/keep"]);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(__store.rows("audit_log")).toHaveLength(0);
  });

  it("refuses paths outside the uploads/ prefix", async () => {
    const res = await request(makeApp())
      .post("/storage/integrity/cleanup")
      .send({ paths: ["/objects/backups/something"] });

    expect(res.status).toBe(200);
    expect(res.body.refused).toEqual(["/objects/backups/something"]);
    expect(deleteObject).not.toHaveBeenCalled();
  });
});
