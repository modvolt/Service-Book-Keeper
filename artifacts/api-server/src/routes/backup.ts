import { Router, type IRouter, json } from "express";
import { getTableColumns, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
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

// Keep only columns the table actually has (so a backup taken before a column was
// removed still imports), and turn ISO strings back into Date objects for
// timestamp columns. `date` columns use mode:"string" (dataType "string") so they
// pass through untouched; only timestamps (dataType "date") need coercion.
function coerceRows(table: PgTable, rows: Row[]): Row[] {
  const cols = getTableColumns(table);
  return rows.map((row) => {
    const out: Row = {};
    for (const [key, col] of Object.entries(cols)) {
      if (!(key in row)) continue;
      let v = row[key];
      if (v != null && typeof v === "string" && (col as { dataType?: string }).dataType === "date") {
        v = new Date(v);
      }
      out[key] = v;
    }
    return out;
  });
}

// On id conflict, overwrite every non-id column with the value from the backup
// row (`excluded`). This is what makes the merge "update existing".
function excludedSet(table: PgTable): Record<string, unknown> {
  const cols = getTableColumns(table);
  // Keyed by the Drizzle property name; the value references the proposed row.
  const out: Record<string, unknown> = {};
  for (const [key, col] of Object.entries(cols)) {
    const name = (col as { name: string }).name;
    if (name === "id") continue;
    out[key] = sql`excluded.${sql.identifier(name)}`;
  }
  return out;
}

const importJson = json({ limit: "10mb" });

/**
 * POST /backup/import
 *
 * Merge the contents of an exported backup into the current data:
 * rows missing in the database are inserted, rows that already exist (matched by
 * id) are updated with the backup's values. Nothing is deleted — records present
 * in the database but absent from the backup are left untouched. IDs from the
 * backup are preserved and serial sequences are realigned afterwards so future
 * inserts don't collide.
 */
router.post("/backup/import", importJson, async (req, res): Promise<void> => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Soubor zálohy je neplatný nebo poškozený" });
    return;
  }

  const d = parsed.data.data;

  try {
    const merged = await db.transaction(async (tx) => {
      const merge = async (table: PgTable, rows: Row[]): Promise<number> => {
        if (!rows.length) return 0;
        const values = coerceRows(table, rows);
        await tx
          .insert(table)
          .values(values as any)
          .onConflictDoUpdate({ target: (table as any).id, set: excludedSet(table) as any });
        return values.length;
      };

      // Parents before children so foreign keys resolve for newly-inserted rows.
      const summary = {
        vehicles: await merge(vehiclesTable, d.vehicles),
        materialsCatalog: await merge(materialsCatalogTable, d.materialsCatalog),
        workOrders: await merge(workOrdersTable, d.workOrders),
        serviceRecords: await merge(serviceRecordsTable, d.serviceRecords),
        appointments: await merge(appointmentsTable, d.appointments),
        workOrderMaterials: await merge(workOrderMaterialsTable, d.workOrderMaterials),
        photos: await merge(photosTable, d.photos),
        settings: await merge(settingsTable, d.settings),
      };

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

      return summary;
    });

    res.json({ ok: true, merged });
  } catch (err) {
    req.log.error({ err }, "Backup import failed");
    res.status(500).json({ error: "Obnova ze zálohy selhala" });
  }
});

export default router;
