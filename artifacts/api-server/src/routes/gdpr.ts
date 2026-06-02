import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  serviceRecordsTable,
  workOrdersTable,
  appointmentsTable,
  photosTable,
  auditLogTable,
  customerReminderLogTable,
} from "@workspace/db";
import { SetVehicleConsentBody } from "@workspace/api-zod";
import { getObjectStorageService } from "../lib/storage";
import { audit } from "../lib/audit";

const router: IRouter = Router();
const storage = getObjectStorageService();

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function countFor(
  table: typeof serviceRecordsTable | typeof workOrdersTable | typeof appointmentsTable,
  vehicleId: number,
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.vehicleId, vehicleId));
  return row?.c ?? 0;
}

// GET /gdpr/search?q= — find vehicles holding personal data matching the query.
router.get("/gdpr/search", async (req, res): Promise<void> => {
  const q = (req.query.q ?? "").toString().trim();
  if (!q) {
    res.json({ vehicles: [] });
    return;
  }
  const pattern = `%${q}%`;

  // Vehicles whose linked appointments match the customer's name/phone.
  const apptRows = await db
    .select({ vid: appointmentsTable.vehicleId })
    .from(appointmentsTable)
    .where(
      and(
        isNotNull(appointmentsTable.vehicleId),
        or(
          ilike(appointmentsTable.customerName, pattern),
          ilike(appointmentsTable.customerPhone, pattern),
        ),
      ),
    );
  const apptVehicleIds = Array.from(
    new Set(apptRows.map((r) => r.vid).filter((v): v is number => v != null)),
  );

  const conditions = [
    ilike(vehiclesTable.licensePlate, pattern),
    ilike(vehiclesTable.ownerName, pattern),
    ilike(vehiclesTable.ownerAddress, pattern),
    ilike(vehiclesTable.ownerPhone, pattern),
    ilike(vehiclesTable.ownerEmail, pattern),
    ilike(vehiclesTable.ownerIco, pattern),
    ilike(vehiclesTable.ownerDic, pattern),
  ];
  if (apptVehicleIds.length > 0) {
    conditions.push(inArray(vehiclesTable.id, apptVehicleIds));
  }

  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(or(...conditions))
    .orderBy(vehiclesTable.licensePlate);

  const vehicles = await Promise.all(
    rows.map(async (v) => ({
      id: v.id,
      licensePlate: v.licensePlate,
      ownerType: v.ownerType,
      ownerName: v.ownerName,
      ownerPhone: v.ownerPhone,
      ownerEmail: v.ownerEmail,
      consentGivenAt: v.consentGivenAt ? v.consentGivenAt.toISOString() : null,
      serviceRecordCount: await countFor(serviceRecordsTable, v.id),
      workOrderCount: await countFor(workOrdersTable, v.id),
      appointmentCount: await countFor(appointmentsTable, v.id),
    })),
  );

  res.json({ vehicles });
});

// GET /gdpr/export/:vehicleId — full data export for a data-subject access request.
router.get("/gdpr/export/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [serviceRecords, workOrders, appointments] = await Promise.all([
    db.select().from(serviceRecordsTable).where(eq(serviceRecordsTable.vehicleId, id)),
    db.select().from(workOrdersTable).where(eq(workOrdersTable.vehicleId, id)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.vehicleId, id)),
  ]);

  await audit("gdpr_export", {
    entity: "vehicle",
    entityId: id,
    detail: `Export dat vozidla ${vehicle.licensePlate}`,
  });

  res.json({
    exportedAt: new Date().toISOString(),
    vehicle,
    serviceRecords,
    workOrders,
    appointments,
  });
});

// POST /gdpr/anonymize/:vehicleId — strip personal data, keep technical history.
router.post("/gdpr/anonymize/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(vehiclesTable)
      .set({
        ownerType: "private",
        ownerName: null,
        ownerAddress: null,
        ownerIco: null,
        ownerDic: null,
        ownerPhone: null,
        ownerEmail: null,
        consentGivenAt: null,
        consentNote: null,
      })
      .where(eq(vehiclesTable.id, id));

    await tx
      .update(appointmentsTable)
      .set({ customerName: null, customerPhone: null })
      .where(eq(appointmentsTable.vehicleId, id));

    // Drop the customer-reminder ledger so a future re-consent starts clean.
    await tx
      .delete(customerReminderLogTable)
      .where(eq(customerReminderLogTable.vehicleId, id));
  });

  await audit("gdpr_anonymize", {
    entity: "vehicle",
    entityId: id,
    detail: `Anonymizace osobních údajů vozidla ${vehicle.licensePlate}`,
  });

  res.json({ success: true, message: "Osobní údaje byly anonymizovány." });
});

// DELETE /gdpr/vehicle/:vehicleId — permanently erase the vehicle and all linked data.
router.delete("/gdpr/vehicle/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  // Work orders for this vehicle (vehicleId is set-null, so delete explicitly).
  const workOrders = await db
    .select({ id: workOrdersTable.id })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.vehicleId, id));
  const workOrderIds = workOrders.map((w) => w.id);

  // Erase the underlying photo blobs from object storage FIRST. If any blob
  // fails to delete we must not claim a complete erasure, so we abort before
  // touching the DB. deleteObject is idempotent, so a retry is safe.
  if (workOrderIds.length > 0) {
    const photos = await db
      .select({ url: photosTable.url })
      .from(photosTable)
      .where(inArray(photosTable.workOrderId, workOrderIds));
    const results = await Promise.allSettled(photos.map((p) => storage.deleteObject(p.url)));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      req.log.error(
        { vehicleId: id, failed: failed.length },
        "GDPR erasure aborted: failed to delete photo blobs from storage",
      );
      res.status(500).json({
        error: "Smazání fotografií z úložiště selhalo. Data nebyla smazána, zkuste to znovu.",
      });
      return;
    }
  }

  await db.transaction(async (tx) => {
    if (workOrderIds.length > 0) {
      // Removing work orders cascades the photo rows.
      await tx.delete(workOrdersTable).where(inArray(workOrdersTable.id, workOrderIds));
    }
    // Appointments use set-null on vehicle delete, so remove them explicitly.
    await tx.delete(appointmentsTable).where(eq(appointmentsTable.vehicleId, id));
    // service_records cascade with the vehicle.
    await tx.delete(vehiclesTable).where(eq(vehiclesTable.id, id));
  });

  await audit("gdpr_delete", {
    entity: "vehicle",
    entityId: id,
    detail: `Trvalé smazání vozidla ${vehicle.licensePlate} a všech souvisejících dat`,
  });

  res.json({ success: true, message: "Vozidlo a všechna související data byla smazána." });
});

// PUT /gdpr/consent/:vehicleId — record or withdraw the owner's processing consent.
router.put("/gdpr/consent/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const parsed = SetVehicleConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const [updated] = await db
    .update(vehiclesTable)
    .set({
      consentGivenAt: parsed.data.given ? new Date() : null,
      consentNote: parsed.data.note ?? null,
    })
    .where(eq(vehiclesTable.id, id))
    .returning();

  await audit("gdpr_consent", {
    entity: "vehicle",
    entityId: id,
    detail: `${parsed.data.given ? "Udělen" : "Odvolán"} souhlas se zpracováním pro vozidlo ${vehicle.licensePlate}`,
  });

  res.json(updated);
});

// GET /gdpr/audit-log — recent audit entries, most recent first.
router.get("/gdpr/audit-log", async (req, res): Promise<void> => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const rows = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
  res.json(rows);
});

export default router;
