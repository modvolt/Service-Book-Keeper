ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "invoice_status" text DEFAULT 'not_invoiced' NOT NULL;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN IF NOT EXISTS "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'work_orders' AND column_name = 'paid'
  ) THEN
    UPDATE "work_orders" SET "payment_status" = 'paid' WHERE "paid" = true;
    UPDATE "work_orders" SET "invoice_status" = 'invoiced' WHERE "paid" = true;
    UPDATE "work_orders" SET "invoice_status" = 'ready_to_invoice' WHERE "paid" = false AND "status" = 'completed';
  END IF;
END $$;
