import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { db, auditLogTable } from "@workspace/db";

const router: IRouter = Router();

/**
 * GET /audit-log — audit entries with optional filters (entity, entityId,
 * action, from/to date range), most recent first. Used by the global Audit log
 * page and the per-entity "Historie změn" panels (entity + entityId).
 */
router.get("/audit-log", async (req, res): Promise<void> => {
  const entity = typeof req.query.entity === "string" && req.query.entity ? req.query.entity : null;
  const entityId = typeof req.query.entityId === "string" && req.query.entityId ? req.query.entityId : null;
  const action = typeof req.query.action === "string" && req.query.action ? req.query.action : null;
  const fromRaw = typeof req.query.from === "string" ? req.query.from : null;
  const toRaw = typeof req.query.to === "string" ? req.query.to : null;

  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;

  const conditions: SQL[] = [];
  if (entity) conditions.push(eq(auditLogTable.entity, entity));
  if (entityId) conditions.push(eq(auditLogTable.entityId, entityId));
  if (action) conditions.push(eq(auditLogTable.action, action));

  if (fromRaw) {
    const from = new Date(fromRaw);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(auditLogTable.createdAt, from));
  }
  if (toRaw) {
    const to = new Date(toRaw);
    if (!Number.isNaN(to.getTime())) conditions.push(lte(auditLogTable.createdAt, to));
  }

  const rows = await db
    .select()
    .from(auditLogTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);

  res.json(rows);
});

export default router;
