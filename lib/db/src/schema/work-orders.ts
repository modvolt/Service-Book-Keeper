import { pgTable, text, serial, timestamp, integer, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const workOrdersTable = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id, { onDelete: "set null" }),
  licensePlate: text("license_plate").notNull(),
  status: text("status").notNull().default("open"),
  km: integer("km"),
  description: text("description"),
  oilChange: boolean("oil_change").notNull().default(false),
  transmissionOil: boolean("transmission_oil").notNull().default(false),
  brakes: boolean("brakes").notNull().default(false),
  timing: boolean("timing").notNull().default(false),
  stk: boolean("stk").notNull().default(false),
  serviceDate: date("service_date", { mode: "string" }),
  otherWork: text("other_work"),
  otherServices: text("other_services"),
  laborHours: text("labor_hours"),
  laborPrice: integer("labor_price"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({ id: true, createdAt: true });
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrder = typeof workOrdersTable.$inferSelect;
