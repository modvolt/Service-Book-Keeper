import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * GDPR coverage for the loaner surface: loaners holding borrower PII must show
 * up in the data-subject search + export, and must be stripped (anonymize) or
 * fully removed (delete) along with the rest of the customer's data.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({
    deleteObject: vi.fn(async () => {}),
  }),
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import gdprRouter from "../gdpr";
import {
  __store,
  seed,
  vehiclesTable,
  loanersTable,
} from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  // gdpr handlers reference req.log (pino-http); supply a stub.
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use(gdprRouter);
  return app;
}

function seedVehicle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: 1,
    licensePlate: "1A0 0001",
    ownerType: "private",
    ownerName: null,
    ownerAddress: null,
    ownerPhone: null,
    ownerEmail: null,
    ownerIco: null,
    ownerDic: null,
    consentGivenAt: null,
    consentNote: null,
    ...overrides,
  };
  seed(vehiclesTable, [row]);
  return row;
}

function seedLoaner(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row = {
    id: overrides.id ?? __store.rows("loaners").length + 1,
    fleetVehicleId: 9,
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

describe("GET /gdpr/search — loaner inclusion", () => {
  it("finds a vehicle via a loaner whose borrower name matches the query", async () => {
    // Customer vehicle has no owner PII of its own; only the loaner carries it.
    seedVehicle({ id: 5, licensePlate: "7C7 7777" });
    seedLoaner({ customerVehicleId: 5, customerName: "Pavel Horak", customerPhone: "777111222" });

    const res = await request(makeApp()).get("/gdpr/search?q=Horak");
    expect(res.status).toBe(200);
    expect(res.body.vehicles).toHaveLength(1);
    expect(res.body.vehicles[0]).toMatchObject({ id: 5, loanerCount: 1 });
  });

  it("finds a vehicle via a loaner borrower phone match", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777" });
    seedLoaner({ customerVehicleId: 5, customerName: "Pavel Horak", customerPhone: "777111222" });

    const res = await request(makeApp()).get("/gdpr/search?q=777111222");
    expect(res.body.vehicles).toHaveLength(1);
    expect(res.body.vehicles[0].id).toBe(5);
  });

  it("does not match loaners for an unrelated query", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777" });
    seedLoaner({ customerVehicleId: 5, customerName: "Pavel Horak" });

    const res = await request(makeApp()).get("/gdpr/search?q=Nonexistent");
    expect(res.body.vehicles).toHaveLength(0);
  });

  it("reports the loaner count for a matched owner", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777", ownerName: "Pavel Horak" });
    seedLoaner({ customerVehicleId: 5, customerName: "Pavel Horak" });
    seedLoaner({ customerVehicleId: 5, customerName: "Pavel Horak" });

    const res = await request(makeApp()).get("/gdpr/search?q=Horak");
    expect(res.body.vehicles[0].loanerCount).toBe(2);
  });
});

describe("GET /gdpr/export/:vehicleId — loaner inclusion", () => {
  it("includes the customer's loaners in the export payload", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777" });
    seedLoaner({ id: 1, customerVehicleId: 5, customerName: "Pavel Horak" });
    // A loaner for a different customer must not leak into this export.
    seedLoaner({ id: 2, customerVehicleId: 99, customerName: "Jiny Zakaznik" });

    const res = await request(makeApp()).get("/gdpr/export/5");
    expect(res.status).toBe(200);
    expect(res.body.loaners).toHaveLength(1);
    expect(res.body.loaners[0]).toMatchObject({ id: 1, customerName: "Pavel Horak" });
  });
});

describe("POST /gdpr/anonymize/:vehicleId — loaner PII", () => {
  it("strips borrower name/phone from the customer's loaners but keeps the record", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777", ownerName: "Pavel Horak" });
    seedLoaner({ id: 1, customerVehicleId: 5, customerName: "Pavel Horak", customerPhone: "777111222" });

    const res = await request(makeApp()).post("/gdpr/anonymize/5");
    expect(res.status).toBe(200);

    const l = __store.rows("loaners").find((r) => r.id === 1);
    expect(l).toBeDefined();
    expect(l).toMatchObject({ customerName: null, customerPhone: null });
    // The technical lending record itself survives.
    expect(l!.fleetVehicleId).toBe(9);
  });

  it("does not strip loaners belonging to a different customer", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777" });
    seedLoaner({ id: 1, customerVehicleId: 5, customerName: "Pavel Horak" });
    seedLoaner({ id: 2, customerVehicleId: 99, customerName: "Jiny Zakaznik" });

    await request(makeApp()).post("/gdpr/anonymize/5");

    const other = __store.rows("loaners").find((r) => r.id === 2);
    expect(other).toMatchObject({ customerName: "Jiny Zakaznik" });
  });
});

describe("DELETE /gdpr/vehicle/:vehicleId — loaner removal", () => {
  it("removes the customer's loaners along with the vehicle", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777" });
    seedLoaner({ id: 1, customerVehicleId: 5, customerName: "Pavel Horak" });
    seedLoaner({ id: 2, customerVehicleId: 99, customerName: "Jiny Zakaznik" });

    const res = await request(makeApp()).delete("/gdpr/vehicle/5");
    expect(res.status).toBe(200);

    const remaining = __store.rows("loaners").map((r) => r.id);
    expect(remaining).toEqual([2]);
    // The vehicle itself is gone too.
    expect(__store.rows("vehicles").find((r) => r.id === 5)).toBeUndefined();
  });
});
