import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import JSZip from "jszip";

/**
 * The "full backup" bundles the JSON snapshot together with every photo blob
 * into a single ZIP (backup.json + objects/<entityId>). Importing a full ZIP
 * merges the data AND re-uploads the blobs. A photo whose blob is missing from
 * storage is reported, never silently dropped.
 *
 * These tests pin that contract so a full backup is genuinely restorable end to
 * end (data + files), not just the database rows.
 */

const { readObjectToBuffer, restoreObject, objectExists, ObjectNotFoundError } = vi.hoisted(() => ({
  readObjectToBuffer: vi.fn<(url: string) => Promise<Buffer>>(),
  restoreObject: vi.fn<(path: string, body: Buffer, ct: string) => Promise<void>>(),
  objectExists: vi.fn<(url: string) => Promise<boolean>>(),
  ObjectNotFoundError: class ObjectNotFoundError extends Error {},
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({ readObjectToBuffer, restoreObject, objectExists }),
  ObjectNotFoundError,
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import backupRouter from "../backup";
import { __store, seed, photosTable, workOrdersTable } from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: { role: string } }).session = { role: "admin" };
    (req as unknown as { log: unknown }).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(backupRouter);
  return app;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  objectExists.mockResolvedValue(true);
  restoreObject.mockResolvedValue(undefined);
});

describe("GET /backup/full", () => {
  it("bundles backup.json and an objects/ entry for each photo blob", async () => {
    seed(workOrdersTable, [{ id: 10, licensePlate: "1A0 0001", deletedAt: null }]);
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/uploads/a", filename: "a.jpg", deletedAt: null },
    ]);
    readObjectToBuffer.mockResolvedValue(Buffer.from("JPEGDATA"));

    const res = await request(makeApp()).get("/backup/full").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    expect(res.headers["x-missing-objects"]).toBe("0");

    const zip = await JSZip.loadAsync(res.body as Buffer);
    expect(zip.file("backup.json")).toBeTruthy();
    expect(zip.file("objects/uploads/a")).toBeTruthy();
    expect(await zip.file("objects/uploads/a")!.async("string")).toBe("JPEGDATA");
  });

  it("reports photos whose blob is missing from storage", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/uploads/gone", filename: "gone.jpg", deletedAt: null },
    ]);
    readObjectToBuffer.mockRejectedValue(new ObjectNotFoundError("missing"));

    const res = await request(makeApp()).get("/backup/full").buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on("data", (c: Buffer) => chunks.push(c));
      r.on("end", () => cb(null, Buffer.concat(chunks)));
    });

    expect(res.status).toBe(200);
    expect(res.headers["x-missing-objects"]).toBe("1");
    const zip = await JSZip.loadAsync(res.body as Buffer);
    expect(zip.file("objects/uploads/gone")).toBeNull();
    expect(zip.file("MISSING.txt")).toBeTruthy();
  });
});

describe("POST /backup/import-full", () => {
  it("merges backup.json and re-uploads bundled object blobs", async () => {
    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        vehicles: [],
        serviceRecords: [],
        workOrders: [{ id: 10, licensePlate: "1A0 0001" }],
        materialsCatalog: [],
        workOrderMaterials: [],
        photos: [{ id: 1, workOrderId: 10, url: "/objects/uploads/a", filename: "a.jpg" }],
        appointments: [],
        settings: [],
      },
    };
    const zip = new JSZip();
    zip.file("backup.json", JSON.stringify(snapshot));
    zip.file("objects/uploads/a", Buffer.from("JPEGDATA"));
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const res = await request(makeApp())
      .post("/backup/import-full")
      .attach("backup", buf, "backup.zip");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.restoredFiles).toBe(1);
    expect(restoreObject).toHaveBeenCalledExactlyOnceWith(
      "/objects/uploads/a",
      expect.any(Buffer),
      "image/jpeg",
    );
    // Rows were merged into the DB.
    expect(__store.rows("work_orders")).toHaveLength(1);
    expect(__store.rows("photos")).toHaveLength(1);
  });

  it("rejects a file that is not a valid ZIP", async () => {
    const res = await request(makeApp())
      .post("/backup/import-full")
      .attach("backup", Buffer.from("not a zip"), "backup.zip");

    expect(res.status).toBe(400);
    expect(restoreObject).not.toHaveBeenCalled();
  });
});
