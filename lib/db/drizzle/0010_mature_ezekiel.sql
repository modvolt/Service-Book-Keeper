CREATE TABLE "consent_history" (
        "id" serial PRIMARY KEY NOT NULL,
        "vehicle_id" integer NOT NULL,
        "basis" text,
        "event" text NOT NULL,
        "note" text,
        "actor" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "legal_basis" text;--> statement-breakpoint
ALTER TABLE "consent_history" ADD CONSTRAINT "consent_history_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: any vehicle that already had consent on record gets a "consent"
-- legal basis and a seed history row preserving the original consent timestamp.
UPDATE "vehicles" SET "legal_basis" = 'consent' WHERE "consent_given_at" IS NOT NULL AND "legal_basis" IS NULL;--> statement-breakpoint
INSERT INTO "consent_history" ("vehicle_id", "basis", "event", "note", "actor", "created_at")
SELECT "id", 'consent', 'migrated', "consent_note", 'system', "consent_given_at"
FROM "vehicles"
WHERE "consent_given_at" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "consent_history" ch WHERE ch."vehicle_id" = "vehicles"."id");