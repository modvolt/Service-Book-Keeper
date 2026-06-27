import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * The trash "permanent delete" (purge) must free object storage: it deletes a
 * work order's / photo's image blobs via the storage facade BEFORE removing the
 * DB rows (GDPR erasure ordering). If a blob delete fails the whole purge aborts
 * with 500 and the row survives, so a retry is safe. A vehicle purge owns no
 * blobs (its work orders survive via set-null) and must not touch storage.
 *
 * These tests pin that contract so a future refactor can't silently re-orphan
 * blobs (wasted storage + data that was meant to be erased).
 */

// deleteObject and the ordering ledger are hoisted so the vi.mock factory below
// (which is itself hoisted) can close over them.
const { deleteObject, events } = vi.hoisted(() => ({
  deleteObject: vi.fn<(url: string) => Promise<void>>(),
  events: [] as Array<{ url: string; workOrdersLeft: number; photosLeft: number }>,
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({ deleteObject }),
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import trashRouter from "../trash";
import {
  __store,
  seed,
  vehiclesTable,
  workOrdersTable,
  photosTable,
} from "../../test-support/rel-db/engine";

function makeApp(role: "admin" | "scanner" = "admin"): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: { role: string } }).session = { role };
    next();
  });
  app.use(trashRouter);
  return app;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  events.length = 0;
  // Default: a successful blob delete that records the DB state at call time so
  // tests can assert blobs are removed BEFORE the rows are gone.
  deleteObject.mockImplementation(async (url: string) => {
    events.push({
      url,
      workOrdersLeft: __store.rows("work_orders").length,
      photosLeft: __store.rows("photos").length,
    });
  });
});

describe("DELETE /trash/work_order/:id — frees photo storage", () => {
  it("deletes each photo blob before the DB rows are purged", async () => {
    seed(workOrdersTable, [
      { id: 10, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-03T10:00:00Z") },
    ]);
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg" },
      { id: 2, workOrderId: 10, url: "/objects/b.jpg", filename: "b.jpg" },
    ]);

    const res = await request(makeApp()).delete("/trash/work_order/10");
    expect(res.status).toBe(200);

    // Both blobs were deleted.
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith("/objects/a.jpg");
    expect(deleteObject).toHaveBeenCalledWith("/objects/b.jpg");

    // Ordering: the work order row still existed at the moment each blob was
    // deleted (erasure ordering — blobs first, DB rows after).
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.workOrdersLeft).toBe(1);
    }

    // The DB row is gone now that the purge completed.
    expect(__store.rows("work_orders")).toHaveLength(0);
  });

  it("does not call storage for a work order that has no photos", async () => {
    seed(workOrdersTable, [
      { id: 10, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-03T10:00:00Z") },
    ]);

    const res = await request(makeApp()).delete("/trash/work_order/10");
    expect(res.status).toBe(200);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(__store.rows("work_orders")).toHaveLength(0);
  });

  it("returns 500 and keeps the DB row when a blob delete fails (retry-safe)", async () => {
    seed(workOrdersTable, [
      { id: 10, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-03T10:00:00Z") },
    ]);
    seed(photosTable, [{ id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg" }]);

    deleteObject.mockRejectedValueOnce(new Error("storage down"));

    const res = await request(makeApp()).delete("/trash/work_order/10");
    expect(res.status).toBe(500);

    // The purge aborted: rows survive so the operation can be retried.
    expect(__store.rows("work_orders")).toHaveLength(1);
    expect(__store.rows("photos")).toHaveLength(1);
    // Nothing was purged, so no purge audit entry was written.
    expect(__store.rows("audit_log")).toHaveLength(0);
  });
});

describe("DELETE /trash/photo/:id — frees photo storage", () => {
  it("deletes the photo's blob before the DB row is purged", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg", deletedAt: new Date("2026-01-05T10:00:00Z") },
    ]);

    const res = await request(makeApp()).delete("/trash/photo/1");
    expect(res.status).toBe(200);

    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith("/objects/a.jpg");
    // The photo row still existed when its blob was deleted.
    expect(events).toEqual([{ url: "/objects/a.jpg", workOrdersLeft: 0, photosLeft: 1 }]);

    expect(__store.rows("photos")).toHaveLength(0);
  });

  it("returns 500 and keeps the photo row when the blob delete fails", async () => {
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg", deletedAt: new Date("2026-01-05T10:00:00Z") },
    ]);

    deleteObject.mockRejectedValueOnce(new Error("storage down"));

    const res = await request(makeApp()).delete("/trash/photo/1");
    expect(res.status).toBe(500);
    expect(__store.rows("photos")).toHaveLength(1);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });
});

describe("DELETE /trash/vehicle/:id — owns no blobs", () => {
  it("does not delete any storage blobs (work orders survive via set-null)", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    // A work order + photo that belonged to the vehicle stay intact in storage.
    seed(workOrdersTable, [{ id: 10, licensePlate: "1A0 0001", deletedAt: null }]);
    seed(photosTable, [{ id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg" }]);

    const res = await request(makeApp()).delete("/trash/vehicle/1");
    expect(res.status).toBe(200);

    expect(deleteObject).not.toHaveBeenCalled();
    // The vehicle is purged but its work order + photo blob are untouched.
    expect(__store.rows("vehicles")).toHaveLength(0);
    expect(__store.rows("photos")).toHaveLength(1);
  });
});
