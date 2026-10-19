CREATE TABLE "call_recordings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_log_id" uuid NOT NULL,
	"user_id" uuid,
	"storage_key" text,
	"source_url" text,
	"file_name" text,
	"mime_type" text,
	"size_bytes" integer,
	"status" text DEFAULT 'uploading' NOT NULL,
	"transcript" text,
	"language" text,
	"summary" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"transcribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_recordings" ADD CONSTRAINT "call_recordings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_recordings_call_log_id_index" ON "call_recordings" USING btree ("call_log_id");--> statement-breakpoint
CREATE INDEX "call_recordings_status_updated_at_index" ON "call_recordings" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "call_recordings_user_id_created_at_index" ON "call_recordings" USING btree ("user_id","created_at");