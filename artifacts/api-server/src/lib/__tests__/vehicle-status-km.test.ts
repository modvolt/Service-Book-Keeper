import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@workspace/db", () => import("../../test-support/fake-db"));

import { recomputeVehicleServiceStatus } from "../vehicleStatus";
import {
  __store,
  vehiclesTable,
  workOrdersTable,
  serviceRecordsTable,
} from "../../test-support/fake-db";

function seedVehicle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    licensePlate: "1AB1234",
    make: "Skoda",
    model: "Octavia",
    currentKm: null,
    stkValidUntil: null,
    ...overrides,
  };
  __store.get(vehiclesTable).push(row);
  return row;
}

function seedWorkOrder(overrides: Record<string, unknown> = {}): void {
  __store.get(workOrdersTable).push({
    id: __store.get(workOrdersTable).length + 1,
    vehicleId: 1,
    status: "completed",
    serviceDate: "2025-01-01",
    km: null,
    oilChange: false,
    brakes: false,
    timing: false,
    transmissionOil: false,
    brakeFluid: false,
    stk: false,
    ...overrides,
  });
}

function seedServiceRecord(overrides: Record<string, unknown> = {}): void {
  __store.get(serviceRecordsTable).push({
    id: __store.get(serviceRecordsTable).length + 1,
    vehicleId: 1,
    date: "2025-01-01",
    km: null,
    oilChanged: false,
    brakesServiced: false,
    timingServiced: false,
    transmissionOilChanged: false,
    brakeFluidChanged: false,
    stkPassed: false,
    ...overrides,
  });
}

beforeEach(() => {
  __store.reset();
});

describe("recomputeVehicleServiceStatus — currentKm", () => {
  it("does not clear a known currentKm when completed orders/records lack Km", async () => {
    seedVehicle({ currentKm: 85500 });
    seedWorkOrder({ status: "completed", km: null });
    seedServiceRecord({ km: null });

    await recomputeVehicleServiceStatus(1);

    const [v] = __store.get(vehiclesTable);
    expect(v.currentKm).toBe(85500);
  });

  it("reflects an open work order's Km in currentKm", async () => {
    seedVehicle({ currentKm: null });
    seedWorkOrder({ status: "open", km: 327036 });
    seedWorkOrder({ status: "completed", km: null });

    await recomputeVehicleServiceStatus(1);

    const [v] = __store.get(vehiclesTable);
    expect(v.currentKm).toBe(327036);
  });

  it("never lowers currentKm — keeps the highest known value", async () => {
    seedVehicle({ currentKm: 120000 });
    seedWorkOrder({ status: "completed", km: 90000 });

    await recomputeVehicleServiceStatus(1);

    const [v] = __store.get(vehiclesTable);
    expect(v.currentKm).toBe(120000);
  });

  it("takes the max Km across records and work orders of any status", async () => {
    seedVehicle({ currentKm: 100000 });
    seedWorkOrder({ status: "in_progress", km: 110000 });
    seedWorkOrder({ status: "completed", km: 105000 });
    seedServiceRecord({ km: 130000 });

    await recomputeVehicleServiceStatus(1);

    const [v] = __store.get(vehiclesTable);
    expect(v.currentKm).toBe(130000);
  });

  it("stays null only when no Km exists anywhere and none was stored", async () => {
    seedVehicle({ currentKm: null });
    seedWorkOrder({ status: "completed", km: null });
    seedServiceRecord({ km: null });

    await recomputeVehicleServiceStatus(1);

    const [v] = __store.get(vehiclesTable);
    expect(v.currentKm).toBeNull();
  });
});
