CREATE TABLE "dial_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lead_id" uuid,
	"phone" text NOT NULL,
	"contact_name" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"device_id" text,
	"error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD COLUMN "can_dial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dial_requests" ADD CONSTRAINT "dial_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dial_requests" ADD CONSTRAINT "dial_requests_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dial_requests_user_id_status_created_at_index" ON "dial_requests" USING btree ("user_id","status","created_at");