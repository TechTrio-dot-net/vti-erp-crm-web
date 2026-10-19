ALTER TABLE "lead_followups" ADD COLUMN "call_activity" text;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "status_label" text;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "call_duration_sec" integer;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "status_label" text;