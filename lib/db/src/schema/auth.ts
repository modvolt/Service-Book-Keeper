import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const appAuthTable = pgTable("app_auth", {
  id: serial("id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppAuth = typeof appAuthTable.$inferSelect;
