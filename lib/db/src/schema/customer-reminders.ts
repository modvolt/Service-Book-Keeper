import { pgTable, serial, integer, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";

/**
 * De-duplication ledger for customer-facing reminder emails. One row per
 * (vehicle, reminder kind, deadline period) that has already been emailed to
 * the owner, so a customer is never notified twice about the same deadline.
 *
 * `dedupeToken` encodes the anchor of the current deadline period (e.g. the STK
 * expiry date, or the "last service" date/km for a service item). When the
 * underlying deadline changes — STK renewed, oil changed — the token changes
 * and a fresh reminder becomes eligible. It deliberately contains only
 * technical anchors (dates / km), never owner PII, so it carries no personal
 * data of its own. Rows cascade-delete with their vehicle.
 */
export const customerReminderLogTable = pgTable(
  "customer_reminder_log",
  {
    id: serial("id").primaryKey(),
    vehicleId: integer("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "cascade" }),
    reminderKey: text("reminder_key").notNull(),
    dedupeToken: text("dedupe_token").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customer_reminder_log_unique").on(
      t.vehicleId,
      t.reminderKey,
      t.dedupeToken,
    ),
  ],
);

export type CustomerReminderLog = typeof customerReminderLogTable.$inferSelect;
