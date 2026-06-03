import { eq } from "drizzle-orm";
import { db, serviceRecordsTable, workOrdersTable, vehiclesTable } from "@workspace/db";

function addMonthsUtc(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

type Event = {
  date: string;
  km: number | null;
  oil: boolean;
  brakes: boolean;
  timing: boolean;
  transmissionOil: boolean;
  brakeFluid: boolean;
  stk: boolean;
};

/**
 * Recompute vehicle.currentKm, last* service dates/km and stkValidUntil
 * from the full history of service records and work orders.
 *
 * currentKm is monotonic and status-agnostic: it takes the highest Km known
 * across all service records and all work orders (any status) AND the vehicle's
 * existing currentKm. It never decreases and is never cleared once known.
 *
 * The "last *" service date/state fields stay authoritative over service
 * records + completed work orders only: if a service item is no longer recorded
 * anywhere, the corresponding "last *" field is cleared.
 */
export async function recomputeVehicleServiceStatus(vehicleId: number): Promise<void> {
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) return;

  const records = await db.select().from(serviceRecordsTable)
    .where(eq(serviceRecordsTable.vehicleId, vehicleId));
  // All work orders (any status) — needed for the Km candidate.
  const allOrders = await db.select().from(workOrdersTable)
    .where(eq(workOrdersTable.vehicleId, vehicleId));
  // Only completed work orders drive the "last *" service date/state fields.
  const orders = allOrders.filter((o) => o.status === "completed");

  const events: Event[] = [];
  for (const r of records) {
    events.push({
      date: r.date,
      km: r.km ?? null,
      oil: r.oilChanged,
      brakes: r.brakesServiced,
      timing: r.timingServiced,
      transmissionOil: r.transmissionOilChanged,
      brakeFluid: r.brakeFluidChanged,
      stk: r.stkPassed,
    });
  }
  for (const o of orders) {
    if (!o.serviceDate) continue;
    events.push({
      date: o.serviceDate,
      km: o.km ?? null,
      oil: o.oilChange,
      brakes: o.brakes,
      timing: o.timing,
      transmissionOil: o.transmissionOil,
      brakeFluid: o.brakeFluid,
      stk: o.stk,
    });
  }

  function latest(pick: (e: Event) => boolean): Event | null {
    let best: Event | null = null;
    for (const e of events) {
      if (!pick(e)) continue;
      if (!best || e.date > best.date) best = e;
    }
    return best;
  }

  // Km candidate spans ALL service records and ALL work orders regardless of
  // status. Current Km is monotonic: never decreases, never gets cleared once a
  // value is known. Only stays null when no Km exists anywhere and none was
  // previously stored.
  const kmCandidates: number[] = [];
  for (const r of records) if (r.km != null) kmCandidates.push(r.km);
  for (const o of allOrders) if (o.km != null) kmCandidates.push(o.km);
  if (vehicle.currentKm != null) kmCandidates.push(vehicle.currentKm);
  const maxKm = kmCandidates.length > 0 ? Math.max(...kmCandidates) : null;

  const oil = latest((e) => e.oil);
  const brakes = latest((e) => e.brakes);
  const timing = latest((e) => e.timing);
  const transOil = latest((e) => e.transmissionOil);
  const brakeFluid = latest((e) => e.brakeFluid);
  const stk = latest((e) => e.stk);

  const updates: Partial<typeof vehiclesTable.$inferInsert> = {
    currentKm: maxKm,
    lastOilChangeDate: oil?.date ?? null,
    lastOilChangeKm: oil?.km ?? null,
    lastBrakesDate: brakes?.date ?? null,
    lastTimingDate: timing?.date ?? null,
    lastTransmissionOilDate: transOil?.date ?? null,
    lastTransmissionOilKm: transOil?.km ?? null,
    lastBrakeFluidDate: brakeFluid?.date ?? null,
    stkValidUntil: stk ? addMonthsUtc(stk.date, 24) : vehicle.stkValidUntil ?? null,
  };

  await db.update(vehiclesTable).set(updates).where(eq(vehiclesTable.id, vehicleId));
}
