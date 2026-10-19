CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"event" text NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"description" text NOT NULL,
	"properties" jsonb,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artist_languages" (
	"artist_id" uuid NOT NULL,
	"language_id" uuid NOT NULL,
	CONSTRAINT "artist_languages_artist_id_language_id_pk" PRIMARY KEY("artist_id","language_id")
);
--> statement-breakpoint
CREATE TABLE "artist_services" (
	"artist_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	CONSTRAINT "artist_services_artist_id_service_id_pk" PRIMARY KEY("artist_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"gender" text,
	"email" text,
	"phone" text,
	"employee_id" uuid,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artists_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"type" text DEFAULT 'string' NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "designations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "durations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"minutes" numeric(10, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "durations_minutes_unique" UNIQUE("minutes")
);
--> statement-breakpoint
CREATE TABLE "languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "languages_name_unique" UNIQUE("name"),
	CONSTRAINT "languages_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "performers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"service_id" uuid NOT NULL,
	"artist_id" uuid,
	"language_id" uuid,
	"source_language_id" uuid,
	"video_type_id" uuid,
	"performer_id" uuid,
	"unit" text DEFAULT 'per_minute' NOT NULL,
	"base_price" numeric(14, 2) NOT NULL,
	"cost_price" numeric(14, 2),
	"min_quantity" integer DEFAULT 1 NOT NULL,
	"min_duration_minutes" numeric(10, 2),
	"max_duration_minutes" numeric(10, 2),
	"effective_from" date,
	"effective_to" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"artist_id" uuid,
	"video_type_id" uuid,
	"performer_id" uuid,
	"language_id" uuid,
	"source_language_id" uuid,
	"duration_id" uuid,
	"pricing_rule_id" uuid,
	"duration_minutes" numeric(10, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"unit" text NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"is_custom_price" boolean DEFAULT false NOT NULL,
	"base_price" numeric(14, 2),
	"line_total" numeric(14, 2) NOT NULL,
	"description" text NOT NULL,
	"snapshot" jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"received_by" text NOT NULL,
	"method" text NOT NULL,
	"method_detail" text,
	"paid_on" date NOT NULL,
	"reference" text,
	"notes" text,
	"attachment" jsonb,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_sequences" (
	"date" text PRIMARY KEY NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"quotation_number" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"subject" text,
	"details" text,
	"client_name" text NOT NULL,
	"client_company" text,
	"client_email" text,
	"client_phone" text,
	"client_gstin" text,
	"client_address" text,
	"scope" text,
	"included_services" text,
	"terms" text,
	"prepared_by_name" text,
	"prepared_by_phone" text,
	"external_reference" text,
	"lead_id" uuid,
	"currency" text DEFAULT 'INR' NOT NULL,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"include_gst" boolean DEFAULT true NOT NULL,
	"tax_rate" numeric(6, 2) DEFAULT '0' NOT NULL,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grand_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"validity" text DEFAULT '15_days' NOT NULL,
	"validity_days" integer,
	"valid_until" date,
	"created_by" uuid,
	"updated_by" uuid,
	"amount_paid" numeric(14, 2) DEFAULT '0' NOT NULL,
	"payment_completed_at" timestamp with time zone,
	"payment_completed_by" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_quotationNumber_unique" UNIQUE("quotation_number")
);
--> statement-breakpoint
CREATE TABLE "video_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"requires_performer" boolean DEFAULT false NOT NULL,
	"custom_price" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "designation_id" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "slug" text;--> statement-breakpoint
-- Existing CRM services get a slug from their name; a clash keeps the first and suffixes the rest.
UPDATE "services" s SET "slug" = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '-' || r.rn END
FROM (
	SELECT "id", COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'service') AS base,
		row_number() OVER (PARTITION BY COALESCE(NULLIF(trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), ''), 'service') ORDER BY "created_at", "id") AS rn
	FROM "services"
) r
WHERE s."id" = r."id";--> statement-breakpoint
ALTER TABLE "services" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "coming_soon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "artist_restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tokens_valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_languages" ADD CONSTRAINT "artist_languages_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_languages" ADD CONSTRAINT "artist_languages_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_services" ADD CONSTRAINT "artist_services_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artist_services" ADD CONSTRAINT "artist_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_source_language_id_languages_id_fk" FOREIGN KEY ("source_language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_video_type_id_video_types_id_fk" FOREIGN KEY ("video_type_id") REFERENCES "public"."video_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_video_type_id_video_types_id_fk" FOREIGN KEY ("video_type_id") REFERENCES "public"."video_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_performer_id_performers_id_fk" FOREIGN KEY ("performer_id") REFERENCES "public"."performers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_language_id_languages_id_fk" FOREIGN KEY ("language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_source_language_id_languages_id_fk" FOREIGN KEY ("source_language_id") REFERENCES "public"."languages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_duration_id_durations_id_fk" FOREIGN KEY ("duration_id") REFERENCES "public"."durations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_pricing_rule_id_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."pricing_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_quotation_id_quotations_id_fk" FOREIGN KEY ("quotation_id") REFERENCES "public"."quotations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_payments" ADD CONSTRAINT "quotation_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_payment_completed_by_users_id_fk" FOREIGN KEY ("payment_completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_logs_created_at_index" ON "activity_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "activity_logs_user_id_index" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "activity_logs_event_index" ON "activity_logs" USING btree ("event");--> statement-breakpoint
CREATE INDEX "artist_languages_language_id_index" ON "artist_languages" USING btree ("language_id");--> statement-breakpoint
CREATE INDEX "artist_services_service_id_index" ON "artist_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "artists_active_index" ON "artists" USING btree ("active");--> statement-breakpoint
CREATE INDEX "artists_deleted_at_index" ON "artists" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX "company_settings_group_index" ON "company_settings" USING btree ("group");--> statement-breakpoint
CREATE INDEX "pricing_rules_service_id_artist_id_active_index" ON "pricing_rules" USING btree ("service_id","artist_id","active");--> statement-breakpoint
CREATE INDEX "pricing_rules_effective_from_effective_to_index" ON "pricing_rules" USING btree ("effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "quotation_items_quotation_id_sort_order_index" ON "quotation_items" USING btree ("quotation_id","sort_order");--> statement-breakpoint
CREATE INDEX "quotation_items_service_id_index" ON "quotation_items" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "quotation_items_artist_id_index" ON "quotation_items" USING btree ("artist_id");--> statement-breakpoint
CREATE INDEX "quotation_payments_quotation_id_paid_on_index" ON "quotation_payments" USING btree ("quotation_id","paid_on");--> statement-breakpoint
CREATE INDEX "quotations_status_created_at_index" ON "quotations" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "quotations_created_at_index" ON "quotations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "quotations_created_by_index" ON "quotations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "quotations_external_reference_index" ON "quotations" USING btree ("external_reference");--> statement-breakpoint
CREATE INDEX "quotations_lead_id_index" ON "quotations" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Free-text designations become designation records.
INSERT INTO "designations" ("name")
SELECT DISTINCT trim("designation") FROM "employees" WHERE trim(COALESCE("designation", '')) <> ''
ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
UPDATE "employees" e SET "designation_id" = d."id" FROM "designations" d WHERE d."name" = trim(e."designation");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_slug_unique" UNIQUE("slug");