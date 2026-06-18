import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * RBAC for the material-scan workflow. The scanner role must be able to reach
 * exactly the scan-workflow routes — look up the open work order by SPZ, run the
 * material scan, and append the detected materials — and nothing else. Every
 * other work-order route and the materials catalog CRUD stay admin-only.
 *
 * This exercises the real routes/index.ts composition (the scanner-accessible
 * router + the admin router) behind the real auth middlewares, so a regression
 * that drops scan-workflow routes out of scannerRouter (the original bug, where
 * the scanner got a 403 and the UI showed "neexistuje otevřená zakázka") fails
 * here.
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

import adminRouter, { scannerRouter } from "../index";
import { requireAuth, requireAdmin, requireScannerOrAdmin } from "../../middlewares/requireAuth";
import { __store, seed, workOrdersTable } from "../../test-support/rel-db/engine";

type Role = "admin" | "scanner";

function seedOrders(): void {
  seed(workOrdersTable, [
    // Open order for the queried plate — the one the scanner should pair to.
    { id: 1, vehicleId: 10, licensePlate: "1AB 2345", status: "in_progress", paid: false, completedAt: null, serviceDate: null, createdAt: "2026-06-01T00:00:00.000Z", description: "Výměna oleje" },
    // Same plate but completed — must be excluded (not an open order).
    { id: 2, vehicleId: 10, licensePlate: "1AB 2345", status: "completed", paid: true, completedAt: "2026-05-01T00:00:00.000Z", serviceDate: "2026-05-01", createdAt: "2026-05-01T00:00:00.000Z", description: "Stará zakázka" },
    // A different vehicle's open order — must never leak into the lookup.
    { id: 3, vehicleId: 20, licensePlate: "9XY 9999", status: "in_progress", paid: false, completedAt: null, serviceDate: null, createdAt: "2026-06-02T00:00:00.000Z", description: "Jiné vozidlo" },
  ]);
}

function makeApp(role: Role | null): Express {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) (req as unknown as { session: unknown }).session = { authenticated: true, role };
    next();
  });
  // Mirror app.ts: scanner-accessible tier first, then the admin-only tier.
  app.use(requireAuth, requireScannerOrAdmin, scannerRouter);
  app.use(requireAuth, requireAdmin, adminRouter);
  return app;
}

beforeEach(() => {
  __store.reset();
});

describe("scanner RBAC — material-scan workflow", () => {
  it("scanner can look up the open work order by SPZ (the pairing lookup that was 403ing)", async () => {
    seedOrders();
    const res = await request(makeApp("scanner")).get("/work-orders").query({ search: "1AB2345" });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Only the OPEN order for the queried plate — not the completed one, not the other vehicle.
    expect(res.body.map((o: { id: number }) => o.id)).toEqual([1]);
  });

  it("scanner lookup matches the plate space-insensitively (stored '1AB 2345' vs query '1ab2345')", async () => {
    seedOrders();
    const res = await request(makeApp("scanner")).get("/work-orders").query({ search: "1ab2345" });
    expect(res.status).toBe(200);
    expect(res.body.map((o: { id: number }) => o.id)).toEqual([1]);
  });

  it("scanner lookup never exposes owner/vehicle PII (make/model/ownerName are null)", async () => {
    seedOrders();
    const res = await request(makeApp("scanner")).get("/work-orders").query({ search: "1AB2345" });
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({ make: null, model: null, ownerName: null });
  });

  it("scanner CANNOT enumerate work orders — no/short/partial search returns [] even with data present", async () => {
    seedOrders();
    const noSearch = await request(makeApp("scanner")).get("/work-orders");
    expect(noSearch.status).toBe(200);
    expect(noSearch.body).toEqual([]);
    const shortSearch = await request(makeApp("scanner")).get("/work-orders").query({ search: "1A" });
    expect(shortSearch.status).toBe(200);
    expect(shortSearch.body).toEqual([]);
    // A >=3-char PARTIAL of a real plate must not match — exact equality, not substring,
    // so a scanner can't probe prefixes to discover other vehicles' open orders.
    const partialSearch = await request(makeApp("scanner")).get("/work-orders").query({ search: "1AB2" });
    expect(partialSearch.status).toBe(200);
    expect(partialSearch.body).toEqual([]);
  });

  it("scanner can reach the material-scan endpoint (gate passes; 400 on empty body)", async () => {
    const res = await request(makeApp("scanner")).post("/work-orders/scan-materials").send({});
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(400);
  });

  it("scanner can append material to an OPEN work order when the SPZ matches (201)", async () => {
    seedOrders();
    const res = await request(makeApp("scanner"))
      .post("/work-orders/1/materials")
      .send({ name: "Motorový olej 5W-40", quantity: "1", spz: "1AB2345" });
    expect(res.status).toBe(201);
  });

  it("scanner CANNOT append material to an unrelated open order — SPZ must match the target order (IDOR guard, 403)", async () => {
    seedOrders();
    // Order 3 is a different vehicle (9XY 9999). A scanner who only scanned 1AB 2345
    // must not be able to write to it by guessing its id, even though it's open.
    const res = await request(makeApp("scanner"))
      .post("/work-orders/3/materials")
      .send({ name: "Motorový olej 5W-40", quantity: "1", spz: "1AB2345" });
    expect(res.status).toBe(403);
  });

  it("scanner add-material without an SPZ is rejected (403, write must be bound to a scanned plate)", async () => {
    seedOrders();
    const res = await request(makeApp("scanner"))
      .post("/work-orders/1/materials")
      .send({ name: "Motorový olej 5W-40", quantity: "1" });
    expect(res.status).toBe(403);
  });

  it("scanner CANNOT append material to a COMPLETED work order (409)", async () => {
    seedOrders();
    const res = await request(makeApp("scanner"))
      .post("/work-orders/2/materials")
      .send({ name: "Motorový olej 5W-40", quantity: "1", spz: "1AB2345" });
    expect(res.status).toBe(409);
  });

  it("scanner add-material returns 404 for a missing order (gate passes, but no such order)", async () => {
    const res = await request(makeApp("scanner"))
      .post("/work-orders/999/materials")
      .send({ name: "Motorový olej 5W-40", quantity: "1", spz: "1AB2345" });
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(404);
  });

  it("scanner CANNOT read a work order's material list (GET is admin-only)", async () => {
    seedOrders();
    const res = await request(makeApp("scanner")).get("/work-orders/1/materials");
    expect(res.status).toBe(403);
  });

  it("scanner is blocked from creating work orders (admin-only)", async () => {
    const res = await request(makeApp("scanner")).post("/work-orders").send({ licensePlate: "1AB2345" });
    expect(res.status).toBe(403);
  });

  it("scanner is blocked from the materials catalog (admin-only)", async () => {
    const res = await request(makeApp("scanner")).get("/materials");
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated requests with 401 before reaching the scan routes", async () => {
    const res = await request(makeApp(null)).get("/work-orders").query({ search: "1AB2345" });
    expect(res.status).toBe(401);
  });
});

describe("admin retains full access to the scan-workflow routes", () => {
  it("admin can reach GET /work-orders (admin tier, not gated to 403)", async () => {
    const res = await request(makeApp("admin")).get("/work-orders").query({ search: "1AB2345" });
    expect(res.status).toBe(200);
  });

  it("admin can reach work-order creation (not gated to 403)", async () => {
    const res = await request(makeApp("admin")).post("/work-orders").send({});
    expect(res.status).not.toBe(403);
  });
});
