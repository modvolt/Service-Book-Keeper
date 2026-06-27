import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * Trash routes list/restore/purge soft-deleted rows across every business
 * entity and audit each action. Backed by the relational in-memory engine so
 * the real isNotNull/where/orderBy logic and the audit writes are exercised.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
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
  serviceRecordsTable,
  loanersTable,
  appointmentsTable,
  photosTable,
  auditLogTable,
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
});

describe("GET /trash", () => {
  it("returns only soft-deleted rows, newest deletion first, across entities", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z"), deletedBy: "admin", deleteReason: "duplicate" },
      { id: 2, licensePlate: "2B0 0002", deletedAt: null },
    ]);
    seed(workOrdersTable, [
      { id: 10, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-03T10:00:00Z") },
    ]);

    const res = await request(makeApp()).get("/trash");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    // Newest deletion (work order, Jan 3) first.
    expect(res.body[0]).toMatchObject({ entity: "work_order", id: 10 });
    expect(res.body[1]).toMatchObject({
      entity: "vehicle",
      id: 1,
      deletedBy: "admin",
      deleteReason: "duplicate",
    });
  });

  it("returns an empty list when nothing is trashed", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: null }]);
    const res = await request(makeApp()).get("/trash");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /trash/:entity/:id/restore", () => {
  it("clears the soft-delete flags and writes a restore audit entry", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z"), deletedBy: "admin", deleteReason: "oops" },
    ]);

    const res = await request(makeApp()).post("/trash/vehicle/1/restore");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const [row] = __store.rows("vehicles");
    expect(row.deletedAt).toBeNull();
    expect(row.deletedBy).toBeNull();
    expect(row.deleteReason).toBeNull();

    const audits = __store.rows("audit_log");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "entity_restored", entity: "vehicle", entityId: "1", actor: "admin" });
  });

  it("returns 404 for an unknown entity type", async () => {
    const res = await request(makeApp()).post("/trash/widget/1/restore");
    expect(res.status).toBe(404);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });

  it("returns 404 for a non-numeric id", async () => {
    const res = await request(makeApp()).post("/trash/vehicle/abc/restore");
    expect(res.status).toBe(404);
  });

  it("returns 404 when the row is not actually trashed", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: null }]);
    const res = await request(makeApp()).post("/trash/vehicle/1/restore");
    expect(res.status).toBe(404);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });
});

describe("POST /trash/:entity/:id/restore — parent still in trash (no orphans)", () => {
  it("blocks restoring a work order whose parent vehicle is still trashed", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z"), deletedBy: "admin" },
    ]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/work_order/10/restore");
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("vozidlo");

    // Still trashed, no audit entry written.
    const [order] = __store.rows("work_orders");
    expect(order.deletedAt).not.toBeNull();
    expect(__store.rows("audit_log")).toHaveLength(0);
  });

  it("restores a work order once its parent vehicle is live again", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: null }]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/work_order/10/restore");
    expect(res.status).toBe(200);
    const [order] = __store.rows("work_orders");
    expect(order.deletedAt).toBeNull();
    expect(__store.rows("audit_log")[0]).toMatchObject({ action: "entity_restored", entity: "work_order" });
  });

  it("allows restoring a work order with no parent vehicle (vehicleId null)", async () => {
    seed(workOrdersTable, [
      { id: 10, vehicleId: null, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/work_order/10/restore");
    expect(res.status).toBe(200);
    expect(__store.rows("work_orders")[0].deletedAt).toBeNull();
  });

  it("blocks restoring a service record whose parent vehicle is still trashed", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(serviceRecordsTable, [
      { id: 5, vehicleId: 1, description: "Olej", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/service_record/5/restore");
    expect(res.status).toBe(409);
    expect(__store.rows("service_records")[0].deletedAt).not.toBeNull();
    expect(__store.rows("audit_log")).toHaveLength(0);
  });

  it("blocks restoring a photo whose parent work order is still trashed", async () => {
    seed(workOrdersTable, [
      { id: 10, vehicleId: null, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(photosTable, [
      { id: 7, workOrderId: 10, url: "/objects/x", filename: "a.jpg", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/photo/7/restore");
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("zakázka");
    expect(__store.rows("photos")[0].deletedAt).not.toBeNull();
  });

  it("blocks restoring a loaner whose fleet vehicle is still trashed", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "FLEET1", isFleet: true, deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(loanersTable, [
      { id: 3, fleetVehicleId: 1, startDate: "2026-01-01", status: "active", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/loaner/3/restore");
    expect(res.status).toBe(409);
    expect(__store.rows("loaners")[0].deletedAt).not.toBeNull();
  });

  it("blocks restoring a loaner whose linked work order is still trashed", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "FLEET1", isFleet: true, deletedAt: null }]);
    seed(workOrdersTable, [
      { id: 20, vehicleId: null, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(loanersTable, [
      { id: 3, fleetVehicleId: 1, workOrderId: 20, startDate: "2026-01-01", status: "active", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/loaner/3/restore");
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("zakázka");
    expect(__store.rows("loaners")[0].deletedAt).not.toBeNull();
  });

  it("blocks restoring a loaner whose customer vehicle is still trashed", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "FLEET1", isFleet: true, deletedAt: null },
      { id: 2, licensePlate: "2B0 0002", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(loanersTable, [
      { id: 3, fleetVehicleId: 1, customerVehicleId: 2, startDate: "2026-01-01", status: "active", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/loaner/3/restore");
    expect(res.status).toBe(409);
    expect(__store.rows("loaners")[0].deletedAt).not.toBeNull();
  });

  it("restores a loaner once all its parents are live", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "FLEET1", isFleet: true, deletedAt: null },
      { id: 2, licensePlate: "2B0 0002", deletedAt: null },
    ]);
    seed(workOrdersTable, [{ id: 20, vehicleId: null, licensePlate: "1A0 0001", deletedAt: null }]);
    seed(loanersTable, [
      { id: 3, fleetVehicleId: 1, workOrderId: 20, customerVehicleId: 2, startDate: "2026-01-01", status: "active", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/loaner/3/restore");
    expect(res.status).toBe(200);
    expect(__store.rows("loaners")[0].deletedAt).toBeNull();
  });

  it("blocks restoring an appointment whose parent vehicle is still trashed", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(appointmentsTable, [
      { id: 9, vehicleId: 1, scheduledDate: "2026-02-01", status: "planned", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/appointment/9/restore");
    expect(res.status).toBe(409);
    expect(__store.rows("appointments")[0].deletedAt).not.toBeNull();
  });
});

describe("GET /trash — childCount for parents with trashed children", () => {
  it("reports the number of trashed descendants on the parent vehicle", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(serviceRecordsTable, [
      { id: 5, vehicleId: 1, description: "Olej", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(photosTable, [
      { id: 7, workOrderId: 10, url: "/objects/x", filename: "a.jpg", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).get("/trash");
    expect(res.status).toBe(200);
    const vehicle = res.body.find((i: { entity: string }) => i.entity === "vehicle");
    // 1 work order + 1 service record + 1 photo (under the work order).
    expect(vehicle.childCount).toBe(3);
  });

  it("omits childCount when the parent has no trashed children", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: null },
    ]);

    const res = await request(makeApp()).get("/trash");
    const vehicle = res.body.find((i: { entity: string }) => i.entity === "vehicle");
    expect(vehicle.childCount).toBeUndefined();
  });
});

describe("POST /trash/:entity/:id/restore — cascade", () => {
  it("restores only the vehicle by default (no cascade)", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") },
    ]);

    const res = await request(makeApp()).post("/trash/vehicle/1/restore");
    expect(res.status).toBe(200);
    expect(__store.rows("vehicles")[0].deletedAt).toBeNull();
    // Work order stays trashed.
    expect(__store.rows("work_orders")[0].deletedAt).not.toBeNull();
    // Only the vehicle restore was audited.
    expect(__store.rows("audit_log")).toHaveLength(1);
  });

  it("restores the vehicle and its trashed children when cascade is true", async () => {
    const at = new Date("2026-01-01T10:00:00Z");
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: at }]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: at },
    ]);
    seed(serviceRecordsTable, [{ id: 5, vehicleId: 1, description: "Olej", deletedAt: at }]);
    seed(appointmentsTable, [
      { id: 9, vehicleId: 1, scheduledDate: "2026-02-01", status: "planned", deletedAt: at },
    ]);
    seed(photosTable, [
      { id: 7, workOrderId: 10, url: "/objects/x", filename: "a.jpg", deletedAt: at },
    ]);

    const res = await request(makeApp()).post("/trash/vehicle/1/restore").send({ cascade: true });
    expect(res.status).toBe(200);
    expect(res.body.restoredCount).toBe(4);

    expect(__store.rows("vehicles")[0].deletedAt).toBeNull();
    expect(__store.rows("work_orders")[0].deletedAt).toBeNull();
    expect(__store.rows("service_records")[0].deletedAt).toBeNull();
    expect(__store.rows("appointments")[0].deletedAt).toBeNull();
    expect(__store.rows("photos")[0].deletedAt).toBeNull();

    // Parent + 4 children audited as restored.
    const restored = __store.rows("audit_log").filter((a) => a.action === "entity_restored");
    expect(restored).toHaveLength(5);
  });

  it("does not restore children that were never trashed", async () => {
    const at = new Date("2026-01-01T10:00:00Z");
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: at }]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: at },
      { id: 11, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: null },
    ]);

    const res = await request(makeApp()).post("/trash/vehicle/1/restore").send({ cascade: true });
    expect(res.status).toBe(200);
    expect(res.body.restoredCount).toBe(1);
    expect(__store.rows("work_orders").find((r) => r.id === 10)!.deletedAt).toBeNull();
    expect(__store.rows("work_orders").find((r) => r.id === 11)!.deletedAt).toBeNull();
  });

  it("skips a child whose other parent is still trashed (no orphan)", async () => {
    const at = new Date("2026-01-01T10:00:00Z");
    // V1 (customer vehicle, being restored) + V2 fleet vehicle still trashed.
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", deletedAt: at },
      { id: 2, licensePlate: "FLEET1", isFleet: true, deletedAt: at },
    ]);
    // Loaner reachable from V1 via customerVehicleId, but its fleet vehicle V2 stays trashed.
    seed(loanersTable, [
      { id: 3, fleetVehicleId: 2, customerVehicleId: 1, startDate: "2026-01-01", status: "active", deletedAt: at },
    ]);

    const res = await request(makeApp()).post("/trash/vehicle/1/restore").send({ cascade: true });
    expect(res.status).toBe(200);
    // Loaner left in the trash because its fleet vehicle is still trashed.
    expect(res.body.restoredCount).toBe(0);
    expect(__store.rows("loaners")[0].deletedAt).not.toBeNull();
  });

  it("cascade-restores a work order's trashed photos", async () => {
    const at = new Date("2026-01-01T10:00:00Z");
    seed(workOrdersTable, [
      { id: 10, vehicleId: null, licensePlate: "1A0 0001", deletedAt: at },
    ]);
    seed(photosTable, [
      { id: 7, workOrderId: 10, url: "/objects/x", filename: "a.jpg", deletedAt: at },
      { id: 8, workOrderId: 10, url: "/objects/y", filename: "b.jpg", deletedAt: at },
    ]);

    const res = await request(makeApp()).post("/trash/work_order/10/restore").send({ cascade: true });
    expect(res.status).toBe(200);
    expect(res.body.restoredCount).toBe(2);
    expect(__store.rows("photos").every((p) => p.deletedAt === null)).toBe(true);
  });

  it("still blocks cascade restore of a child whose parent is trashed", async () => {
    const at = new Date("2026-01-01T10:00:00Z");
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: at }]);
    seed(workOrdersTable, [
      { id: 10, vehicleId: 1, licensePlate: "1A0 0001", deletedAt: at },
    ]);

    const res = await request(makeApp()).post("/trash/work_order/10/restore").send({ cascade: true });
    expect(res.status).toBe(409);
    expect(__store.rows("work_orders")[0].deletedAt).not.toBeNull();
  });
});

describe("DELETE /trash/:entity/:id", () => {
  it("hard-deletes the row and writes a purge audit entry", async () => {
    seed(workOrdersTable, [
      { id: 10, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-03T10:00:00Z") },
      { id: 11, licensePlate: "2B0 0002", deletedAt: new Date("2026-01-04T10:00:00Z") },
    ]);

    const res = await request(makeApp()).delete("/trash/work_order/10");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    expect(__store.rows("work_orders").map((r) => r.id)).toEqual([11]);

    const audits = __store.rows("audit_log");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "entity_purged", entity: "work_order", entityId: "10" });
  });

  it("records the scanner actor when the session role is scanner", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: new Date("2026-01-01T10:00:00Z") }]);
    const res = await request(makeApp("scanner")).delete("/trash/vehicle/1");
    expect(res.status).toBe(200);
    expect(__store.rows("audit_log")[0]).toMatchObject({ actor: "scanner" });
  });

  it("returns 404 when the row is not trashed (cannot purge a live row)", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", deletedAt: null }]);
    const res = await request(makeApp()).delete("/trash/vehicle/1");
    expect(res.status).toBe(404);
    expect(__store.rows("vehicles")).toHaveLength(1);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });

  it("returns 404 for an unknown entity type", async () => {
    const res = await request(makeApp()).delete("/trash/widget/1");
    expect(res.status).toBe(404);
  });
});
