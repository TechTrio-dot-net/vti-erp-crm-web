CREATE TABLE "lead_retargets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_date" date NOT NULL,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_retargets" ADD CONSTRAINT "lead_retargets_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_retargets" ADD CONSTRAINT "lead_retargets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_retargets" ADD CONSTRAINT "lead_retargets_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lead_retargets_lead_id_index" ON "lead_retargets" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "lead_retargets_user_id_batch_date_index" ON "lead_retargets" USING btree ("user_id","batch_date");--> statement-breakpoint
CREATE INDEX "lead_retargets_batch_date_index" ON "lead_retargets" USING btree ("batch_date");