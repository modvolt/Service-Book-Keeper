import { pgTable, text, serial, timestamp, integer, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";
import { workOrdersTable } from "./work-orders";

// Loaner lending ("zápůjčky"): a fleet vehicle lent out for the duration of a
// work order (or standalone). Customer can be a known vehicle owner (linked via
// customerVehicleId) or an unknown person captured as free-text name/phone.
export const loanersTable = pgTable("loaners", {
  id: serial("id").primaryKey(),
  // The fleet vehicle being lent. Removing the fleet vehicle removes its loans.
  fleetVehicleId: integer("fleet_vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  // Optional link to the work order that triggered the loan. The loan runs from
  // the order's creation until the order is invoiced ("Vyfakturováno").
  workOrderId: integer("work_order_id").references(() => workOrdersTable.id, { onDelete: "set null" }),
  // Optional link to a known customer's vehicle (their own car in for service).
  customerVehicleId: integer("customer_vehicle_id").references(() => vehiclesTable.id, { onDelete: "set null" }),
  // Free-text customer identity (used for unknown customers, or as a snapshot).
  customerName: text("customer_name"),
  customerPhone: text("customer_phone"),
  startDate: date("start_date", { mode: "string" }).notNull(),
  // Return date: auto-filled when the linked order is invoiced, or set manually.
  endDate: date("end_date", { mode: "string" }),
  // When true, endDate was set by hand and must not be overwritten by automation.
  manualEndDate: boolean("manual_end_date").notNull().default(false),
  status: text("status").notNull().default("active"), // "active" | "returned"
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLoanerSchema = createInsertSchema(loanersTable).omit({ id: true, createdAt: true });
export type InsertLoaner = z.infer<typeof insertLoanerSchema>;
export type Loaner = typeof loanersTable.$inferSelect;
