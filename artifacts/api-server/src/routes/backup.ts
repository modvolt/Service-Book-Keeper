import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  vehiclesTable,
  serviceRecordsTable,
  workOrdersTable,
  materialsCatalogTable,
  workOrderMaterialsTable,
  photosTable,
  appointmentsTable,
  settingsTable,
} from "@workspace/db";

const router: IRouter = Router();

const BACKUP_VERSION = 1;

/**
 * GET /backup/export
 *
 * Dump every table to a single JSON document the user can download.
 */
router.get("/backup/export", async (req, res): Promise<void> => {
  try {
    // Read every table inside one transaction for a consistent point-in-time snapshot.
    const {
      vehicles,
      serviceRecords,
      workOrders,
      materialsCatalog,
      workOrderMaterials,
      photos,
      appointments,
      settings,
    } = await db.transaction(async (tx) => ({
      vehicles: await tx.select().from(vehiclesTable),
      serviceRecords: await tx.select().from(serviceRecordsTable),
      workOrders: await tx.select().from(workOrdersTable),
      materialsCatalog: await tx.select().from(materialsCatalogTable),
      workOrderMaterials: await tx.select().from(workOrderMaterialsTable),
      photos: await tx.select().from(photosTable),
      appointments: await tx.select().from(appointmentsTable),
      settings: await tx.select().from(settingsTable),
    }));

    res.json({
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      data: {
        vehicles,
        serviceRecords,
        workOrders,
        materialsCatalog,
        workOrderMaterials,
        photos,
        appointments,
        settings,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Backup export failed");
    res.status(500).json({ error: "Export zálohy selhal" });
  }
});

const RowList = z.array(z.record(z.string(), z.unknown()));

const ImportBody = z.object({
  version: z.number().optional(),
  exportedAt: z.string().optional(),
  data: z.object({
    vehicles: RowList.optional().default([]),
    serviceRecords: RowList.optional().default([]),
    workOrders: RowList.optional().default([]),
    materialsCatalog: RowList.optional().default([]),
    workOrderMaterials: RowList.optional().default([]),
    photos: RowList.optional().default([]),
    appointments: RowList.optional().default([]),
    settings: RowList.optional().default([]),
  }),
});

type Row = Record<string, unknown>;

function withDates(rows: Row[], dateKeys: string[]): Row[] {
  return rows.map((row) => {
    const out: Row = { ...row };
    for (const k of dateKeys) {
      if (out[k] != null && typeof out[k] === "string") out[k] = new Date(out[k] as string);
    }
    return out;
  });
}

/**
 * POST /backup/import
 *
 * Replace all data with the contents of an exported backup.
 * Existing rows are wiped first; IDs from the backup are preserved so that
 * relationships stay intact, and serial sequences are realigned afterwards.
 */
router.post("/backup/import", async (req, res): Promise<void> => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Soubor zálohy je neplatný nebo poškozený" });
    return;
  }

  const d = parsed.data.data;

  try {
    await db.transaction(async (tx) => {
      // Wipe in FK-safe order (children first).
      await tx.delete(photosTable);
      await tx.delete(workOrderMaterialsTable);
      await tx.delete(appointmentsTable);
      await tx.delete(workOrdersTable);
      await tx.delete(serviceRecordsTable);
      await tx.delete(materialsCatalogTable);
      await tx.delete(vehiclesTable);
      await tx.delete(settingsTable);

      // Insert in FK-safe order (parents first), preserving IDs.
      if (d.vehicles.length)
        await tx.insert(vehiclesTable).values(withDates(d.vehicles, ["createdAt"]) as any);
      if (d.serviceRecords.length)
        await tx.insert(serviceRecordsTable).values(withDates(d.serviceRecords, ["createdAt"]) as any);
      if (d.workOrders.length)
        await tx.insert(workOrdersTable).values(withDates(d.workOrders, ["createdAt", "completedAt"]) as any);
      if (d.materialsCatalog.length)
        await tx.insert(materialsCatalogTable).values(withDates(d.materialsCatalog, ["createdAt"]) as any);
      if (d.workOrderMaterials.length)
        await tx.insert(workOrderMaterialsTable).values(withDates(d.workOrderMaterials, ["createdAt"]) as any);
      if (d.photos.length)
        await tx.insert(photosTable).values(withDates(d.photos, ["createdAt"]) as any);
      if (d.appointments.length)
        await tx.insert(appointmentsTable).values(withDates(d.appointments, ["createdAt"]) as any);
      if (d.settings.length)
        await tx.insert(settingsTable).values(withDates(d.settings, ["updatedAt"]) as any);
      else
        await tx.insert(settingsTable).values({ id: 1 });

      // Realign serial sequences so future inserts don't collide with restored IDs.
      const serialTables = [
        "vehicles",
        "service_records",
        "work_orders",
        "materials_catalog",
        "work_order_materials",
        "photos",
        "appointments",
      ];
      for (const t of serialTables) {
        await tx.execute(
          sql`SELECT setval(pg_get_serial_sequence(${t}, 'id'), COALESCE((SELECT MAX(id) FROM ${sql.raw(`"${t}"`)}), 1), (SELECT COUNT(*) > 0 FROM ${sql.raw(`"${t}"`)}))`,
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Backup import failed");
    res.status(500).json({ error: "Obnova ze zálohy selhala" });
  }
});

export default router;
