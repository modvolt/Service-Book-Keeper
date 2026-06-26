import { db, auditLogTable } from "@workspace/db";
import type { AuditAction } from "@workspace/audit-actions";
import { logger } from "./logger";

export type { AuditAction };

export type AuditActor = "admin" | "scanner" | "system";

// Keys whose values must never be persisted to the audit snapshot, even though
// the business tables don't currently hold secrets. Defensive: if a sensitive
// column is ever added or a non-business object is snapshotted, it's redacted.
const SENSITIVE_KEY_RE = /pass|secret|token|hash|session|fingerprint|apikey|api_key|\bfp\b|cookie|authorization/i;

function sanitizeSnapshot(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? "[redacted]" : sanitizeSnapshot(v);
    }
    return out;
  }
  return value;
}

/**
 * Persist an audit record. Never store secrets, tokens, passwords or session IDs.
 * `detail` should contain only non-sensitive context (e.g. which entity, counts).
 * `snapshot` is sanitized (sensitive keys redacted) and stored as JSON.
 */
export async function audit(
  action: AuditAction,
  opts: {
    entity?: string;
    entityId?: string | number;
    detail?: string;
    actor?: AuditActor;
    snapshot?: unknown;
  } = {},
): Promise<void> {
  try {
    let snapshot: string | null = null;
    if (opts.snapshot !== undefined) {
      try {
        snapshot = JSON.stringify(sanitizeSnapshot(opts.snapshot));
      } catch (err) {
        logger.warn({ err, action }, "Failed to serialize audit snapshot");
      }
    }
    await db.insert(auditLogTable).values({
      action,
      entity: opts.entity ?? null,
      entityId: opts.entityId != null ? String(opts.entityId) : null,
      detail: opts.detail ?? null,
      actor: opts.actor ?? null,
      snapshot,
    });
  } catch (err) {
    logger.error({ err, action }, "Failed to write audit log");
  }
}

/**
 * Convenience wrappers for the generic entity-lifecycle actions. `entity` is the
 * logical entity name ("vehicle", "work_order", ...); `snapshot` should be the
 * relevant row (prior values for update/delete, created values for create).
 */
export const auditEntity = {
  created: (entity: string, id: string | number, actor: AuditActor, snapshot?: unknown, detail?: string) =>
    audit("entity_created", { entity, entityId: id, actor, snapshot, detail }),
  updated: (entity: string, id: string | number, actor: AuditActor, snapshot?: unknown, detail?: string) =>
    audit("entity_updated", { entity, entityId: id, actor, snapshot, detail }),
  deleted: (entity: string, id: string | number, actor: AuditActor, snapshot?: unknown, detail?: string) =>
    audit("entity_deleted", { entity, entityId: id, actor, snapshot, detail }),
  restored: (entity: string, id: string | number, actor: AuditActor, snapshot?: unknown, detail?: string) =>
    audit("entity_restored", { entity, entityId: id, actor, snapshot, detail }),
  purged: (entity: string, id: string | number, actor: AuditActor, snapshot?: unknown, detail?: string) =>
    audit("entity_purged", { entity, entityId: id, actor, snapshot, detail }),
};
