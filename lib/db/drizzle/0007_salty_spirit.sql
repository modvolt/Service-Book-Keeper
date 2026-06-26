ALTER TABLE "vehicles" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "service_records" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "work_orders" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "photos" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "materials_catalog" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "materials_catalog" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "materials_catalog" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "loaners" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "loaners" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "loaners" ADD COLUMN "delete_reason" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "snapshot" text;