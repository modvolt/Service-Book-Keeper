import { pgTable, text, serial, timestamp, integer, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { vehiclesTable } from "./vehicles";

export const workOrdersTable = pgTable("work_orders", {
  id: serial("id").primaryKey(),
  vehicleId: integer("vehicle_id").references(() => vehiclesTable.id, { onDelete: "set null" }),
  licensePlate: text("license_plate").notNull(),
  status: text("status").notNull().default("open"),
  paid: boolean("paid").notNull().default(false),
  km: integer("km"),
  description: text("description"),
  oilChange: boolean("oil_change").notNull().default(false),
  transmissionOil: boolean("transmission_oil").notNull().default(false),
  brakes: boolean("brakes").notNull().default(false),
  timing: boolean("timing").notNull().default(false),
  airFilter: boolean("air_filter").notNull().default(false),
  cabinFilter: boolean("cabin_filter").notNull().default(false),
  fuelFilter: boolean("fuel_filter").notNull().default(false),
  sparkPlugs: boolean("spark_plugs").notNull().default(false),
  stk: boolean("stk").notNull().default(false),
  tireChange: boolean("tire_change").notNull().default(false),
  diagnostics: boolean("diagnostics").notNull().default(false),
  lightsCheck: boolean("lights_check").notNull().default(false),
  brakeFluid: boolean("brake_fluid").notNull().default(false),
  frontAxleCheck: boolean("front_axle_check").notNull().default(false),
  rearAxleCheck: boolean("rear_axle_check").notNull().default(false),
  frontShocksCheck: boolean("front_shocks_check").notNull().default(false),
  rearShocksCheck: boolean("rear_shocks_check").notNull().default(false),
  geometry: boolean("geometry").notNull().default(false),
  headlightAlignment: boolean("headlight_alignment").notNull().default(false),
  serviceDate: date("service_date", { mode: "string" }),
  otherWork: text("other_work"),
  otherServices: text("other_services"),
  laborHours: text("labor_hours"),
  laborPrice: integer("labor_price"),
  notes: text("notes"),
  // Soft-delete (see vehicles schema): non-null deletedAt = trashed/hidden.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const insertWorkOrderSchema = createInsertSchema(workOrdersTable).omit({ id: true, createdAt: true });
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;
export type WorkOrder = typeof workOrdersTable.$inferSelect;
