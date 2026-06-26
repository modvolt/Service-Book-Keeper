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
