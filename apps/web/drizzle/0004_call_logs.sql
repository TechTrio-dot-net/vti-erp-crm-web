CREATE TABLE "call_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"user_id" uuid,
	"lead_id" uuid,
	"phone" text NOT NULL,
	"phone_normalized" text,
	"contact_name" text,
	"direction" text NOT NULL,
	"status" text,
	"started_at" timestamp with time zone NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"recording_url" text,
	"device_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mobile_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"device_name" text,
	"app_version" text,
	"last_sync_at" timestamp with time zone,
	"last_call_at" timestamp with time zone,
	"permission_granted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_logs" ADD CONSTRAINT "call_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mobile_devices" ADD CONSTRAINT "mobile_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_logs_source_external_id_index" ON "call_logs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "call_logs_user_id_started_at_index" ON "call_logs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "call_logs_lead_id_started_at_index" ON "call_logs" USING btree ("lead_id","started_at");--> statement-breakpoint
CREATE INDEX "call_logs_phone_normalized_index" ON "call_logs" USING btree ("phone_normalized");--> statement-breakpoint
CREATE INDEX "call_logs_started_at_index" ON "call_logs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mobile_devices_user_id_device_id_index" ON "mobile_devices" USING btree ("user_id","device_id");