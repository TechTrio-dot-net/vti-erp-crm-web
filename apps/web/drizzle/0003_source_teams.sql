CREATE TABLE "lead_source_bdms" (
	"source_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_source_bdms_source_id_user_id_pk" PRIMARY KEY("source_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "lead_source_bdms" ADD CONSTRAINT "lead_source_bdms_source_id_lead_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_source_bdms" ADD CONSTRAINT "lead_source_bdms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lead_source_bdms_user_id_index" ON "lead_source_bdms" USING btree ("user_id");