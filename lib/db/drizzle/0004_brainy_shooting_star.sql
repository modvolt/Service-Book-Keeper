CREATE TABLE "backups" (
	"id" serial PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"object_path" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "backups_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "last_backup_at" timestamp with time zone;