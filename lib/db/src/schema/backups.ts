import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";

/**
 * History of automatic database backups uploaded to the object store
 * (S3 in production, GCS in dev). One row per successfully-stored backup.
 *
 * `objectPath` is the stable `/objects/backups/<file>` path used to serve or
 * delete the blob through the storage facade, independent of the backing
 * bucket layout. Retention prunes the oldest rows (and their blobs) so the
 * table — and the bucket — stay bounded.
 */
export const backupsTable = pgTable("backups", {
  id: serial("id").primaryKey(),
  filename: text("filename").notNull(),
  objectPath: text("object_path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** "success" today; kept so failed attempts could be recorded later. */
  status: text("status").notNull().default("success"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Backup = typeof backupsTable.$inferSelect;
