import { eq } from "drizzle-orm";
import { db, settingsTable } from "@workspace/db";
import { listAllTrashItems, purgeTrashItem } from "../routes/trash";
import { logger } from "./logger";

/** Default number of days a soft-deleted item is kept before auto-purge. */
const DEFAULT_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function retentionDays(): number {
  const raw = process.env["TRASH_RETENTION_DAYS"];
  const n = raw ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.floor(n);
}

export interface TrashCleanupResult {
  /** Number of items permanently purged. */
  purged: number;
  /** Number of expired items that could not be purged (e.g. blob delete failed). */
  failed: number;
}

/**
 * Permanently purge every trashed item whose `deletedAt` is older than the
 * retention window (`TRASH_RETENTION_DAYS`, default 30). Reuses the same
 * `purgeTrashItem` path as the manual DELETE route, so photo/work-order storage
 * blobs are deleted before the DB rows (GDPR erasure ordering) and the purge is
 * audited under the `system` actor. A per-item failure (e.g. a blob delete that
 * failed) is counted and logged but never aborts the whole sweep, so one bad
 * item can't block the rest — the item simply stays in the trash and is retried
 * on the next run.
 */
export async function runTrashCleanup(): Promise<TrashCleanupResult> {
  const cutoff = Date.now() - retentionDays() * MS_PER_DAY;

  const items = await listAllTrashItems();
  const expired = items.filter((i) => new Date(i.deletedAt).getTime() < cutoff);

  let purged = 0;
  let failed = 0;

  for (const item of expired) {
    try {
      const result = await purgeTrashItem(item.entity, item.id, "system", logger);
      if (result.ok) {
        purged += 1;
      } else {
        failed += 1;
      }
    } catch (err) {
      failed += 1;
      logger.error({ err, entity: item.entity, id: item.id }, "Trash auto-cleanup item failed");
    }
  }

  if (purged > 0 || failed > 0) {
    logger.info({ purged, failed, retentionDays: retentionDays() }, "Trash auto-cleanup run");
  }
  return { purged, failed };
}

/**
 * Scheduler tick: run the retention cleanup at most once per calendar day.
 * Mirrors the backup scheduler — the once-per-day guard uses
 * settings.lastTrashCleanupAt, and the timestamp is advanced even when nothing
 * was purged (a successful no-op sweep still counts as "done today"). A thrown
 * error leaves lastTrashCleanupAt untouched so it retries on the next tick.
 */
export async function maybeRunScheduledTrashCleanup(): Promise<void> {
  try {
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
    if (!settings) return;

    if (settings.lastTrashCleanupAt) {
      const last = new Date(settings.lastTrashCleanupAt);
      const now = new Date();
      const sameDay =
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate();
      if (sameDay) return;
    }

    await runTrashCleanup();

    await db
      .update(settingsTable)
      .set({ lastTrashCleanupAt: new Date() })
      .where(eq(settingsTable.id, 1));
  } catch (err) {
    logger.error({ err }, "Scheduled trash cleanup failed");
  }
}
