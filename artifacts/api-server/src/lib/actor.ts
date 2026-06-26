import type { Request } from "express";
import type { AuditActor } from "./audit";

/**
 * Resolve the audit actor from the request session. Old sessions without a role
 * are treated as admin (mirrors requireAdmin). Never returns a name or secret.
 */
export function getActor(req: Request): AuditActor {
  const role = req.session?.role ?? "admin";
  return role === "scanner" ? "scanner" : "admin";
}
