/**
 * Relation name (from db/schema.ts relations) → field name the API has always used.
 * The frontend reads populated references under the foreign-key field, e.g. `task.projectId.projectName`.
 */
const RELATION_FIELDS: Record<string, string> = {
  project: 'projectId',
  assignee: 'assignedTo',
  client: 'clientId',
  creator: 'createdBy',
  uploader: 'uploadedBy',
  user: 'userId',
  task: 'taskId',
  author: 'authorId',
  actor: 'actorId',
  creativeFile: 'creativeFileId',
  parent: 'parentId',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ApiDoc = Record<string, any>;

/**
 * Shapes a db.query result like the former Mongoose `.lean()` output so API responses are unchanged:
 * populated relations replace their foreign-key field, project `members` become `teamMembers`,
 * and every record exposes `_id` alongside `id`. Only relation keys are recursed into, so jsonb
 * payloads (metadata, invoice items, file versions) pass through untouched.
 */
export function toApi(row: null | undefined): null;
export function toApi(row: object[]): ApiDoc[];
export function toApi(row: object): ApiDoc;
export function toApi(row: object | null | undefined): ApiDoc | ApiDoc[] | null;
export function toApi(row: unknown): unknown {
  if (Array.isArray(row)) return row.map((r) => toApi(r as object));
  if (row === null || row === undefined) return null;
  if (typeof row !== 'object' || row instanceof Date) return row;

  const source = row as Record<string, unknown>;
  const out: ApiDoc = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === 'members' && Array.isArray(value)) {
      out.teamMembers = value.map((m) => toApi((m as { user?: object }).user ?? null)).filter(Boolean);
    } else if (!(key in RELATION_FIELDS)) {
      out[key] = value;
    }
  }
  for (const [relation, field] of Object.entries(RELATION_FIELDS)) {
    if (relation in source) out[field] = toApi(source[relation] as object | null);
  }
  if ('id' in out) out._id = out.id;
  return out;
}
