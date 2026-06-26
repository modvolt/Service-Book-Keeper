import { pgTable, text, serial, timestamp, integer, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const serviceRecordsTable = pgTable("service_records", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").notNull().references(() => vehiclesTable.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  km: integer("km"),
  description: text("description"),
  oilChanged: boolean("oil_changed").notNull().default(false),
  brakesServiced: boolean("brakes_serviced").notNull().default(false),
  timingServiced: boolean("timing_serviced").notNull().default(false),
  transmissionOilChanged: boolean("transmission_oil_changed").notNull().default(false),
  brakeFluidChanged: boolean("brake_fluid_changed").notNull().default(false),
  stkPassed: boolean("stk_passed").notNull().default(false),
  otherWork: text("other_work"),
  technician: text("technician"),
  // Soft-delete (see vehicles schema): non-null deletedAt = trashed/hidden.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertServiceRecordSchema = createInsertSchema(serviceRecordsTable).omit({ id: true, createdAt: true });
export type InsertServiceRecord = z.infer<typeof insertServiceRecordSchema>;
export type ServiceRecord = typeof serviceRecordsTable.$inferSelect;
