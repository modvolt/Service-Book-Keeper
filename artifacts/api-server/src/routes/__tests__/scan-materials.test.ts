import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

/**
 * Tests for:
 * 1. POST /work-orders/scan-materials — SPZ→work-order resolution (open vs none)
 * 2. GET /materials/:id/qr — QR payload shape
 * 3. Catalog fuzzy matching (catalogId filled / null)
 */

// --- Hoisted state ---
const { workOrders, vehicles, catalog } = vi.hoisted(() => ({
  workOrders: [] as Record<string, unknown>[],
  vehicles: [] as Record<string, unknown>[],
  catalog: [] as Record<string, unknown>[],
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

// Minimal drizzle-orm mock that lets our code call ilike / ne / eq / and
vi.mock("drizzle-orm", () => ({
  ilike: (_col: unknown, value: string) => ({ __op: "ilike", value }),
  ne: (_col: unknown, value: unknown) => ({ __op: "ne", value }),
  eq: (_col: unknown, value: unknown) => ({ __op: "eq", value }),
  and: (...args: unknown[]) => ({ __op: "and", args }),
  isNull: (col: { __col: string }) => ({ __op: "isNull", col: col?.__col }),
  asc: (_col: unknown) => ({ __op: "asc" }),
}));

// Mock OpenAI integration
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify({ items: [{ name: "Vzduchový filtr", quantity: "1", unit: "ks" }] }) } }],
        }),
      },
    },
  }),
  getOpenAIModel: () => "gpt-4o",
}));

// Full @workspace/db mock with queryable in-memory stores
vi.mock("@workspace/db", () => {
  const vehiclesTable = {
    id: { __col: "id" },
    licensePlate: { __col: "licensePlate" },
    make: { __col: "make" },
    model: { __col: "model" },
    currentKm: { __col: "currentKm" },
  };
  const workOrdersTable = {
    id: { __col: "id" },
    vehicleId: { __col: "vehicleId" },
    licensePlate: { __col: "licensePlate" },
    status: { __col: "status" },
  };
  const materialsCatalogTable = {
    id: { __col: "id" },
    name: { __col: "name" },
    unit: { __col: "unit" },
    defaultPrice: { __col: "defaultPrice" },
  };

  type Pred = { __op: string; value?: unknown; args?: Pred[]; col?: string };

  function matchRow(row: Record<string, unknown>, pred: Pred | undefined): boolean {
    if (!pred) return true;
    if (pred.__op === "and") {
      return (pred.args as Pred[]).every((p) => matchRow(row, p));
    }
    if (pred.__op === "isNull") {
      return pred.col ? row[pred.col] == null : true;
    }
    if (pred.__op === "ilike") {
      const pattern = (pred.value as string).replace(/%/g, "").toLowerCase();
      return Object.values(row).some(
        (v) => typeof v === "string" && v.toLowerCase().includes(pattern),
      );
    }
    if (pred.__op === "ne") {
      return !Object.values(row).includes(pred.value);
    }
    if (pred.__op === "eq") {
      return Object.values(row).includes(pred.value);
    }
    return true;
  }

  function makeQuery(store: Record<string, unknown>[]) {
    return {
      _store: store,
      _selected: null as Record<string, unknown> | null,
      _where: undefined as Pred | undefined,
      _limit: Infinity,
      select(fields?: Record<string, unknown>) {
        const q = Object.create(this);
        q._selected = fields ?? null;
        return q;
      },
      from(_table: unknown) {
        return this;
      },
      where(pred: Pred) {
        const q = Object.create(this);
        q._where = pred;
        return q;
      },
      limit(n: number) {
        const q = Object.create(this);
        q._limit = n;
        return q;
      },
      orderBy() {
        return this;
      },
      then(resolve: (v: Record<string, unknown>[]) => unknown) {
        const rows = this._store
          .filter((r) => matchRow(r, this._where))
          .slice(0, this._limit);
        const projected = this._selected
          ? rows.map((r) => {
              const out: Record<string, unknown> = {};
              for (const k of Object.keys(this._selected!)) {
                out[k] = r[k];
              }
              return out;
            })
          : rows;
        return Promise.resolve(projected).then(resolve);
      },
    };
  }

  const db = {
    select(fields?: Record<string, unknown>) {
      return {
        _fields: fields,
        from(table: unknown) {
          let store: Record<string, unknown>[] = [];
          if (table === vehiclesTable) store = vehicles;
          else if (table === workOrdersTable) store = workOrders;
          else if (table === materialsCatalogTable) store = catalog;
          const q = makeQuery(store);
          if (fields) return q.select(fields);
          return q;
        },
      };
    },
  };

  return { db, vehiclesTable, workOrdersTable, materialsCatalogTable };
});

import scanMaterialsRouter from "../scan-materials";
import materialsRouter from "../materials";

function makeApp(): Express {
  const app = express();
  app.use(express.json({ limit: "15mb" }));
  // Attach a minimal req.log to avoid "Cannot read properties of undefined"
  app.use((_req, _res, next) => {
    (_req as unknown as { log: Record<string, unknown> }).log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
    };
    next();
  });
  app.use(scanMaterialsRouter);
  app.use(materialsRouter);
  return app;
}

beforeEach(() => {
  workOrders.length = 0;
  vehicles.length = 0;
  catalog.length = 0;
  vi.clearAllMocks();
});

// ─── scan-materials: SPZ resolution ──────────────────────────────────────────

describe("POST /work-orders/scan-materials — SPZ→work-order resolution", () => {
  it("returns 404 when no open work order exists for the SPZ", async () => {
    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/otevřená zakázka/);
  });

  it("returns 404 when the only work order is completed", async () => {
    vehicles.push({ id: 1, licensePlate: "1AB 1234" });
    workOrders.push({ id: 10, vehicleId: 1, licensePlate: "1AB 1234", status: "completed" });

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(404);
  });

  it("finds an open work order by vehicle link and returns suggestions", async () => {
    vehicles.push({ id: 1, licensePlate: "1AB 1234" });
    workOrders.push({ id: 42, vehicleId: 1, licensePlate: "1AB 1234", status: "open" });

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(200);
    expect(res.body.workOrderId).toBe(42);
    expect(Array.isArray(res.body.suggestions)).toBe(true);
  });

  it("finds an open work order by SPZ fallback when vehicle is not in DB", async () => {
    workOrders.push({ id: 7, vehicleId: null, licensePlate: "9ZZ 9999", status: "in_progress" });

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "9ZZ 9999", images: ["aGVsbG8="] });

    expect(res.status).toBe(200);
    expect(res.body.workOrderId).toBe(7);
  });

  it("returns 400 for missing images", async () => {
    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: [] });

    expect(res.status).toBe(400);
  });
});

// ─── scan-materials: catalog matching ────────────────────────────────────────

describe("POST /work-orders/scan-materials — catalog matching", () => {
  it("populates catalogId and unitPrice when a catalog hit is found", async () => {
    workOrders.push({ id: 1, vehicleId: null, licensePlate: "1AB 1234", status: "open" });
    catalog.push({ id: 99, name: "Vzduchový filtr", unit: "ks", defaultPrice: 350 });

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(200);
    const suggestion = res.body.suggestions[0];
    expect(suggestion.catalogId).toBe(99);
    expect(suggestion.unitPrice).toBe(350);
    expect(suggestion.unit).toBe("ks");
  });

  it("leaves catalogId null when no catalog match is found", async () => {
    workOrders.push({ id: 1, vehicleId: null, licensePlate: "1AB 1234", status: "open" });
    // Catalog has an unrelated item
    catalog.push({ id: 5, name: "Brzdové destičky", unit: "sada", defaultPrice: 800 });

    const res = await request(makeApp())
      .post("/work-orders/scan-materials")
      .send({ licensePlate: "1AB 1234", images: ["aGVsbG8="] });

    expect(res.status).toBe(200);
    const suggestion = res.body.suggestions[0];
    expect(suggestion.catalogId).toBeNull();
  });
});

// ─── /materials/:id/qr ───────────────────────────────────────────────────────

describe("GET /materials/:id/qr", () => {
  it("returns the correct QR payload shape for a known item", async () => {
    catalog.push({ id: 5, name: "Motorový olej 5W-40", unit: "l", defaultPrice: 350 });

    const res = await request(makeApp()).get("/materials/5/qr");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 5,
      name: "Motorový olej 5W-40",
      unit: "l",
      payload: "autoservis:material:5:Motorový olej 5W-40",
    });
  });

  it("encodes the payload with the correct scheme prefix", async () => {
    catalog.push({ id: 12, name: "Vzduchový filtr", unit: "ks", defaultPrice: 120 });

    const res = await request(makeApp()).get("/materials/12/qr");

    expect(res.status).toBe(200);
    expect(res.body.payload).toBe("autoservis:material:12:Vzduchový filtr");
  });

  it("returns null for unit when the catalog item has no unit", async () => {
    catalog.push({ id: 3, name: "Pojistka", unit: null, defaultPrice: null });

    const res = await request(makeApp()).get("/materials/3/qr");

    expect(res.status).toBe(200);
    expect(res.body.unit).toBeNull();
  });

  it("returns 404 for an unknown catalog item", async () => {
    const res = await request(makeApp()).get("/materials/999/qr");

    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
