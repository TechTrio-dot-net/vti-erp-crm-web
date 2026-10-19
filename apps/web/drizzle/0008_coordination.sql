ALTER TABLE "clients" ALTER COLUMN "contact_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "client_email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workflow" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Coordination no longer manages HR (departments, designations, employees) or configuration (users, company settings, activity log)
UPDATE "roles" SET "permissions" = ARRAY(
  SELECT p FROM unnest("permissions") AS p
  WHERE p NOT IN ('departments.manage', 'designations.manage', 'employees.view', 'employees.manage', 'users.manage', 'roles.manage', 'settings.company', 'settings.quotation', 'activity_logs.view')
), "updated_at" = now()
WHERE "slug" IN ('VTI_COORDINATION', 'COORDINATION');
