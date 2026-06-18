import { db, auditLogTable } from "@workspace/db";
import type { AuditAction } from "@workspace/audit-actions";
import { logger } from "./logger";

export type { AuditAction };

/**
 * Persist an audit record. Never store secrets, tokens, passwords or session IDs.
 * `detail` should contain only non-sensitive context (e.g. which entity, counts).
 */
export async function audit(
  action: AuditAction,
  opts: { entity?: string; entityId?: string | number; detail?: string } = {},
): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      action,
      entity: opts.entity ?? null,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      detail: opts.detail ?? null,
    });
  } catch (err) {
    logger.error({ err, action }, "Failed to write audit log");
  }
}
