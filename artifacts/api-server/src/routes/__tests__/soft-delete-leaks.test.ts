import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Regression suite for soft-delete (trash/restore) leaks.
 *
 * Task #67 added `deletedAt` across vehicles, work orders, materials, loaners,
 * appointments, service records and photos. A code review found ~9 secondary
 * lookups (PATCH pre-checks, side-channel reads, typeahead suggestions, FK
 * resolution by plate/id, photo upload, scan catalog reads) that could still
 * surface trashed rows. Those were fixed by adding `isNull(deletedAt)`; these
 * tests pin the behavior so dropping any of those filters fails CI.
 *
 * Backed by the relational in-memory engine so the real `where` predicates run
 * end-to-end through the Express handlers — if a route drops its
 * `isNull(deletedAt)` guard, the deleted row resurfaces and the assertion fails.
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

vi.mock("../../lib/fileValidation", () => ({
  validateImageUpload: () => ({ ok: true, ext: ".jpg" }),
}));

// Deterministic AI: always "detects" a single item named "Vzduchový filtr".
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  items: [{ name: "Vzduchový filtr", quantity: "1", unit: "ks" }],
                }),
              },
            },
          ],
        }),
      },
    },
  }),
  getOpenAIModel: () => "gpt-4o",
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import vehiclesRouter from "../vehicles";
import materialsRouter from "../materials";
import loanersRouter from "../loaners";
import appointmentsRouter from "../appointments";
import serviceRecordsRouter from "../service-records";
import workOrdersRouter from "../work-orders";
import scanMaterialsRouter from "../scan-materials";
import {
  __store,
  seed,
  vehiclesTable,
  materialsCatalogTable,
  loanersTable,
  appointmentsTable,
  serviceRecordsTable,
  workOrdersTable,
} from "../../test-support/rel-db/engine";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { log: Record<string, unknown> }).log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    next();
  });
  app.use(vehiclesRouter);
  app.use(materialsRouter);
  app.use(loanersRouter);
  app.use(appointmentsRouter);
  app.use(serviceRecordsRouter);
  app.use(workOrdersRouter);
  app.use(scanMaterialsRouter);
  return app;
}

const DELETED = { deletedAt: new Date("2026-01-01T00:00:00Z"), deletedBy: "admin", deleteReason: "trashed" };

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

// ─── PATCH / update pre-checks ───────────────────────────────────────────────

describe("PATCH pre-checks exclude soft-deleted rows", () => {
  it("PATCH /vehicles/:id returns 404 for a trashed vehicle and does not revive it", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", make: "Skoda", isFleet: false, ...DELETED }]);

    const res = await request(makeApp()).patch("/vehicles/1").send({ make: "VW" });

    expect(res.status).toBe(404);
    // The row must keep its original value — the update must not have applied.
    expect(__store.rows("vehicles").find((r) => r.id === 1)?.make).toBe("Skoda");
  });

  it("PATCH /materials/:id returns 404 for a trashed catalog item", async () => {
    seed(materialsCatalogTable, [{ id: 1, name: "Olej 5W-40", defaultPrice: 300, ...DELETED }]);

    const res = await request(makeApp()).patch("/materials/1").send({ defaultPrice: 999 });

    expect(res.status).toBe(404);
    expect(__store.rows("materials_catalog").find((r) => r.id === 1)?.defaultPrice).toBe(300);
  });

  it("PATCH /appointments/:id returns 404 for a trashed appointment", async () => {
    seed(appointmentsTable, [{ id: 1, vehicleId: null, status: "scheduled", ...DELETED }]);

    const res = await request(makeApp()).patch("/appointments/1").send({ status: "done" });

    expect(res.status).toBe(404);
    expect(__store.rows("appointments").find((r) => r.id === 1)?.status).toBe("scheduled");
  });

  it("PATCH /loaners/:id returns 404 for a trashed loaner", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", isFleet: true }]);
    seed(loanersTable, [
      { id: 1, fleetVehicleId: 1, status: "active", startDate: "2026-01-10", endDate: null, manualEndDate: false, ...DELETED },
    ]);

    const res = await request(makeApp()).patch("/loaners/1").send({ status: "returned" });

    expect(res.status).toBe(404);
    expect(__store.rows("loaners").find((r) => r.id === 1)?.status).toBe("active");
  });
});

// ─── Side-channel reads (/:id/qr, /:id/recompute-status, /:id/reminder-log) ───

describe("Side-channel reads exclude soft-deleted rows", () => {
  it("GET /materials/:id/qr returns 404 for a trashed catalog item", async () => {
    seed(materialsCatalogTable, [{ id: 5, name: "Motorový olej 5W-40", unit: "l", ...DELETED }]);

    const res = await request(makeApp()).get("/materials/5/qr");

    expect(res.status).toBe(404);
  });

  it("POST /vehicles/:id/recompute-status returns 404 for a trashed vehicle", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", isFleet: false, ...DELETED }]);

    const res = await request(makeApp()).post("/vehicles/1/recompute-status").send({});

    expect(res.status).toBe(404);
  });

  it("GET /vehicles/:id/reminder-log returns 404 for a trashed vehicle", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "1A0 0001", isFleet: false, ...DELETED }]);

    const res = await request(makeApp()).get("/vehicles/1/reminder-log");

    expect(res.status).toBe(404);
  });
});

// ─── Loaner borrower (customer) suggestions ──────────────────────────────────

describe("GET /loaners/customer-suggestions excludes trashed vehicles", () => {
  it("does not suggest the owner of a soft-deleted vehicle", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "1A0 0001", ownerName: "Jan Novak", ownerPhone: "111", isFleet: false },
      { id: 2, licensePlate: "2B0 0002", ownerName: "Jan Novotny", ownerPhone: "222", isFleet: false, ...DELETED },
    ]);

    const res = await request(makeApp()).get("/loaners/customer-suggestions?search=Jan");

    expect(res.status).toBe(200);
    expect(res.body.map((r: { vehicleId: number }) => r.vehicleId)).toEqual([1]);
  });
});

// ─── FK resolution by plate / id ─────────────────────────────────────────────

describe("FK resolution by plate/id ignores trashed targets", () => {
  it("POST /appointments does not resolve vehicleId to a trashed vehicle", async () => {
    seed(vehiclesTable, [{ id: 9, licensePlate: "1A0 0001", isFleet: false, ...DELETED }]);

    const res = await request(makeApp())
      .post("/appointments")
      .send({ scheduledDate: "2026-02-01", licensePlate: "1A0 0001" });

    expect(res.status).toBe(201);
    // The plate is recorded, but the FK must NOT point at the trashed vehicle.
    expect(res.body.vehicleId).toBeNull();
  });

  it("PATCH /appointments does not re-link to a trashed vehicle by plate", async () => {
    seed(vehiclesTable, [{ id: 9, licensePlate: "1A0 0001", isFleet: false, ...DELETED }]);
    seed(appointmentsTable, [{ id: 1, vehicleId: null, status: "scheduled", scheduledDate: "2026-02-01" }]);

    const res = await request(makeApp())
      .patch("/appointments/1")
      .send({ licensePlate: "1A0 0001" });

    expect(res.status).toBe(200);
    expect(res.body.vehicleId).toBeNull();
  });

  it("POST /vehicles/:id/service-records returns 404 for a trashed vehicle", async () => {
    seed(vehiclesTable, [{ id: 9, licensePlate: "1A0 0001", isFleet: false, ...DELETED }]);

    const res = await request(makeApp())
      .post("/vehicles/9/service-records")
      .send({ date: "2026-02-01", description: "Olej" });

    expect(res.status).toBe(404);
    // Nothing should have been written against the trashed vehicle.
    expect(__store.rows("service_records")).toHaveLength(0);
  });
});

// ─── Work-order photo upload ─────────────────────────────────────────────────

describe("POST /work-orders/:id/photos excludes trashed work orders", () => {
  it("returns 404 when uploading to a trashed work order and stores no photo", async () => {
    seed(workOrdersTable, [{ id: 1, vehicleId: null, licensePlate: "1A0 0001", status: "open", paid: false, ...DELETED }]);

    const res = await request(makeApp())
      .post("/work-orders/1/photos")
      .attach("photo", Buffer.from("fake-jpeg-bytes"), "photo.jpg");

    expect(res.status).toBe(404);
    expect(__store.rows("photos")).toHaveLength(0);
  });
});

// ─── scan-materials catalog suggestions ──────────────────────────────────────

describe("POST /work-orders/scan-materials excludes trashed catalog + orders", () => {
  it("does not match an AI-detected item to a trashed catalog entry", async () => {
    seed(workOrdersTable, [{ id: 1, vehicleId: null, licensePlate: "1AB 1234", status: "open", paid: false }]);
    // The catalog hit that the AI name would match is trashed.
    seed(materialsCatalogTable, [{ id: 99, name: "Vzduchový filtr", unit: "ks", defaultPrice: 350, ...DELETED }]);

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(200);
    const ai = res.body.suggestions.find((s: { source: string }) => s.source === "ai");
    expect(ai).toBeTruthy();
    // Filter dropped => catalogId would be 99; with the filter it stays null.
    expect(ai.catalogId).toBeNull();
  });

  it("does not include a trashed catalog item among QR suggestions", async () => {
    seed(workOrdersTable, [{ id: 1, vehicleId: null, licensePlate: "1AB 1234", status: "open", paid: false }]);
    seed(materialsCatalogTable, [{ id: 7, name: "Brzdové destičky", unit: "sada", defaultPrice: 800, ...DELETED }]);

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: [], qrMaterialIds: [7] });

    expect(res.status).toBe(200);
    const qr = res.body.suggestions.filter((s: { source: string }) => s.source === "qr");
    expect(qr).toHaveLength(0);
  });

  it("returns 404 when the only work order for the SPZ is trashed", async () => {
    seed(workOrdersTable, [{ id: 1, vehicleId: null, licensePlate: "1AB 1234", status: "open", paid: false, ...DELETED }]);

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(404);
  });
});
