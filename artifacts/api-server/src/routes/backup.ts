import { Router, type IRouter, json } from "express";
import multer from "multer";
import { getTableColumns, sql, eq } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { gunzipSync } from "zlib";
import JSZip from "jszip";
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
  backupsTable,
} from "@workspace/db";
import { getObjectStorageService, ObjectNotFoundError } from "../lib/storage";
import { createBackupSnapshot, createFullBackupZip, listBackups, runBackup } from "../lib/backups";
import { mapLimit } from "../lib/concurrency";

const router: IRouter = Router();

// Full-backup ZIPs can be large (every photo blob); allow a generous limit.
const uploadZip = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

/**
 * GET /backup/export
 *
 * Dump every table to a single JSON document the user can download.
 */
router.get("/backup/export", async (req, res): Promise<void> => {
  try {
    const snapshot = await createBackupSnapshot();
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Backup export failed");
    res.status(500).json({ error: "Export zálohy selhal" });
  }
});

/**
 * GET /backups
 *
 * List the most recent automatic backups (newest first).
 */
router.get("/backups", async (req, res): Promise<void> => {
  try {
    res.json(await listBackups());
  } catch (err) {
    req.log.error({ err }, "Listing backups failed");
    res.status(500).json({ error: "Načtení záloh selhalo" });
  }
});

/**
 * POST /backups/run
 *
 * Create a backup now and upload it to the object store (manual trigger).
 */
router.post("/backups/run", async (req, res): Promise<void> => {
  try {
    const result = await runBackup();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Manual backup failed");
    res.status(500).json({
      error: "Vytvoření zálohy selhalo. Zkontrolujte nastavení úložiště (S3).",
    });
  }
});

/**
 * GET /backups/:id/download
 *
 * Stream a stored backup as a plain JSON file (decompressed on the fly) so it
 * can be restored directly through the existing "Obnovit ze zálohy" import.
 */
router.get("/backups/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Neplatné ID zálohy" });
    return;
  }
  try {
    const [row] = await db
      .select()
      .from(backupsTable)
      .where(eq(backupsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Záloha nenalezena" });
      return;
    }

    const storage = getObjectStorageService();
    const obj = await storage.serveObject(row.objectPath);
    const chunks: Buffer[] = [];
    for await (const chunk of obj.stream) {
      chunks.push(Buffer.from(chunk));
    }
    const json = gunzipSync(Buffer.concat(chunks));

    const downloadName = row.filename.replace(/\.gz$/, "");
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName}"`,
    );
    res.send(json);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Soubor zálohy nebyl v úložišti nalezen" });
      return;
    }
    req.log.error({ err }, "Backup download failed");
    res.status(500).json({ error: "Stažení zálohy selhalo" });
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

type ImportData = z.infer<typeof ImportBody>["data"];

/**
 * Merge an exported backup's table data into the current database: rows missing
 * in the DB are inserted, rows that already exist (matched by id) are updated
 * with the backup's values. Nothing is deleted. IDs are preserved and serial
 * sequences realigned afterwards so future inserts don't collide.
 */
async function mergeBackupData(d: ImportData): Promise<Record<string, number>> {
  return db.transaction(async (tx) => {
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
}

/**
 * After a restore, check which photo blobs are missing from storage so the UI
 * can warn that a DB-only backup was restored without its files.
 */
async function reportMissingFiles(): Promise<Array<{ photoId: number; url: string; filename: string | null }>> {
  const storage = getObjectStorageService();
  const photos = await db
    .select({ id: photosTable.id, url: photosTable.url, filename: photosTable.filename })
    .from(photosTable);
  const presence = await mapLimit(photos, 8, (p) => storage.objectExists(p.url));
  return photos
    .filter((_, i) => !presence[i])
    .map((p) => ({ photoId: p.id, url: p.url, filename: p.filename }));
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
};

function guessContentType(name: string | null | undefined): string {
  const ext = (name ?? "").toLowerCase().split(".").pop() ?? "";
  return CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * GET /backup/full
 *
 * Download a complete backup ZIP (backup.json + objects/) when the storage
 * driver can read objects back. Streams the archive; reports any missing files
 * via a response header so the client can surface a warning.
 */
router.get("/backup/full", async (req, res): Promise<void> => {
  try {
    const result = await createFullBackupZip();
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.setHeader("X-Included-Objects", String(result.includedObjects));
    res.setHeader("X-Missing-Objects", String(result.missingObjects.length));
    res.send(result.buffer);
  } catch (err) {
    req.log.error({ err }, "Full backup export failed");
    res.status(500).json({ error: "Vytvoření úplné zálohy selhalo" });
  }
});

/**
 * POST /backup/import
 *
 * Merge the contents of an exported JSON backup into the current data. Reports
 * any photo files still missing from storage after the merge.
 */
router.post("/backup/import", importJson, async (req, res): Promise<void> => {
  const parsed = ImportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Soubor zálohy je neplatný nebo poškozený" });
    return;
  }

  try {
    const merged = await mergeBackupData(parsed.data.data);
    const missingFiles = await reportMissingFiles();
    res.json({ ok: true, merged, missingFiles });
  } catch (err) {
    req.log.error({ err }, "Backup import failed");
    res.status(500).json({ error: "Obnova ze zálohy selhala" });
  }
});

/**
 * POST /backup/import-full
 *
 * Restore a complete backup ZIP: merge backup.json, then re-upload every
 * objects/<entityId> entry back into storage. Reports how many files were
 * restored and any photo blobs that were absent from the archive.
 */
router.post("/backup/import-full", uploadZip.single("backup"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Chybí soubor zálohy" });
    return;
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(req.file.buffer);
  } catch {
    res.status(400).json({ error: "Soubor není platný ZIP archiv" });
    return;
  }

  const manifest = zip.file("backup.json");
  if (!manifest) {
    res.status(400).json({ error: "Archiv neobsahuje backup.json" });
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await manifest.async("string"));
  } catch {
    res.status(400).json({ error: "Soubor backup.json je poškozený" });
    return;
  }

  const parsed = ImportBody.safeParse(parsedJson);
  if (!parsed.success) {
    res.status(400).json({ error: "Soubor zálohy je neplatný nebo poškozený" });
    return;
  }

  try {
    const merged = await mergeBackupData(parsed.data.data);

    // Re-upload object blobs from the archive, guessing content type from the
    // matching photo row's filename.
    const storage = getObjectStorageService();
    const nameByUrl = new Map<string, string | null>();
    for (const p of parsed.data.data.photos) {
      const url = typeof p.url === "string" ? p.url : null;
      if (url) nameByUrl.set(url, typeof p.filename === "string" ? p.filename : null);
    }

    const objectEntries = Object.values(zip.files).filter(
      (f) => !f.dir && f.name.startsWith("objects/"),
    );
    let restoredFiles = 0;
    const failedFiles: string[] = [];
    for (const entry of objectEntries) {
      const entityId = entry.name.slice("objects/".length);
      const path = `/objects/${entityId}`;
      try {
        const buf = await entry.async("nodebuffer");
        await storage.restoreObject(path, buf, guessContentType(nameByUrl.get(path)));
        restoredFiles++;
      } catch (err) {
        req.log.error({ err, path }, "Restoring backup object failed");
        failedFiles.push(path);
      }
    }

    const missingFiles = await reportMissingFiles();
    res.json({ ok: true, merged, restoredFiles, failedFiles, missingFiles });
  } catch (err) {
    req.log.error({ err }, "Full backup import failed");
    res.status(500).json({ error: "Obnova z úplné zálohy selhala" });
  }
});

export default router;
