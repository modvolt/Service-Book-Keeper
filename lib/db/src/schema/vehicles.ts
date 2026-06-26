import { pgTable, text, serial, timestamp, integer, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vehiclesTable = pgTable("vehicles", {
  id: serial("id").primaryKey(),
  licensePlate: text("license_plate").notNull().unique(),
  make: text("make").notNull(),
  model: text("model").notNull(),
  // Fleet flag: when true the vehicle is part of the shop's own fleet ("Vozový
  // park") and can be lent to customers as a loaner. It still appears in the
  // normal vehicle list with full service-status tracking.
  isFleet: boolean("is_fleet").notNull().default(false),
  year: integer("year"),
  color: text("color"),
  vin: text("vin"),
  engineDisplacement: integer("engine_displacement"),
  transmission: text("transmission"), // "manual" | "automatic"
  ownerType: text("owner_type").notNull().default("private"), // "private" | "company"
  ownerName: text("owner_name"),
  ownerAddress: text("owner_address"),
  ownerIco: text("owner_ico"),
  ownerDic: text("owner_dic"),
  ownerPhone: text("owner_phone"),
  ownerEmail: text("owner_email"),
  // GDPR: recorded consent of the owner (data subject) to store/process their
  // personal data. Null consentGivenAt means no consent on record.
  consentGivenAt: timestamp("consent_given_at", { withTimezone: true }),
  consentNote: text("consent_note"),
  currentKm: integer("current_km"),
  notes: text("notes"),
  stkValidUntil: date("stk_valid_until", { mode: "string" }),
  lastOilChangeKm: integer("last_oil_change_km"),
  lastOilChangeDate: date("last_oil_change_date", { mode: "string" }),
  lastBrakesDate: date("last_brakes_date", { mode: "string" }),
  lastTimingDate: date("last_timing_date", { mode: "string" }),
  lastTransmissionOilDate: date("last_transmission_oil_date", { mode: "string" }),
  lastTransmissionOilKm: integer("last_transmission_oil_km"),
  lastBrakeFluidDate: date("last_brake_fluid_date", { mode: "string" }),
  // Service intervals (km or months per item; nulls mean "no reminder")
  oilChangeIntervalKm: integer("oil_change_interval_km"),
  oilChangeIntervalMonths: integer("oil_change_interval_months"),
  transmissionOilIntervalKm: integer("transmission_oil_interval_km"),
  transmissionOilIntervalMonths: integer("transmission_oil_interval_months"),
  brakesIntervalMonths: integer("brakes_interval_months"),
  timingIntervalKm: integer("timing_interval_km"),
  timingIntervalMonths: integer("timing_interval_months"),
  brakeFluidIntervalMonths: integer("brake_fluid_interval_months"),
  // Soft-delete: a non-null deletedAt means the row is in the trash ("Koš") and
  // is hidden from normal lists/searches/counts. deletedBy = actor role; reason
  // is optional free text.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
  deleteReason: text("delete_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVehicleSchema = createInsertSchema(vehiclesTable).omit({ id: true, createdAt: true });
export type InsertVehicle = z.infer<typeof insertVehicleSchema>;
export type Vehicle = typeof vehiclesTable.$inferSelect;
