CREATE TABLE "loaners" (
	"id" serial PRIMARY KEY NOT NULL,
	"fleet_vehicle_id" integer NOT NULL,
	"work_order_id" integer,
	"customer_vehicle_id" integer,
	"customer_name" text,
	"customer_phone" text,
	"start_date" date NOT NULL,
	"end_date" date,
	"manual_end_date" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "is_fleet" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "loaners" ADD CONSTRAINT "loaners_fleet_vehicle_id_vehicles_id_fk" FOREIGN KEY ("fleet_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loaners" ADD CONSTRAINT "loaners_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loaners" ADD CONSTRAINT "loaners_customer_vehicle_id_vehicles_id_fk" FOREIGN KEY ("customer_vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;