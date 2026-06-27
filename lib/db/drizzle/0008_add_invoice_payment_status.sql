ALTER TABLE "work_orders" ADD COLUMN "invoice_status" text DEFAULT 'not_invoiced' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
UPDATE "work_orders" SET "payment_status" = 'paid' WHERE "paid" = true;--> statement-breakpoint
UPDATE "work_orders" SET "invoice_status" = 'invoiced' WHERE "paid" = true;--> statement-breakpoint
UPDATE "work_orders" SET "invoice_status" = 'ready_to_invoice' WHERE "paid" = false AND "status" = 'completed';
