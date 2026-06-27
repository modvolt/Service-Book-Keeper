import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * The dashboard summary drives the workshop-workflow blocks (Dnes objednáno,
 * Probíhá, Čeká na díly, Hotovo k fakturaci, Vyfakturováno-nezaplaceno, STK po
 * termínu). It computes these counts off the three independent status columns
 * (status / invoiceStatus / paymentStatus), so we exercise the route through
 * the relational engine with representative rows.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import dashboardRouter from "../dashboard";
import { __store, seed, workOrdersTable, vehiclesTable } from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(dashboardRouter);
  return app;
}

const now = new Date();
const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
const todayDate = (h = 9) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysFromToday = (n: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

describe("GET /dashboard/summary — workflow counts", () => {
  it("counts each workflow stage off the independent status columns", async () => {
    seed(workOrdersTable, [
      // Created today, still open -> orderedToday + open.
      { id: 1, vehicleId: null, licensePlate: "1A0 0001", status: "open", invoiceStatus: "not_invoiced", paymentStatus: "unpaid", completedAt: null, createdAt: todayDate() },
      // In progress (created earlier this month).
      { id: 2, vehicleId: null, licensePlate: "2A0 0002", status: "in_progress", invoiceStatus: "not_invoiced", paymentStatus: "unpaid", completedAt: null, createdAt: startOfMonth },
      // Waiting for parts.
      { id: 3, vehicleId: null, licensePlate: "3A0 0003", status: "waiting_parts", invoiceStatus: "not_invoiced", paymentStatus: "unpaid", completedAt: null, createdAt: startOfMonth },
      // Completed this month + ready to invoice.
      { id: 4, vehicleId: null, licensePlate: "4A0 0004", status: "completed", invoiceStatus: "ready_to_invoice", paymentStatus: "unpaid", completedAt: todayDate(), createdAt: startOfMonth },
      // Invoiced but unpaid -> invoicedUnpaid (completed, not open).
      { id: 5, vehicleId: null, licensePlate: "5A0 0005", status: "completed", invoiceStatus: "invoiced", paymentStatus: "unpaid", completedAt: startOfMonth, createdAt: startOfMonth },
      // Invoiced + fully paid -> NOT invoicedUnpaid.
      { id: 6, vehicleId: null, licensePlate: "6A0 0006", status: "completed", invoiceStatus: "invoiced", paymentStatus: "paid", completedAt: startOfMonth, createdAt: startOfMonth },
    ]);

    seed(vehiclesTable, [
      // STK already expired -> stkOverdue.
      { id: 10, licensePlate: "7A0 0007", stkValidUntil: daysFromToday(-5) },
      // STK expiring within 30 days -> stkExpiringSoon.
      { id: 11, licensePlate: "8A0 0008", stkValidUntil: daysFromToday(10) },
      // STK far in the future -> neither.
      { id: 12, licensePlate: "9A0 0009", stkValidUntil: daysFromToday(200) },
    ]);

    const res = await request(makeApp()).get("/dashboard/summary");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalVehicles: 3,
      openWorkOrders: 3, // statuses != completed: ids 1,2,3
      inProgressWorkOrders: 1,
      waitingParts: 1,
      orderedToday: 1,
      readyToInvoice: 1,
      invoicedUnpaid: 1,
      completedThisMonth: 3, // ids 4,5,6 completed this month
      stkExpiringSoon: 1,
      stkOverdue: 1,
    });
  });
});
