import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Marking a work order invoiced (Vyfakturováno) must auto-return any *active* loaner
 * tied to that order, unless the return date was set manually (manualEndDate).
 * This couples work-orders.ts -> loanersTable, so we exercise it through the
 * PATCH handler with the relational engine and stub the unrelated vehicle-status
 * recompute + storage init.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../lib/vehicleStatus", () => ({
  recomputeVehicleServiceStatus: vi.fn(async () => {}),
}));

vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({
    deleteObject: vi.fn(async () => {}),
  }),
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import workOrdersRouter from "../work-orders";
import { __store, seed, workOrdersTable, loanersTable } from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(workOrdersRouter);
  return app;
}

function seedOrder(overrides: Record<string, unknown> = {}): void {
  seed(workOrdersTable, [
    {
      id: 1,
      vehicleId: null,
      licensePlate: "1A0 0001",
      status: "open",
      invoiceStatus: "not_invoiced", paymentStatus: "unpaid",
      completedAt: null,
      createdAt: new Date(),
      ...overrides,
    },
  ]);
}

function seedLoaner(overrides: Record<string, unknown> = {}): void {
  seed(loanersTable, [
    {
      id: overrides.id ?? __store.rows("loaners").length + 1,
      fleetVehicleId: 1,
      workOrderId: 1,
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
    },
  ]);
}

function loaner(id: number): Record<string, unknown> | undefined {
  return __store.rows("loaners").find((r) => r.id === id);
}

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

describe("PATCH /work-orders/:id — invoicing auto-closes loaners", () => {
  it("returns an active, auto-managed loaner on the order when marked invoiced", async () => {
    seedOrder();
    seedLoaner({ id: 1, status: "active", manualEndDate: false, endDate: null });

    const res = await request(makeApp()).patch("/work-orders/1").send({ invoiceStatus: "invoiced" });

    expect(res.status).toBe(200);
    const l = loaner(1);
    expect(l).toMatchObject({ status: "returned", endDate: TODAY });
  });

  it("does NOT touch a loaner whose return date was set manually", async () => {
    seedOrder();
    seedLoaner({ id: 1, status: "active", manualEndDate: true, endDate: "2026-03-01" });

    const res = await request(makeApp()).patch("/work-orders/1").send({ invoiceStatus: "invoiced" });

    expect(res.status).toBe(200);
    const l = loaner(1);
    expect(l).toMatchObject({ status: "active", endDate: "2026-03-01" });
  });

  it("does NOT re-close a loaner that is already returned", async () => {
    seedOrder();
    seedLoaner({ id: 1, status: "returned", manualEndDate: false, endDate: "2026-02-15" });

    await request(makeApp()).patch("/work-orders/1").send({ invoiceStatus: "invoiced" });

    const l = loaner(1);
    // endDate must keep its original value, not be overwritten with today.
    expect(l).toMatchObject({ status: "returned", endDate: "2026-02-15" });
  });

  it("only closes loaners tied to the invoiced order, not loaners on other orders", async () => {
    seedOrder({ id: 1 });
    seed(workOrdersTable, [
      { id: 2, vehicleId: null, licensePlate: "2B0 0002", status: "open", invoiceStatus: "not_invoiced", paymentStatus: "unpaid", completedAt: null, createdAt: new Date() },
    ]);
    seedLoaner({ id: 1, workOrderId: 1, status: "active" });
    seedLoaner({ id: 2, workOrderId: 2, status: "active" });

    await request(makeApp()).patch("/work-orders/1").send({ invoiceStatus: "invoiced" });

    expect(loaner(1)).toMatchObject({ status: "returned", endDate: TODAY });
    // The loaner on order #2 must remain active.
    expect(loaner(2)).toMatchObject({ status: "active", endDate: null });
  });

  it("does not auto-close loaners when the update does not set invoiceStatus=invoiced", async () => {
    seedOrder();
    seedLoaner({ id: 1, status: "active", manualEndDate: false, endDate: null });

    await request(makeApp()).patch("/work-orders/1").send({ status: "completed" });

    expect(loaner(1)).toMatchObject({ status: "active", endDate: null });
  });

  it("returns 404 for an unknown work order without altering loaners", async () => {
    seedLoaner({ id: 1, workOrderId: 1, status: "active" });

    const res = await request(makeApp()).patch("/work-orders/999").send({ invoiceStatus: "invoiced" });

    expect(res.status).toBe(404);
    expect(loaner(1)).toMatchObject({ status: "active" });
  });
});

describe("GET /work-orders — SPZ search is space-insensitive", () => {
  function seedOrders(): void {
    seed(workOrdersTable, [
      { id: 1, vehicleId: null, licensePlate: "1AB 2345", status: "open", invoiceStatus: "not_invoiced", paymentStatus: "unpaid", completedAt: null, createdAt: new Date() },
      { id: 2, vehicleId: null, licensePlate: "9ZZ 9999", status: "in_progress", invoiceStatus: "not_invoiced", paymentStatus: "unpaid", completedAt: null, createdAt: new Date() },
    ]);
  }

  it("finds a canonically-spaced plate when searched with a compact query (no space)", async () => {
    seedOrders();

    const res = await request(makeApp()).get("/work-orders").query({ search: "1AB2345" });

    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: number }) => o.id)).toEqual([1]);
  });

  it("still finds a plate when searched with the canonical spaced form", async () => {
    seedOrders();

    const res = await request(makeApp()).get("/work-orders").query({ search: "1AB 2345" });

    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: number }) => o.id)).toEqual([1]);
  });
});
