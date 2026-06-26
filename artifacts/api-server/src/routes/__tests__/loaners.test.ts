import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * The loaner routes lean on `where` predicates, date-range overlap windows and
 * `leftJoin`-enriched results, none of which the singleton `fake-db` models. We
 * back these tests with the relational in-memory engine so the real filter and
 * overlap logic is exercised end-to-end through the Express handlers.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import loanersRouter from "../loaners";
import {
  __store,
  seed,
  loanersTable,
  vehiclesTable,
} from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(loanersRouter);
  return app;
}

function seedFleet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 1,
    licensePlate: "1A0 0001",
    make: "Skoda",
    model: "Fabia",
    isFleet: true,
    ...overrides,
  };
  seed(vehiclesTable, [row]);
  return row;
}

function seedLoaner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: overrides.id ?? __store.rows("loaners").length + 1,
    fleetVehicleId: 1,
    workOrderId: null,
    customerVehicleId: null,
    customerName: null,
    customerPhone: null,
    startDate: "2026-01-10",
    endDate: null,
    manualEndDate: false,
    status: "active",
    note: null,
    createdAt: new Date(),
    ...overrides,
  };
  seed(loanersTable, [row]);
  return row;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

describe("POST /loaners", () => {
  it("creates a loaner against a valid fleet vehicle and returns the enriched row", async () => {
    seedFleet({ id: 7, licensePlate: "5K5 5555", make: "VW", model: "Up" });

    const res = await request(makeApp()).post("/loaners").send({
      fleetVehicleId: 7,
      startDate: "2026-02-01",
      customerName: "Jan Novak",
      status: "active",
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fleetVehicleId: 7,
      startDate: "2026-02-01",
      customerName: "Jan Novak",
      status: "active",
      manualEndDate: false,
      // Enriched from the fleet-vehicle join.
      fleetLicensePlate: "5K5 5555",
      fleetMake: "VW",
      fleetModel: "Up",
    });
    expect(__store.rows("loaners")).toHaveLength(1);
  });

  it("rejects a non-existent fleet vehicle with 400 and persists nothing", async () => {
    const res = await request(makeApp()).post("/loaners").send({
      fleetVehicleId: 999,
      startDate: "2026-02-01",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("nenalezeno");
    expect(__store.rows("loaners")).toHaveLength(0);
  });

  it("rejects a vehicle that is not part of the fleet with 400", async () => {
    seedFleet({ id: 3, isFleet: false });

    const res = await request(makeApp()).post("/loaners").send({
      fleetVehicleId: 3,
      startDate: "2026-02-01",
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("vozovém parku");
    expect(__store.rows("loaners")).toHaveLength(0);
  });

  it("rejects a body missing the required startDate with 400", async () => {
    seedFleet();
    const res = await request(makeApp()).post("/loaners").send({ fleetVehicleId: 1 });
    expect(res.status).toBe(400);
  });
});

describe("GET /loaners — filters", () => {
  it("filters by status", async () => {
    seedFleet();
    seedLoaner({ id: 1, status: "active" });
    seedLoaner({ id: 2, status: "returned", endDate: "2026-01-20" });

    const res = await request(makeApp()).get("/loaners?status=returned");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(2);
  });

  it("filters by fleetVehicleId", async () => {
    seedFleet({ id: 1 });
    seedFleet({ id: 2, licensePlate: "2B0 0002" });
    seedLoaner({ id: 1, fleetVehicleId: 1 });
    seedLoaner({ id: 2, fleetVehicleId: 2 });

    const res = await request(makeApp()).get("/loaners?fleetVehicleId=2");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fleetVehicleId).toBe(2);
  });

  it("filters by workOrderId", async () => {
    seedFleet();
    seedLoaner({ id: 1, workOrderId: 100 });
    seedLoaner({ id: 2, workOrderId: 200 });

    const res = await request(makeApp()).get("/loaners?workOrderId=100");
    expect(res.body).toHaveLength(1);
    expect(res.body[0].workOrderId).toBe(100);
  });

  it("filters by a [from,to] date window using the overlap rule", async () => {
    seedFleet();
    // Ends before the window -> excluded.
    seedLoaner({ id: 1, startDate: "2026-01-01", endDate: "2026-01-05" });
    // Spans into the window -> included.
    seedLoaner({ id: 2, startDate: "2026-01-08", endDate: "2026-01-15" });
    // Open-ended, starts before window end -> included.
    seedLoaner({ id: 3, startDate: "2026-01-09", endDate: null });
    // Starts after the window -> excluded.
    seedLoaner({ id: 4, startDate: "2026-02-01", endDate: null });

    const res = await request(makeApp()).get("/loaners?from=2026-01-10&to=2026-01-20");
    const ids = res.body.map((r: { id: number }) => r.id).sort();
    expect(ids).toEqual([2, 3]);
  });

  it("searches across borrower name and fleet plate (case-insensitive)", async () => {
    seedFleet({ id: 1, licensePlate: "9Z9 9999" });
    seedLoaner({ id: 1, customerName: "Petr Svoboda" });
    seedLoaner({ id: 2, customerName: "Jana Dvorak" });

    const byName = await request(makeApp()).get("/loaners?search=svoboda");
    expect(byName.body).toHaveLength(1);
    expect(byName.body[0].id).toBe(1);

    const byPlate = await request(makeApp()).get("/loaners?search=9z9");
    expect(byPlate.body).toHaveLength(2);
  });

  it("orders newest start date first", async () => {
    seedFleet();
    seedLoaner({ id: 1, startDate: "2026-01-01" });
    seedLoaner({ id: 2, startDate: "2026-03-01" });
    seedLoaner({ id: 3, startDate: "2026-02-01" });

    const res = await request(makeApp()).get("/loaners");
    expect(res.body.map((r: { id: number }) => r.id)).toEqual([2, 3, 1]);
  });
});

describe("GET /loaners/check-overlap", () => {
  beforeEach(() => {
    seedFleet({ id: 1 });
  });

  it("returns an active loan whose window intersects the requested range", async () => {
    seedLoaner({ id: 1, fleetVehicleId: 1, startDate: "2026-01-10", endDate: "2026-01-20", status: "active" });

    const res = await request(makeApp()).get(
      "/loaners/check-overlap?fleetVehicleId=1&startDate=2026-01-15&endDate=2026-01-25",
    );
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(1);
  });

  it("ignores non-overlapping and returned loans", async () => {
    seedLoaner({ id: 1, fleetVehicleId: 1, startDate: "2026-01-01", endDate: "2026-01-05", status: "active" });
    seedLoaner({ id: 2, fleetVehicleId: 1, startDate: "2026-01-15", endDate: "2026-01-25", status: "returned" });

    const res = await request(makeApp()).get(
      "/loaners/check-overlap?fleetVehicleId=1&startDate=2026-01-10&endDate=2026-01-12",
    );
    expect(res.body).toHaveLength(0);
  });

  it("treats an open-ended existing loan as overlapping any later range", async () => {
    seedLoaner({ id: 1, fleetVehicleId: 1, startDate: "2026-01-10", endDate: null, status: "active" });

    const res = await request(makeApp()).get(
      "/loaners/check-overlap?fleetVehicleId=1&startDate=2026-06-01&endDate=2026-06-10",
    );
    expect(res.body).toHaveLength(1);
  });

  it("excludes the loan being edited via excludeId", async () => {
    seedLoaner({ id: 1, fleetVehicleId: 1, startDate: "2026-01-10", endDate: "2026-01-20", status: "active" });

    const res = await request(makeApp()).get(
      "/loaners/check-overlap?fleetVehicleId=1&startDate=2026-01-12&endDate=2026-01-18&excludeId=1",
    );
    expect(res.body).toHaveLength(0);
  });
});

describe("PATCH /loaners/:id", () => {
  beforeEach(() => {
    seedFleet({ id: 1 });
  });

  it("marks manualEndDate when an end date is set without an explicit flag", async () => {
    seedLoaner({ id: 1, endDate: null, manualEndDate: false, status: "active" });

    const res = await request(makeApp())
      .patch("/loaners/1")
      .send({ endDate: "2026-02-02", status: "returned" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      endDate: "2026-02-02",
      manualEndDate: true,
      status: "returned",
    });
  });

  it("honors an explicit manualEndDate flag alongside an end date", async () => {
    seedLoaner({ id: 1, endDate: null, manualEndDate: false });

    const res = await request(makeApp())
      .patch("/loaners/1")
      .send({ endDate: "2026-02-02", manualEndDate: false });

    expect(res.status).toBe(200);
    expect(res.body.manualEndDate).toBe(false);
  });

  it("returns 404 for an unknown loaner id", async () => {
    const res = await request(makeApp()).patch("/loaners/999").send({ status: "returned" });
    expect(res.status).toBe(404);
  });

  it("rejects a non-numeric id with 400", async () => {
    const res = await request(makeApp()).patch("/loaners/abc").send({ status: "returned" });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /loaners/:id", () => {
  it("soft-deletes the loaner (sets deletedAt) and returns 204", async () => {
    seedFleet();
    seedLoaner({ id: 1 });
    seedLoaner({ id: 2 });

    const res = await request(makeApp()).delete("/loaners/1");
    expect(res.status).toBe(204);

    // The row is retained but flagged as deleted...
    const rows = __store.rows("loaners");
    expect(rows.map((r) => r.id).sort()).toEqual([1, 2]);
    expect(rows.find((r) => r.id === 1)?.deletedAt).toBeTruthy();

    // ...and it no longer appears in the listing.
    const list = await request(makeApp()).get("/loaners");
    expect(list.body.map((r: { id: number }) => r.id)).toEqual([2]);
  });

  it("rejects a non-numeric id with 400", async () => {
    const res = await request(makeApp()).delete("/loaners/xyz");
    expect(res.status).toBe(400);
  });
});
