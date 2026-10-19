ALTER TABLE "invoices" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "invoices_paid_at_index" ON "invoices" USING btree ("paid_at");--> statement-breakpoint
UPDATE "invoices" SET "paid_at" = "updated_at" WHERE "status" = 'paid' AND "paid_at" IS NULL;
