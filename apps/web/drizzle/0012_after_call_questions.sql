ALTER TABLE "lead_followups" ADD COLUMN "connected" boolean;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "interested" boolean;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD COLUMN "sample_shared" boolean;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "business_type" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "sample_shared_at" timestamp with time zone;