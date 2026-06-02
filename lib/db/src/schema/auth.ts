import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const appAuthTable = pgTable("app_auth", {
  id: serial("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  resetTokenHash: text("reset_token_hash"),
  resetTokenExpiresAt: timestamp("reset_token_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppAuth = typeof appAuthTable.$inferSelect;
