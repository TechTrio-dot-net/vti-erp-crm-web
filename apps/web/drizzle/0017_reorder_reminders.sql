CREATE TABLE "reorder_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_key" text NOT NULL,
	"lead_id" uuid,
	"user_id" uuid NOT NULL,
	"month_key" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reorder_reminders" ADD CONSTRAINT "reorder_reminders_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reorder_reminders" ADD CONSTRAINT "reorder_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reorder_reminders_customer_key_month_key_index" ON "reorder_reminders" USING btree ("customer_key","month_key");--> statement-breakpoint
CREATE INDEX "reorder_reminders_user_id_month_key_index" ON "reorder_reminders" USING btree ("user_id","month_key");--> statement-breakpoint
CREATE INDEX "reorder_reminders_month_key_index" ON "reorder_reminders" USING btree ("month_key");