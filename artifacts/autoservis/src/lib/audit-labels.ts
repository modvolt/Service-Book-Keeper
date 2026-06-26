import type { AuditAction } from "@workspace/audit-actions";

// Czech labels for every audit action code. Typed as Record<AuditAction, string>
// so a missing label is a compile error, never a silent raw-string fallback.
export const ACTION_LABELS: Record<AuditAction, string> = {
  login: "Přihlášení",
  login_failed: "Neúspěšné přihlášení",
  logout: "Odhlášení",
  password_changed: "Změna hesla",
  password_reset_requested: "Žádost o obnovení hesla",
  password_reset: "Obnovení hesla",
  gdpr_export: "Export osobních údajů",
  gdpr_anonymize: "Anonymizace",
  gdpr_delete: "Trvalé smazání",
  gdpr_consent: "Změna souhlasu",
  vehicle_deleted: "Smazání vozidla",
  appointment_deleted: "Smazání termínu",
  work_order_deleted: "Smazání zakázky",
  scanner_password_changed: "Heslo skeneru nastaveno",
  scanner_password_deleted: "Účet skeneru deaktivován",
  entity_created: "Vytvoření",
  entity_updated: "Úprava",
  entity_deleted: "Smazání",
  entity_restored: "Obnovení",
  entity_purged: "Trvalé smazání",
};

// Czech labels for the logical entity names carried in audit_log.entity and the
// trash list. Falls back to the raw value for any unmapped entity.
export const ENTITY_LABELS: Record<string, string> = {
  vehicle: "Vozidlo",
  work_order: "Zakázka",
  service_record: "Servisní záznam",
  material: "Materiál",
  photo: "Fotografie",
  loaner: "Zápůjčka",
  appointment: "Termín",
};

export function entityLabel(entity: string | null | undefined): string {
  if (!entity) return "—";
  return ENTITY_LABELS[entity] ?? entity;
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

export function formatDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("cs-CZ");
}

/**
 * Pretty-print the stored audit snapshot (a JSON string captured before the
 * change). Returns null when there is nothing to show; falls back to the raw
 * string if it isn't valid JSON.
 */
export function formatSnapshot(snapshot: string | null | undefined): string | null {
  if (!snapshot) return null;
  try {
    return JSON.stringify(JSON.parse(snapshot), null, 2);
  } catch {
    return snapshot;
  }
}
