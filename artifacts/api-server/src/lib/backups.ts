import { gzipSync } from "zlib";
import { desc, eq } from "drizzle-orm";
import {
  db,
  backupsTable,
  settingsTable,
  vehiclesTable,
  serviceRecordsTable,
  workOrdersTable,
  materialsCatalogTable,
  workOrderMaterialsTable,
  photosTable,
  appointmentsTable,
} from "@workspace/db";
import { getObjectStorageService } from "./storage";
import { logger } from "./logger";

const BACKUP_VERSION = 1;

/** Default number of most-recent backups to retain (older ones are pruned). */
const DEFAULT_RETENTION = 14;

function retentionCount(): number {
  const raw = process.env["BACKUP_RETENTION_COUNT"];
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION;
  return Math.floor(n);
}

/**
 * Point-in-time snapshot of every business table, in the exact shape the
 * manual `/backup/export` produces — so an automatic backup is restorable
 * through the existing `/backup/import` path. All tables are read inside one
 * transaction for consistency.
 */
export async function createBackupSnapshot(): Promise<{
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}> {
  const data = await db.transaction(async (tx) => ({
    vehicles: await tx.select().from(vehiclesTable),
    serviceRecords: await tx.select().from(serviceRecordsTable),
    workOrders: await tx.select().from(workOrdersTable),
    materialsCatalog: await tx.select().from(materialsCatalogTable),
    workOrderMaterials: await tx.select().from(workOrderMaterialsTable),
    photos: await tx.select().from(photosTable),
    appointments: await tx.select().from(appointmentsTable),
    settings: await tx.select().from(settingsTable),
  }));

  return { version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

export interface BackupRow {
  id: number;
  filename: string;
  sizeBytes: number;
  status: string;
  createdAt: string;
}

export interface BackupRunResult {
  ok: boolean;
  message: string;
  backup?: BackupRow;
}

function toRow(r: typeof backupsTable.$inferSelect): BackupRow {
  return {
    id: r.id,
    filename: r.filename,
    sizeBytes: r.sizeBytes,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Most-recent backups first. */
export async function listBackups(): Promise<BackupRow[]> {
  const rows = await db
    .select()
    .from(backupsTable)
    .orderBy(desc(backupsTable.createdAt));
  return rows.map(toRow);
}

/**
 * Delete the gzipped object for every backup beyond the newest `retentionCount`
 * and remove its row. A blob delete failure is logged but does not abort the
 * backup that triggered the prune — the row is only removed once the blob is
 * gone, so a failed prune is retried next time.
 */
async function pruneOldBackups(): Promise<void> {
  const keep = retentionCount();
  const rows = await db
    .select()
    .from(backupsTable)
    .orderBy(desc(backupsTable.createdAt));
  const stale = rows.slice(keep);
  if (stale.length === 0) return;

  const storage = getObjectStorageService();
  for (const row of stale) {
    try {
      await storage.deleteObject(row.objectPath);
      await db.delete(backupsTable).where(eq(backupsTable.id, row.id));
    } catch (err) {
      logger.error({ err, backupId: row.id }, "Pruning old backup failed");
    }
  }
}

/**
 * Create a backup now: serialize a snapshot, gzip it, upload it to the object
 * store, record it, and prune old backups. Throws on failure so callers can
 * surface the error (the route maps it to a 500; the scheduler logs it).
 */
export async function runBackup(): Promise<BackupRunResult> {
  const snapshot = await createBackupSnapshot();
  const json = JSON.stringify(snapshot);
  const gz = gzipSync(Buffer.from(json, "utf8"));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `autoservis-zaloha-${stamp}.json.gz`;

  const storage = getObjectStorageService();
  const objectPath = await storage.putBackupObject(filename, gz, "application/gzip");

  const [row] = await db
    .insert(backupsTable)
    .values({ filename, objectPath, sizeBytes: gz.length })
    .returning();

  await db
    .update(settingsTable)
    .set({ lastBackupAt: new Date() })
    .where(eq(settingsTable.id, 1));

  await pruneOldBackups();

  logger.info({ filename, sizeBytes: gz.length }, "Backup created");
  return {
    ok: true,
    message: `Záloha vytvořena (${filename}).`,
    backup: toRow(row),
  };
}

/**
 * Scheduler tick: create one backup per calendar day when backups are enabled.
 * Safe to call frequently; the once-per-day guard uses settings.lastBackupAt,
 * and a failed attempt leaves lastBackupAt untouched so it retries next tick.
 */
export async function maybeRunScheduledBackup(): Promise<void> {
  try {
    const [settings] = await db
      .select()
      .from(settingsTable)
      .where(eq(settingsTable.id, 1));
    if (!settings || !settings.backupsEnabled) return;

    if (settings.lastBackupAt) {
      const last = new Date(settings.lastBackupAt);
      const now = new Date();
      const sameDay =
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate();
      if (sameDay) return;
    }

    await runBackup();
  } catch (err) {
    logger.error({ err }, "Scheduled backup failed");
  }
}
