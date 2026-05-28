import { eq, and } from "drizzle-orm";
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
 * from the full history of service records and completed work orders.
 * Authoritative: if a service item is no longer recorded anywhere, the
 * corresponding "last *" field is cleared.
 */
export async function recomputeVehicleServiceStatus(vehicleId: number): Promise<void> {
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle) return;

  const records = await db.select().from(serviceRecordsTable)
    .where(eq(serviceRecordsTable.vehicleId, vehicleId));
  const orders = await db.select().from(workOrdersTable)
    .where(and(eq(workOrdersTable.vehicleId, vehicleId), eq(workOrdersTable.status, "completed")));

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

  const kmEvents = events.filter((e) => e.km != null);
  const maxKm = kmEvents.length > 0 ? Math.max(...kmEvents.map((e) => e.km as number)) : null;

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
