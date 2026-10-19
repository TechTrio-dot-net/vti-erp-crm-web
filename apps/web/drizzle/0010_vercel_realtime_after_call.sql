CREATE TABLE "app_signals" (
	"key" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"key" text PRIMARY KEY NOT NULL,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_duration_ms" integer,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "call_log_id" uuid;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "client_ref" text;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_followups_client_ref_index" ON "lead_followups" USING btree ("client_ref");