import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import type { Response } from "express";
import request from "supertest";

/**
 * The scan-handoff decision hinges on matching the scanned (normalized) SPZ
 * against stored vehicles via `ilike`. The shared `fake-db` ignores `where`
 * predicates, so it can't tell "known" from "unknown" plate. This file mocks
 * `@workspace/db` + `drizzle-orm`'s `ilike` with a store that filters vehicles
 * by license plate (case-insensitive equality, mirroring `ilike` without
 * wildcards), and uses the real in-memory `scan-bus` to assert broadcast /
 * exclusion semantics.
 */

const { vehicles } = vi.hoisted(() => ({
  vehicles: [] as Record<string, unknown>[],
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("drizzle-orm", () => ({
  ilike: (column: unknown, value: string) => ({ __ilike: true as const, column, value }),
}));

vi.mock("@workspace/db", () => {
  const vehiclesTable = { licensePlate: { __col: "licensePlate" } };
  const db = {
    select() {
      return {
        from(_table: unknown) {
          return {
            where(pred: { value?: string }): Promise<Record<string, unknown>[]> {
              const wanted = (pred?.value ?? "").toLowerCase();
              return Promise.resolve(
                vehicles.filter(
                  (row) => String(row.licensePlate).toLowerCase() === wanted,
                ),
              );
            },
          };
        },
      };
    },
  };
  return { db, vehiclesTable };
});

import scanRouter from "../scan-handoff";
import { addScanClient, removeScanClient } from "../../lib/scan-bus";

function makeApp(): Express {
  const app = express();
  app.use(scanRouter);
  return app;
}

function seedVehicle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    licensePlate: "1AB 1234",
    make: "Skoda",
    model: "Octavia",
    currentKm: 100_000,
    ...overrides,
  };
  vehicles.push(row);
  return row;
}

const trackedClients: string[] = [];

interface CapturingClient {
  id: string;
  writes: string[];
  lastHandoff(): Record<string, unknown> | null;
}

/**
 * Register a fake SSE client that records everything written to it. The handoff
 * broadcast writes `event: handoff\n` then `data: <json>\n\n`, so we reconstruct
 * the last delivered handoff payload from the captured chunks.
 */
function addCapturingClient(): CapturingClient {
  const writes: string[] = [];
  const res = {
    write: (chunk: string): boolean => {
      writes.push(chunk);
      return true;
    },
  } as unknown as Response;
  const id = addScanClient(res);
  trackedClients.push(id);
  return {
    id,
    writes,
    lastHandoff(): Record<string, unknown> | null {
      const blocks = writes.join("").split("\n\n").filter(Boolean);
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].includes("event: handoff")) {
          const m = blocks[i].match(/data: (.*)/);
          if (m) return JSON.parse(m[1]) as Record<string, unknown>;
        }
      }
      return null;
    },
  };
}

beforeEach(() => {
  vehicles.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  for (const id of trackedClients) removeScanClient(id);
  trackedClients.length = 0;
});

describe("POST /scan/handoff — decision routing", () => {
  it("routes an unknown SPZ to a pre-filled new-vehicle form and carries the odometer", async () => {
    const pc = addCapturingClient();

    const res = await request(makeApp()).post("/scan/handoff").send({
      licensePlate: "9zz 9999",
      vin: "TMBEM41Z0X8000001",
      registrationYear: 2018,
      engineDisplacement: 1968,
      make: "Volkswagen",
      model: "Passat",
      odometerKm: 75_000,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ delivered: 1, kind: "new-vehicle" });

    const event = pc.lastHandoff();
    expect(event).toMatchObject({
      kind: "new-vehicle",
      prefill: {
        // Normalized to canonical "XXX XXXX" form.
        licensePlate: "9ZZ 9999",
        vin: "TMBEM41Z0X8000001",
        registrationYear: 2018,
        engineDisplacement: 1968,
        make: "Volkswagen",
        model: "Passat",
        odometerKm: 75_000,
      },
    });
  });

  it("routes a known SPZ to a new work order with the vehicle identity", async () => {
    const vehicle = seedVehicle({ id: 42, currentKm: 50_000 });
    const pc = addCapturingClient();

    // Lower-case / unspaced input must still match the stored plate via ilike.
    const res = await request(makeApp()).post("/scan/handoff").send({
      licensePlate: "1ab1234",
      odometerKm: 60_000,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ delivered: 1, kind: "work-order" });

    const event = pc.lastHandoff();
    expect(event).toMatchObject({
      kind: "work-order",
      vehicleId: vehicle.id,
      licensePlate: "1AB 1234",
      make: "Skoda",
      model: "Octavia",
      prefill: { km: 60_000 },
    });
  });
});

describe("POST /scan/handoff — odometer carry for known vehicles", () => {
  async function handoffKm(scanned: number | null): Promise<number | null> {
    const pc = addCapturingClient();
    await request(makeApp())
      .post("/scan/handoff")
      .send({ licensePlate: "1AB 1234", odometerKm: scanned });
    const event = pc.lastHandoff();
    return ((event?.prefill as { km: number | null }).km) ?? null;
  }

  it("carries km when strictly greater than the stored reading", async () => {
    seedVehicle({ currentKm: 100_000 });
    expect(await handoffKm(120_000)).toBe(120_000);
  });

  it("drops km when equal to the stored reading", async () => {
    seedVehicle({ currentKm: 100_000 });
    expect(await handoffKm(100_000)).toBeNull();
  });

  it("drops km when lower than the stored reading", async () => {
    seedVehicle({ currentKm: 100_000 });
    expect(await handoffKm(90_000)).toBeNull();
  });

  it("carries km when the vehicle has no stored reading yet", async () => {
    seedVehicle({ currentKm: null });
    expect(await handoffKm(80_000)).toBe(80_000);
  });

  it("leaves km null when nothing was scanned", async () => {
    seedVehicle({ currentKm: 100_000 });
    expect(await handoffKm(null)).toBeNull();
  });
});

describe("POST /scan/handoff — broadcast semantics", () => {
  it("excludes the originating client and reports the delivered count", async () => {
    const source = addCapturingClient();
    const pcA = addCapturingClient();
    const pcB = addCapturingClient();

    const res = await request(makeApp()).post("/scan/handoff").send({
      licensePlate: "9zz 9999",
      sourceClientId: source.id,
    });

    expect(res.status).toBe(200);
    // Two other open sessions receive it; the scanning phone does not.
    expect(res.body).toEqual({ delivered: 2, kind: "new-vehicle" });

    expect(source.writes).toHaveLength(0);
    expect(pcA.lastHandoff()).toMatchObject({ kind: "new-vehicle" });
    expect(pcB.lastHandoff()).toMatchObject({ kind: "new-vehicle" });
  });

  it("delivers to every open client when no source is given", async () => {
    const pcA = addCapturingClient();
    const pcB = addCapturingClient();

    const res = await request(makeApp())
      .post("/scan/handoff")
      .send({ licensePlate: "9zz 9999" });

    expect(res.body).toEqual({ delivered: 2, kind: "new-vehicle" });
    expect(pcA.lastHandoff()).not.toBeNull();
    expect(pcB.lastHandoff()).not.toBeNull();
  });
});
