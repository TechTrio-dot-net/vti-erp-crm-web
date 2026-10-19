CREATE TABLE "legacy_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"table_name" text NOT NULL,
	"row_key" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legacy_archive_table_name_row_key_index" ON "legacy_archive" USING btree ("table_name","row_key");--> statement-breakpoint
CREATE INDEX "legacy_archive_table_name_index" ON "legacy_archive" USING btree ("table_name");