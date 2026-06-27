import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * Deleting a vehicle must cascade-soft-delete its work orders, service records,
 * appointments and loaners (same deletedBy/deleteReason), so nothing is left
 * "live" pointing at a hidden parent and a later cascade restore brings the
 * whole tree back. Backed by the relational in-memory engine so the real
 * update/where/returning logic and audit writes run end-to-end through both the
 * vehicles delete handler and the trash cascade restore.
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

import vehiclesRouter from "../vehicles";
import trashRouter from "../trash";
import {
  __store,
  seed,
  vehiclesTable,
  workOrdersTable,
  serviceRecordsTable,
  loanersTable,
  appointmentsTable,
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
  app.use(vehiclesRouter);
  app.use(trashRouter);
  return app;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

function seedVehicleTree(): void {
  seed(vehiclesTable, [
    { id: 1, licensePlate: "1A0 0001", make: "Skoda", isFleet: false, deletedAt: null },
    { id: 2, licensePlate: "FLEET1", make: "VW", isFleet: true, deletedAt: null },
  ]);
  seed(workOrdersTable, [
    { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: null },
    { id: 11, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: null },
  ]);
  seed(serviceRecordsTable, [{ id: 5, vehicleId: 1, description: "Olej", deletedAt: null }]);
  seed(appointmentsTable, [
    { id: 9, vehicleId: 1, scheduledDate: "2026-02-01", status: "planned", deletedAt: null },
  ]);
  seed(loanersTable, [
    // Attached to the deleted vehicle as the customer vehicle (fleet stays live).
    { id: 3, fleetVehicleId: 2, customerVehicleId: 1, startDate: "2026-01-01", status: "active", deletedAt: null },
  ]);
}

describe("DELETE /vehicles/:id — cascade soft-delete to children", () => {
  it("soft-deletes the vehicle and all its children with the same actor/reason", async () => {
    seedVehicleTree();

    const res = await request(makeApp()).delete("/vehicles/1").send({ reason: "duplicate" });
    expect(res.status).toBe(204);

    const trashed = (rows: Record<string, unknown>[]) =>
      rows.every((r) => r.deletedAt != null && r.deletedBy === "admin" && r.deleteReason === "duplicate");

    expect(__store.rows("vehicles").find((r) => r.id === 1)!.deletedAt).not.toBeNull();
    expect(trashed(__store.rows("work_orders"))).toBe(true);
    expect(trashed(__store.rows("service_records"))).toBe(true);
    expect(trashed(__store.rows("appointments"))).toBe(true);
    expect(trashed(__store.rows("loaners"))).toBe(true);

    // The unrelated fleet vehicle stays live.
    expect(__store.rows("vehicles").find((r) => r.id === 2)!.deletedAt).toBeNull();
  });

  it("audits each cascaded child delete plus the vehicle delete", async () => {
    seedVehicleTree();

    await request(makeApp()).delete("/vehicles/1").send({ reason: "duplicate" });

    const deleted = __store.rows("audit_log").filter((a) => a.action === "entity_deleted");
    // vehicle + 2 work orders + 1 service record + 1 appointment + 1 loaner.
    expect(deleted).toHaveLength(6);
    const entities = deleted.map((a) => a.entity).sort();
    expect(entities).toEqual(
      ["appointment", "loaner", "service_record", "vehicle", "work_order", "work_order"].sort(),
    );
  });

  it("does not touch children already in the trash (keeps their own metadata)", async () => {
    seedVehicleTree();
    // Pre-trash one work order separately, by a different actor/reason.
    const earlier = new Date("2025-12-01T00:00:00Z");
    __store.rows("work_orders").find((r) => r.id === 11)!.deletedAt = earlier;
    __store.rows("work_orders").find((r) => r.id === 11)!.deletedBy = "scanner";
    __store.rows("work_orders").find((r) => r.id === 11)!.deleteReason = "old";

    await request(makeApp()).delete("/vehicles/1").send({ reason: "duplicate" });

    const wo11 = __store.rows("work_orders").find((r) => r.id === 11)!;
    expect(wo11.deletedAt).toEqual(earlier);
    expect(wo11.deletedBy).toBe("scanner");
    expect(wo11.deleteReason).toBe("old");
  });

  it("brings the whole tree back via cascade restore", async () => {
    seedVehicleTree();

    await request(makeApp()).delete("/vehicles/1").send({ reason: "duplicate" });
    const res = await request(makeApp()).post("/trash/vehicle/1/restore").send({ cascade: true });

    expect(res.status).toBe(200);
    // 2 work orders + 1 service record + 1 appointment + 1 loaner.
    expect(res.body.restoredCount).toBe(5);

    expect(__store.rows("vehicles").find((r) => r.id === 1)!.deletedAt).toBeNull();
    expect(__store.rows("work_orders").every((r) => r.deletedAt === null)).toBe(true);
    expect(__store.rows("service_records").every((r) => r.deletedAt === null)).toBe(true);
    expect(__store.rows("appointments").every((r) => r.deletedAt === null)).toBe(true);
    expect(__store.rows("loaners").every((r) => r.deletedAt === null)).toBe(true);
  });

  it("returns 404 and cascades nothing for an unknown vehicle", async () => {
    seedVehicleTree();

    const res = await request(makeApp()).delete("/vehicles/999").send({});
    expect(res.status).toBe(404);
    expect(__store.rows("work_orders").every((r) => r.deletedAt === null)).toBe(true);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });
});
