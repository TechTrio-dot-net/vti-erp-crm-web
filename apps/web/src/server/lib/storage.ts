import { createReadStream, existsSync } from 'fs';
import { mkdir, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, normalize, resolve, sep } from 'path';
import { Readable } from 'stream';
import { AwsClient } from 'aws4fetch';

/**
 * Uploaded files (project files, payment screenshots), addressed by a relative key such as
 * "payments/<uuid>.png". On Vercel the function's disk is temporary, so files go to a Cloudflare R2
 * bucket (S3-compatible). Without R2 settings, e.g. locally, they live under STORAGE_PATH (default ./storage).
 *
 * The bucket stays private: files are always served through the API, which checks who may see them first.
 *
 * R2 settings (Cloudflare dashboard → R2 → Manage API tokens, "Object Read & Write" on the bucket):
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 */
const r2Config = () => {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) return null;
  return { accountId: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET };
};

export const r2Configured = () => r2Config() !== null;

let client: { aws: AwsClient; base: string } | null = null;
function r2() {
  const config = r2Config();
  if (!config) throw new Error('R2 is not configured');
  if (!client) {
    client = {
      aws: new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, service: 's3', region: 'auto' }),
      base: `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`,
    };
  }
  return client;
}

/** The object's URL; each path segment is encoded, the slashes between them kept */
const objectUrl = (key: string) => `${r2().base}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function r2Request(method: 'PUT' | 'GET' | 'DELETE' | 'HEAD', key: string, init: { body?: Buffer; contentType?: string } = {}) {
  const res = await r2().aws.fetch(objectUrl(key), {
    method,
    body: init.body ? new Uint8Array(init.body) : undefined,
    headers: init.contentType ? { 'Content-Type': init.contentType } : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok && res.status !== 404) {
    const detail = method === 'HEAD' ? '' : (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`R2 ${method} ${key} failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res;
}

/**
 * Vercel refuses request bodies over 4.5 MB before they reach the app, so uploads there are capped just
 * below that; a local server accepts more.
 */
export const MAX_UPLOAD_BYTES = process.env.VERCEL ? 4 * 1024 * 1024 : 25 * 1024 * 1024;

export const storageRoot = () => resolve(process.env.STORAGE_PATH || join(process.cwd(), 'storage'));

/** The file's location on disk; refuses anything that would escape the storage directory */
function localPath(key: string): string {
  const root = storageRoot();
  const absolute = normalize(join(root, key));
  if (!absolute.startsWith(normalize(root) + sep)) throw new Error('File path is outside storage.');
  return absolute;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  if (r2Configured()) {
    await r2Request('PUT', key, { body, contentType });
    return;
  }
  if (process.env.VERCEL) {
    throw new Error('File storage is not set up: add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to the Vercel project, then redeploy.');
  }
  const path = localPath(key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
}

/** The file's bytes as a stream, or null when it doesn't exist */
export async function getObject(key: string): Promise<{ stream: Readable; contentType: string | null; size: number | null } | null> {
  if (r2Configured()) {
    const res = await r2Request('GET', key);
    if (res.status === 404 || !res.body) return null;
    const size = Number(res.headers.get('content-length'));
    return {
      stream: Readable.fromWeb(res.body as import('stream/web').ReadableStream),
      contentType: res.headers.get('content-type'),
      size: Number.isFinite(size) && size > 0 ? size : null,
    };
  }
  const path = localPath(key);
  if (!existsSync(path)) return null;
  return { stream: createReadStream(path), contentType: null, size: null };
}

/** The whole file in memory (for passing it on to another service), or null when it doesn't exist */
export async function readObject(key: string): Promise<Buffer | null> {
  const stored = await getObject(key);
  if (!stored) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stored.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Size in bytes, or null when the file doesn't exist */
export async function objectSize(key: string): Promise<number | null> {
  if (r2Configured()) {
    const res = await r2Request('HEAD', key);
    if (res.status === 404) return null;
    const size = Number(res.headers.get('content-length'));
    return Number.isFinite(size) ? size : null;
  }
  const path = localPath(key);
  return existsSync(path) ? (await stat(path)).size : null;
}

/**
 * A short-lived URL the phone app can PUT a file to straight into R2, so large files (call recordings) skip
 * Vercel's 4.5 MB request limit. Null without R2: the file then goes through the API instead.
 */
export async function presignedPutUrl(key: string, expiresSec = 900): Promise<string | null> {
  if (!r2Configured()) return null;
  const url = new URL(objectUrl(key));
  url.searchParams.set('X-Amz-Expires', String(expiresSec));
  const signed = await r2().aws.sign(url.toString(), { method: 'PUT', aws: { signQuery: true } });
  return signed.url;
}

/**
 * A short-lived URL the browser can play or download the file from straight out of R2 (supports seeking,
 * and skips Vercel's 4.5 MB response limit). Null without R2: the file is then served through the API.
 */
export async function presignedGetUrl(key: string, expiresSec = 3600, contentType?: string): Promise<string | null> {
  if (!r2Configured()) return null;
  const url = new URL(objectUrl(key));
  url.searchParams.set('X-Amz-Expires', String(expiresSec));
  if (contentType) url.searchParams.set('response-content-type', contentType);
  const signed = await r2().aws.sign(url.toString(), { method: 'GET', aws: { signQuery: true } });
  return signed.url;
}

export async function deleteObject(key: string): Promise<void> {
  if (r2Configured()) {
    await r2Request('DELETE', key);
    return;
  }
  await rm(localPath(key), { force: true });
}
