import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const auditLogTable = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  detail: text("detail"),
  // Who performed the action ("admin" | "scanner" | "system"). Never a name or
  // secret — only the role/context.
  actor: text("actor"),
  // Sanitized JSON snapshot of the row's prior values (before update/delete) or
  // created values. Sensitive keys are stripped by the audit helper before write.
  snapshot: text("snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditLog = typeof auditLogTable.$inferSelect;
