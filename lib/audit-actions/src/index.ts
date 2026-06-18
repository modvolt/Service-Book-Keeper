/**
 * Canonical list of audit-log action codes shared between the API server
 * (which writes them) and the frontend (which renders Czech labels for them).
 *
 * When adding a new admin action:
 *  1. Add its code here.
 *  2. The server can then write it via `audit(<code>)`.
 *  3. The frontend `ACTION_LABELS` map is typed as `Record<AuditAction, string>`,
 *     so a missing label becomes a TypeScript compile error — never a silent
 *     raw-string fallback.
 */
export const AUDIT_ACTIONS = [
  "login",
  "login_failed",
  "logout",
  "password_changed",
  "password_reset_requested",
  "password_reset",
  "gdpr_export",
  "gdpr_anonymize",
  "gdpr_delete",
  "gdpr_consent",
  "vehicle_deleted",
  "appointment_deleted",
  "work_order_deleted",
  "scanner_password_changed",
  "scanner_password_deleted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
