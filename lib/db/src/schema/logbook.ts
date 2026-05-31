import { pgTable, text, serial, timestamp, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const logbookEntriesTable = pgTable("logbook_entries", {
  id: serial("id").primaryKey(),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  title: text("title").notNull(),
  content: text("content"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLogbookEntrySchema = createInsertSchema(logbookEntriesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLogbookEntry = z.infer<typeof insertLogbookEntrySchema>;
export type LogbookEntry = typeof logbookEntriesTable.$inferSelect;
