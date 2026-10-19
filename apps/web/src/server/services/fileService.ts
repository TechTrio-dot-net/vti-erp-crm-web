import path from 'path';
import { randomUUID } from 'crypto';
import { db } from '../db/index';
import { files } from '../db/schema';
import { putObject } from '../lib/storage';

export async function createFile(params: {
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  storageKey: string;
  projectId?: string;
  taskId?: string;
  uploadedBy: string;
}): Promise<{ id: string }> {
  const [file] = await db
    .insert(files)
    .values({
      ...params,
      version: 1,
      versions: [
        {
          version: 1,
          url: params.url,
          storageKey: params.storageKey,
          uploadedAt: new Date().toISOString(),
          uploadedBy: params.uploadedBy,
        },
      ],
    })
    .returning({ id: files.id });
  return { id: file.id };
}

/** Storage key of a project file; keys saved before the move to shared storage had no folder */
export const uploadKey = (storageKey: string) => `uploads/${path.basename(storageKey)}`;

/** Stores an uploaded file and returns the key plus the (same-origin) address it is served from */
export async function saveUpload(buffer: Buffer, filename: string, mimeType: string): Promise<{ url: string; storageKey: string }> {
  const ext = path.extname(filename).toLowerCase().replace(/[^.\w]/g, '');
  const storageKey = `${Date.now()}-${randomUUID()}${ext}`;
  await putObject(uploadKey(storageKey), buffer, mimeType || 'application/octet-stream');
  return { url: `/api/files/serve/${storageKey}`, storageKey };
}
