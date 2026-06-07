CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" serial PRIMARY KEY NOT NULL,
	"license_plate" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" integer,
	"color" text,
	"vin" text,
	"engine_displacement" integer,
	"transmission" text,
	"owner_type" text DEFAULT 'private' NOT NULL,
	"owner_name" text,
	"owner_address" text,
	"owner_ico" text,
	"owner_dic" text,
	"owner_phone" text,
	"owner_email" text,
	"consent_given_at" timestamp with time zone,
	"consent_note" text,
	"current_km" integer,
	"notes" text,
	"stk_valid_until" date,
	"last_oil_change_km" integer,
	"last_oil_change_date" date,
	"last_brakes_date" date,
	"last_timing_date" date,
	"last_transmission_oil_date" date,
	"last_transmission_oil_km" integer,
	"last_brake_fluid_date" date,
	"oil_change_interval_km" integer,
	"oil_change_interval_months" integer,
	"transmission_oil_interval_km" integer,
	"transmission_oil_interval_months" integer,
	"brakes_interval_months" integer,
	"timing_interval_km" integer,
	"timing_interval_months" integer,
	"brake_fluid_interval_months" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_license_plate_unique" UNIQUE("license_plate")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"date" date NOT NULL,
	"km" integer,
	"description" text,
	"oil_changed" boolean DEFAULT false NOT NULL,
	"brakes_serviced" boolean DEFAULT false NOT NULL,
	"timing_serviced" boolean DEFAULT false NOT NULL,
	"transmission_oil_changed" boolean DEFAULT false NOT NULL,
	"brake_fluid_changed" boolean DEFAULT false NOT NULL,
	"stk_passed" boolean DEFAULT false NOT NULL,
	"other_work" text,
	"technician" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer,
	"license_plate" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"km" integer,
	"description" text,
	"oil_change" boolean DEFAULT false NOT NULL,
	"transmission_oil" boolean DEFAULT false NOT NULL,
	"brakes" boolean DEFAULT false NOT NULL,
	"timing" boolean DEFAULT false NOT NULL,
	"air_filter" boolean DEFAULT false NOT NULL,
	"cabin_filter" boolean DEFAULT false NOT NULL,
	"stk" boolean DEFAULT false NOT NULL,
	"tire_change" boolean DEFAULT false NOT NULL,
	"diagnostics" boolean DEFAULT false NOT NULL,
	"lights_check" boolean DEFAULT false NOT NULL,
	"brake_fluid" boolean DEFAULT false NOT NULL,
	"front_axle_check" boolean DEFAULT false NOT NULL,
	"rear_axle_check" boolean DEFAULT false NOT NULL,
	"front_shocks_check" boolean DEFAULT false NOT NULL,
	"rear_shocks_check" boolean DEFAULT false NOT NULL,
	"geometry" boolean DEFAULT false NOT NULL,
	"headlight_alignment" boolean DEFAULT false NOT NULL,
	"service_date" date,
	"other_work" text,
	"other_services" text,
	"labor_hours" text,
	"labor_price" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "materials_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"product_number" text,
	"unit" text,
	"default_price" integer,
	"supplier" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "work_order_materials" (
	"id" serial PRIMARY KEY NOT NULL,
	"work_order_id" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" text DEFAULT '1' NOT NULL,
	"unit" text,
	"unit_price" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer,
	"license_plate" text,
	"scheduled_date" date NOT NULL,
	"scheduled_time" text,
	"customer_name" text,
	"customer_phone" text,
	"description" text,
	"status" text DEFAULT 'planned' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"company_name" text,
	"company_address" text,
	"company_phone" text,
	"company_email" text,
	"company_ico" text,
	"company_dic" text,
	"logo_url" text,
	"signature_name" text,
	"signature_image_url" text,
	"primary_color" text,
	"email_reminders_enabled" boolean DEFAULT false NOT NULL,
	"reminder_stk_days" integer DEFAULT 30 NOT NULL,
	"reminder_service_days" integer DEFAULT 14 NOT NULL,
	"notification_email" text,
	"last_stk_reminder_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customer_reminder_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"reminder_key" text NOT NULL,
	"dedupe_token" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_auth" (
	"id" serial PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"reset_token_hash" text,
	"reset_token_expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" json NOT NULL,
	"expire" timestamp (6) NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "photos" ADD CONSTRAINT "photos_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order_materials" ADD CONSTRAINT "work_order_materials_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customer_reminder_log" ADD CONSTRAINT "customer_reminder_log_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "materials_catalog_name_lower_unique" ON "materials_catalog" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "customer_reminder_log_unique" ON "customer_reminder_log" USING btree ("vehicle_id","reminder_key","dedupe_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" USING btree ("expire");