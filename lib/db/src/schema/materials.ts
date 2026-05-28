import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { workOrdersTable } from "./work-orders";

export const materialsCatalogTable = pgTable("materials_catalog", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  unit: text("unit"),
  defaultPrice: integer("default_price"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
