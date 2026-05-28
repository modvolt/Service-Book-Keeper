import { pgTable, text, serial, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  licensePlate: text("license_plate").notNull().unique(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  year: integer("year"),
  color: text("color"),
  vin: text("vin"),
  engineDisplacement: integer("engine_displacement"),
  registrationDate: date("registration_date", { mode: "string" }),
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  currentKm: integer("current_km"),
  notes: text("notes"),
  stkValidUntil: date("stk_valid_until", { mode: "string" }),
  lastOilChangeKm: integer("last_oil_change_km"),
  lastOilChangeDate: date("last_oil_change_date", { mode: "string" }),
  lastBrakesDate: date("last_brakes_date", { mode: "string" }),
  lastTimingDate: date("last_timing_date", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
