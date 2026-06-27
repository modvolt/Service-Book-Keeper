import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * Deleting a work order on its own must cascade-soft-delete its photos and any
 * loaner linked via workOrderId (same deletedBy/deleteReason), so nothing is
 * left "live" pointing at a hidden parent and a later cascade restore brings the
 * whole subtree back. Mirrors the vehicle cascade test, backed by the relational
 * in-memory engine so the real update/where/returning logic and audit writes run
 * end-to-end through both the work-orders delete handler and the trash cascade
 * restore.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/vehicleStatus", () => ({
  recomputeVehicleServiceStatus: vi.fn(async () => {}),
}));

vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({
    uploadPrivateObject: vi.fn(async () => "/objects/test-photo"),
    deleteObject: vi.fn(async () => {}),
  }),
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import workOrdersRouter from "../work-orders";
import trashRouter from "../trash";
import {
  __store,
  seed,
  vehiclesTable,
  workOrdersTable,
  photosTable,
  loanersTable,
} from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { session: { role: string }; log: Record<string, unknown> }).session = {
      role: "admin",
    };
    (req as unknown as { log: Record<string, unknown> }).log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    next();
  });
  app.use(workOrdersRouter);
  app.use(trashRouter);
  return app;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

function seedWorkOrderTree(): void {
  seed(vehiclesTable, [
    { id: 1, licensePlate: "1A0 0001", make: "Skoda", isFleet: false, deletedAt: null },
    { id: 2, licensePlate: "FLEET1", make: "VW", isFleet: true, deletedAt: null },
  ]);
  seed(workOrdersTable, [
    { id: 10, vehicleId: 1, licensePlate: "1A0 0001", status: "open", deletedAt: null },
    { id: 11, vehicleId: 1, licensePlate: "1A0 0001", status: "open", deletedAt: null },
  ]);
  seed(photosTable, [
    { id: 100, workOrderId: 10, url: "/objects/p100", filename: "a.jpg", deletedAt: null },
    { id: 101, workOrderId: 10, url: "/objects/p101", filename: "b.jpg", deletedAt: null },
    // Belongs to the other work order — must stay live.
    { id: 102, workOrderId: 11, url: "/objects/p102", filename: "c.jpg", deletedAt: null },
  ]);
  seed(loanersTable, [
    // Loaner linked to the deleted work order (fleet vehicle stays live).
    { id: 3, fleetVehicleId: 2, workOrderId: 10, startDate: "2026-01-01", status: "active", deletedAt: null },
    // Loaner linked to the other work order — must stay live.
    { id: 4, fleetVehicleId: 2, workOrderId: 11, startDate: "2026-01-01", status: "active", deletedAt: null },
  ]);
}

describe("DELETE /work-orders/:id — cascade soft-delete to children", () => {
  it("soft-deletes the work order and its photos/loaner with the same actor/reason", async () => {
    seedWorkOrderTree();

    const res = await request(makeApp()).delete("/work-orders/10").send({ reason: "duplicate" });
    expect(res.status).toBe(204);

    const wo10 = __store.rows("work_orders").find((r) => r.id === 10)!;
    expect(wo10.deletedAt).not.toBeNull();
    expect(wo10.deletedBy).toBe("admin");
    expect(wo10.deleteReason).toBe("duplicate");

    const trashed = (r: Record<string, unknown>) =>
      r.deletedAt != null && r.deletedBy === "admin" && r.deleteReason === "duplicate";

    expect(trashed(__store.rows("photos").find((r) => r.id === 100)!)).toBe(true);
    expect(trashed(__store.rows("photos").find((r) => r.id === 101)!)).toBe(true);
    expect(trashed(__store.rows("loaners").find((r) => r.id === 3)!)).toBe(true);

    // The other work order and its children stay live.
    expect(__store.rows("work_orders").find((r) => r.id === 11)!.deletedAt).toBeNull();
    expect(__store.rows("photos").find((r) => r.id === 102)!.deletedAt).toBeNull();
    expect(__store.rows("loaners").find((r) => r.id === 4)!.deletedAt).toBeNull();
  });

  it("audits each cascaded child delete plus the work order delete", async () => {
    seedWorkOrderTree();

    await request(makeApp()).delete("/work-orders/10").send({ reason: "duplicate" });

    const deleted = __store.rows("audit_log").filter((a) => a.action === "entity_deleted");
    // work order + 2 photos + 1 loaner.
    expect(deleted).toHaveLength(4);
    const entities = deleted.map((a) => a.entity).sort();
    expect(entities).toEqual(["loaner", "photo", "photo", "work_order"].sort());
  });

  it("does not touch children already in the trash (keeps their own metadata)", async () => {
    seedWorkOrderTree();
    // Pre-trash one photo separately, by a different actor/reason.
    const earlier = new Date("2025-12-01T00:00:00Z");
    const p101 = __store.rows("photos").find((r) => r.id === 101)!;
    p101.deletedAt = earlier;
    p101.deletedBy = "scanner";
    p101.deleteReason = "old";

    await request(makeApp()).delete("/work-orders/10").send({ reason: "duplicate" });

    const after = __store.rows("photos").find((r) => r.id === 101)!;
    expect(after.deletedAt).toEqual(earlier);
    expect(after.deletedBy).toBe("scanner");
    expect(after.deleteReason).toBe("old");
  });

  it("brings the photos/loaner back via cascade restore", async () => {
    seedWorkOrderTree();

    await request(makeApp()).delete("/work-orders/10").send({ reason: "duplicate" });
    const res = await request(makeApp()).post("/trash/work_order/10/restore").send({ cascade: true });

    expect(res.status).toBe(200);
    // 2 photos + 1 loaner.
    expect(res.body.restoredCount).toBe(3);

    expect(__store.rows("work_orders").find((r) => r.id === 10)!.deletedAt).toBeNull();
    expect(__store.rows("photos").find((r) => r.id === 100)!.deletedAt).toBeNull();
    expect(__store.rows("photos").find((r) => r.id === 101)!.deletedAt).toBeNull();
    expect(__store.rows("loaners").find((r) => r.id === 3)!.deletedAt).toBeNull();
  });

  it("returns 404 and cascades nothing for an unknown work order", async () => {
    seedWorkOrderTree();

    const res = await request(makeApp()).delete("/work-orders/999").send({});
    expect(res.status).toBe(404);
    expect(__store.rows("photos").every((r) => r.deletedAt === null)).toBe(true);
    expect(__store.rows("loaners").every((r) => r.deletedAt === null)).toBe(true);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });
});
