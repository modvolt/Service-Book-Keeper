import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";

/**
 * Append-only history of GDPR legal-basis / consent changes for a vehicle's
 * owner (the data subject). Instead of keeping only the latest consent value on
 * the vehicle, every change is recorded here so the processing record can show
 * when consent was granted, withdrawn, or the legal basis changed.
 *
 * `basis` is the legal basis in effect at the time of the event
 * ("contract" | "legitimate_interest" | "consent"). `event` is the change kind
 * ("granted" | "withdrawn" | "updated" | "migrated"). `note` is the optional
 * free-text purpose/note. `actor` is the role that made the change
 * (admin/scanner/system) — never a name or secret. Rows cascade-delete with
 * their vehicle.
 */
export const consentHistoryTable = pgTable("consent_history", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  basis: text("basis"),
  event: text("event").notNull(),
  note: text("note"),
  actor: text("actor"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ConsentHistory = typeof consentHistoryTable.$inferSelect;
