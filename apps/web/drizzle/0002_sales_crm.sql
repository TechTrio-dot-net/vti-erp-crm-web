CREATE TABLE "bdm_leaves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"reason" text,
	"transferred_to" uuid,
	"transferred_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bdm_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"started_by" uuid,
	"ended_by" uuid
);
--> statement-breakpoint
CREATE TABLE "campaign_bdm_rules" (
	"campaign" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_bdm_rules_campaign_user_id_pk" PRIMARY KEY("campaign","user_id")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"parent_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"division_id" uuid,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "divisions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"employee_code" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"division_id" uuid,
	"department_id" uuid,
	"designation" text,
	"joining_date" date,
	"monthly_salary" double precision DEFAULT 0 NOT NULL,
	"bank_account" text,
	"ifsc" text,
	"pan" text,
	"address" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "employees_employeeCode_unique" UNIQUE("employee_code")
);
--> statement-breakpoint
CREATE TABLE "lead_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"from_user_id" uuid,
	"to_user_id" uuid,
	"reason" text NOT NULL,
	"note" text,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid,
	"outcome" text NOT NULL,
	"note" text,
	"next_followup_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"raw" jsonb NOT NULL,
	"lead_id" uuid,
	"campaign" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_service_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "salaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" text NOT NULL,
	"base_salary" double precision NOT NULL,
	"working_days" integer NOT NULL,
	"paid_days" double precision NOT NULL,
	"bonus" double precision DEFAULT 0 NOT NULL,
	"deductions" double precision DEFAULT 0 NOT NULL,
	"net_pay" double precision NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"paid_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"sub_category_id" uuid,
	"price" double precision,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "whatsapp_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid,
	"user_id" uuid,
	"phone" text NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "campaign" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "ad_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "form_name" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "is_manual" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "phone_normalized" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "first_contact_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "next_followup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "lost_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "in_rotation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rotation_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_lead_target" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "weekly_revenue_target" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "division_id" uuid;--> statement-breakpoint
ALTER TABLE "bdm_leaves" ADD CONSTRAINT "bdm_leaves_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdm_leaves" ADD CONSTRAINT "bdm_leaves_transferred_to_users_id_fk" FOREIGN KEY ("transferred_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdm_leaves" ADD CONSTRAINT "bdm_leaves_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdm_sessions" ADD CONSTRAINT "bdm_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdm_sessions" ADD CONSTRAINT "bdm_sessions_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bdm_sessions" ADD CONSTRAINT "bdm_sessions_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_bdm_rules" ADD CONSTRAINT "campaign_bdm_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_assignments" ADD CONSTRAINT "lead_assignments_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_imports" ADD CONSTRAINT "lead_imports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_default_service_id_services_id_fk" FOREIGN KEY ("default_service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salaries" ADD CONSTRAINT "salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_sub_category_id_categories_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_logs" ADD CONSTRAINT "whatsapp_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bdm_leaves_user_id_from_date_to_date_index" ON "bdm_leaves" USING btree ("user_id","from_date","to_date");--> statement-breakpoint
CREATE INDEX "bdm_sessions_user_id_started_at_index" ON "bdm_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "bdm_sessions_started_at_index" ON "bdm_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "categories_parent_id_index" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_division_id_name_index" ON "departments" USING btree ("division_id","name");--> statement-breakpoint
CREATE INDEX "employees_department_id_index" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "employees_status_index" ON "employees" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lead_assignments_lead_id_index" ON "lead_assignments" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_assignments_to_user_id_created_at_index" ON "lead_assignments" USING btree ("to_user_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_assignments_created_at_index" ON "lead_assignments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lead_followups_lead_id_created_at_index" ON "lead_followups" USING btree ("lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_followups_user_id_created_at_index" ON "lead_followups" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_followups_created_at_index" ON "lead_followups" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_imports_source_id_external_id_index" ON "lead_imports" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "lead_imports_status_created_at_index" ON "lead_imports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "lead_imports_received_at_index" ON "lead_imports" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "salaries_employee_id_month_index" ON "salaries" USING btree ("employee_id","month");--> statement-breakpoint
CREATE INDEX "salaries_month_index" ON "salaries" USING btree ("month");--> statement-breakpoint
CREATE INDEX "whatsapp_logs_created_at_index" ON "whatsapp_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "whatsapp_logs_lead_id_index" ON "whatsapp_logs" USING btree ("lead_id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_duplicate_of_id_leads_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leads_assigned_to_assigned_at_index" ON "leads" USING btree ("assigned_to","assigned_at");--> statement-breakpoint
CREATE INDEX "leads_phone_normalized_index" ON "leads" USING btree ("phone_normalized");--> statement-breakpoint
CREATE INDEX "leads_next_followup_at_index" ON "leads" USING btree ("next_followup_at");--> statement-breakpoint
CREATE INDEX "leads_campaign_index" ON "leads" USING btree ("campaign");--> statement-breakpoint
CREATE INDEX "leads_created_at_index" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_closed_at_index" ON "leads" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "users_role_in_rotation_last_assigned_at_index" ON "users" USING btree ("role","in_rotation","last_assigned_at");--> statement-breakpoint
UPDATE "leads" SET "phone_normalized" = right(regexp_replace("phone", '\D', '', 'g'), 10) WHERE "phone" IS NOT NULL AND "phone_normalized" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "assigned_at" = "created_at" WHERE "assigned_to" IS NOT NULL AND "assigned_at" IS NULL;--> statement-breakpoint
UPDATE "leads" SET "closed_at" = "updated_at" WHERE "stage" IN ('WON', 'LOST') AND "closed_at" IS NULL;
