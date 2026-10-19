ALTER TABLE "tasks" ADD COLUMN "workflow_step" text;--> statement-breakpoint
-- Link existing tasks named after a follow-up step (e.g. "shoot") to that step
UPDATE "tasks" t SET "workflow_step" = w->>'key'
FROM "projects" p, jsonb_array_elements(p."workflow") w
WHERE t."project_id" = p."id" AND t."workflow_step" IS NULL
  AND lower(trim(t."title")) IN (lower(w->>'label'), lower(w->>'key'), replace(lower(w->>'key'), '_', ' '))
  AND NOT EXISTS (SELECT 1 FROM "tasks" x WHERE x."project_id" = p."id" AND x."workflow_step" = w->>'key');
--> statement-breakpoint
-- Every remaining follow-up step gets its task, in the status the step already has
INSERT INTO "tasks" ("project_id", "title", "status", "workflow_step", "position", "deadline", "completed_at", "created_by")
SELECT p."id", w->>'label',
  CASE w->>'status' WHEN 'DONE' THEN 'COMPLETED' WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'BACKLOG' END,
  w->>'key', o.n, p."end_date",
  CASE WHEN w->>'status' = 'DONE' THEN now() END, p."created_by"
FROM "projects" p, jsonb_array_elements(p."workflow") WITH ORDINALITY o(w, n)
WHERE NOT EXISTS (SELECT 1 FROM "tasks" x WHERE x."project_id" = p."id" AND x."workflow_step" = w->>'key');
--> statement-breakpoint
-- Follow-up projects whose tasks are all done are complete
UPDATE "projects" p SET "project_status" = 'COMPLETED', "updated_at" = now()
WHERE jsonb_array_length(p."workflow") > 0 AND p."project_status" <> 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM "tasks" t WHERE t."project_id" = p."id" AND t."status" <> 'COMPLETED');
