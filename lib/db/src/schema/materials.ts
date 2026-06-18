import { pgTable, text, serial, timestamp, integer, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { workOrdersTable } from "./work-orders";

export const materialsCatalogTable = pgTable("materials_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  productNumber: text("product_number"),
  unit: text("unit"),
  defaultPrice: integer("default_price"),
  supplier: text("supplier"),
  askQuantityOnScan: boolean("ask_quantity_on_scan").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Case-insensitive uniqueness so "Filtr" and "filtr" are the same catalog entry
  // (import upsert relies on this conflict target).
  uniqueIndex("materials_catalog_name_lower_unique").on(sql`lower(${table.name})`),
]);

export const workOrderMaterialsTable = pgTable("work_order_materials", {
  id: serial("id").primaryKey(),
  workOrderId: integer("work_order_id").notNull().references(() => workOrdersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  quantity: text("quantity").notNull().default("1"),
  unit: text("unit"),
  unitPrice: integer("unit_price"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MaterialCatalogItem = typeof materialsCatalogTable.$inferSelect;
export type WorkOrderMaterial = typeof workOrderMaterialsTable.$inferSelect;
