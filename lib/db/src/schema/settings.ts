import { pgTable, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const settingsTable = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  companyName: text("company_name"),
  companyAddress: text("company_address"),
  companyPhone: text("company_phone"),
  companyEmail: text("company_email"),
  companyIco: text("company_ico"),
  companyDic: text("company_dic"),
  logoUrl: text("logo_url"),
  signatureName: text("signature_name"),
  signatureImageUrl: text("signature_image_url"),
  primaryColor: text("primary_color"),
  emailRemindersEnabled: boolean("email_reminders_enabled").notNull().default(false),
  reminderStkDays: integer("reminder_stk_days").notNull().default(30),
  reminderServiceDays: integer("reminder_service_days").notNull().default(14),
  notificationEmail: text("notification_email"),
  lastStkReminderSentAt: timestamp("last_stk_reminder_sent_at", { withTimezone: true }),
  backupsEnabled: boolean("backups_enabled").notNull().default(false),
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSettingsSchema = createInsertSchema(settingsTable).omit({ id: true, updatedAt: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settingsTable.$inferSelect;
