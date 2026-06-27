import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * GDPR hardening coverage: legal-basis + consent history, the hardened
 * permanent delete (storage-blob removal + a sanitized, PII-free audit
 * snapshot), and the retention report that flags aged work orders, photos and
 * contacts as cleanup candidates.
 */

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const { deleteObject } = vi.hoisted(() => ({ deleteObject: vi.fn(async () => {}) }));
vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({ deleteObject }),
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import gdprRouter from "../gdpr";
import {
  __store,
  seed,
  vehiclesTable,
  workOrdersTable,
  photosTable,
  consentHistoryTable,
} from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
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
    make: "Skoda",
    model: "Octavia",
    ownerType: "private",
    ownerName: null,
    ownerAddress: null,
    ownerPhone: null,
    ownerEmail: null,
    ownerIco: null,
    ownerDic: null,
    legalBasis: null,
    consentGivenAt: null,
    consentNote: null,
    createdAt: new Date(),
    ...overrides,
  };
  seed(vehiclesTable, [row]);
  return row;
}

function yearsAgo(n: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - n);
  return d;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

describe("PUT /gdpr/consent/:vehicleId — legal basis + history", () => {
  it("records consent with an explicit legal basis and appends a history row", async () => {
    seedVehicle({ id: 5 });

    const res = await request(makeApp())
      .put("/gdpr/consent/5")
      .send({ given: true, legalBasis: "contract", note: "Servisní smlouva" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ legalBasis: "contract" });
    expect(res.body.consentGivenAt).not.toBeNull();

    const history = __store.rows("consent_history").filter((r) => r.vehicleId === 5);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ basis: "contract", note: "Servisní smlouva", actor: "admin" });
  });

  it("defaults the basis to consent when none is supplied", async () => {
    seedVehicle({ id: 5 });

    const res = await request(makeApp()).put("/gdpr/consent/5").send({ given: true });

    expect(res.status).toBe(200);
    expect(res.body.legalBasis).toBe("consent");
    expect(__store.rows("consent_history")[0]).toMatchObject({ basis: "consent", event: "granted" });
  });

  it("clears the legal basis and logs a withdrawal when consent is revoked", async () => {
    seedVehicle({ id: 5, legalBasis: "consent", consentGivenAt: new Date() });

    const res = await request(makeApp()).put("/gdpr/consent/5").send({ given: false });

    expect(res.status).toBe(200);
    expect(res.body.legalBasis).toBeNull();
    expect(res.body.consentGivenAt).toBeNull();

    const history = __store.rows("consent_history");
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ event: "withdrawn", basis: null });
  });
});

describe("GET /gdpr/consent-history/:vehicleId", () => {
  it("returns the change log newest-first", async () => {
    seedVehicle({ id: 5 });
    seed(consentHistoryTable, [
      { id: 1, vehicleId: 5, basis: "consent", event: "granted", note: null, actor: "admin", createdAt: yearsAgo(2) },
      { id: 2, vehicleId: 5, basis: null, event: "withdrawn", note: null, actor: "admin", createdAt: yearsAgo(1) },
      { id: 3, vehicleId: 99, basis: "consent", event: "granted", note: null, actor: "admin", createdAt: new Date() },
    ]);

    const res = await request(makeApp()).get("/gdpr/consent-history/5");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((r: { id: number }) => r.id)).toEqual([2, 1]);
  });

  it("404s for an unknown vehicle", async () => {
    const res = await request(makeApp()).get("/gdpr/consent-history/123");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /gdpr/vehicle/:vehicleId — hardened erasure", () => {
  it("removes storage blobs, all linked rows, and writes a sanitized audit snapshot", async () => {
    seedVehicle({ id: 5, licensePlate: "7C7 7777", ownerName: "Pavel Horak", ownerPhone: "777111222" });
    seed(workOrdersTable, [{ id: 10, vehicleId: 5, status: "done", createdAt: new Date() }]);
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "objects/blob-a", filename: "a.jpg", createdAt: new Date() },
      { id: 2, workOrderId: 10, url: "objects/blob-b", filename: "b.jpg", createdAt: new Date() },
    ]);
    seed(consentHistoryTable, [
      { id: 1, vehicleId: 5, basis: "consent", event: "granted", note: null, actor: "admin", createdAt: new Date() },
    ]);

    const res = await request(makeApp()).delete("/gdpr/vehicle/5");
    expect(res.status).toBe(200);

    // Photo blobs deleted from storage.
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(deleteObject).toHaveBeenCalledWith("objects/blob-a");
    expect(deleteObject).toHaveBeenCalledWith("objects/blob-b");

    // Vehicle, work orders, and consent history all gone.
    expect(__store.rows("vehicles").find((r) => r.id === 5)).toBeUndefined();
    expect(__store.rows("work_orders")).toHaveLength(0);
    expect(__store.rows("consent_history")).toHaveLength(0);

    // Audit snapshot proves scope via counts only — no owner PII.
    const audit = __store.rows("audit_log").find((r) => r.action === "gdpr_delete");
    expect(audit).toBeDefined();
    const snapshot = JSON.parse(audit!.snapshot as string);
    expect(snapshot.licensePlate).toBe("7C7 7777");
    expect(snapshot.counts).toMatchObject({ workOrders: 1, photos: 2, consentHistory: 1 });
    const blob = JSON.stringify(snapshot);
    expect(blob).not.toContain("Pavel Horak");
    expect(blob).not.toContain("777111222");
  });

  it("aborts (500) without touching the DB when a blob deletion fails", async () => {
    deleteObject.mockRejectedValueOnce(new Error("storage down"));
    seedVehicle({ id: 5 });
    seed(workOrdersTable, [{ id: 10, vehicleId: 5, status: "done", createdAt: new Date() }]);
    seed(photosTable, [{ id: 1, workOrderId: 10, url: "objects/blob-a", filename: "a.jpg", createdAt: new Date() }]);

    const res = await request(makeApp()).delete("/gdpr/vehicle/5");
    expect(res.status).toBe(500);

    // Nothing was erased.
    expect(__store.rows("vehicles").find((r) => r.id === 5)).toBeDefined();
    expect(__store.rows("work_orders")).toHaveLength(1);
  });
});

describe("GET /gdpr/retention", () => {
  it("flags aged work orders, photos, and contacts past the threshold", async () => {
    // Aged contact vehicle with old work order + photo.
    seedVehicle({ id: 5, licensePlate: "OLD 001", ownerName: "Stary Zakaznik", createdAt: yearsAgo(5) });
    seed(workOrdersTable, [{ id: 10, vehicleId: 5, status: "done", completedAt: yearsAgo(4), createdAt: yearsAgo(4) }]);
    seed(photosTable, [{ id: 1, workOrderId: 10, url: "objects/old", filename: "old.jpg", createdAt: yearsAgo(4) }]);

    // Recent vehicle — must NOT be flagged.
    seedVehicle({ id: 6, licensePlate: "NEW 002", ownerName: "Novy Zakaznik", createdAt: new Date() });
    seed(workOrdersTable, [{ id: 11, vehicleId: 6, status: "done", completedAt: new Date(), createdAt: new Date() }]);

    const res = await request(makeApp()).get("/gdpr/retention?years=3");
    expect(res.status).toBe(200);
    expect(res.body.thresholdYears).toBe(3);
    expect(res.body.workOrders.count).toBe(1);
    expect(res.body.workOrders.items[0]).toMatchObject({ vehicleId: 5, licensePlate: "OLD 001" });
    expect(res.body.photos.count).toBe(1);
    expect(res.body.contacts.count).toBe(1);
    expect(res.body.contacts.items[0]).toMatchObject({ licensePlate: "OLD 001" });
  });

  it("uses createdAt for work orders that were never completed", async () => {
    seedVehicle({ id: 5, licensePlate: "OLD 001", createdAt: yearsAgo(5) });
    // No completedAt → coalesce falls back to the (aged) createdAt.
    seed(workOrdersTable, [{ id: 10, vehicleId: 5, status: "open", completedAt: null, createdAt: yearsAgo(4) }]);

    const res = await request(makeApp()).get("/gdpr/retention?years=3");
    expect(res.body.workOrders.count).toBe(1);
  });

  it("defaults to a 3-year threshold for an invalid years param", async () => {
    seedVehicle({ id: 5, ownerName: "Stary", createdAt: yearsAgo(4) });

    const res = await request(makeApp()).get("/gdpr/retention?years=abc");
    expect(res.body.thresholdYears).toBe(3);
    expect(res.body.contacts.count).toBe(1);
  });

  it("returns empty categories when nothing is aged", async () => {
    seedVehicle({ id: 5, ownerName: "Novy", createdAt: new Date() });

    const res = await request(makeApp()).get("/gdpr/retention?years=3");
    expect(res.body.workOrders.count).toBe(0);
    expect(res.body.photos.count).toBe(0);
    expect(res.body.contacts.count).toBe(0);
  });
});
