import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * File storage on Cloudflare R2 (src/server/lib/storage.ts), against an in-memory stand-in for the R2
 * S3 API: checks the requests are signed S3 calls to the account's bucket and that files round-trip.
 */
describe('File storage on Cloudflare R2', () => {
  const bucket = new Map<string, { body: Uint8Array; type: string }>();
  const requests: Array<{ method: string; url: string; auth: string | null }> = [];

  beforeEach(() => {
    vi.resetModules();
    bucket.clear();
    requests.length = 0;
    Object.assign(process.env, { R2_ACCOUNT_ID: 'acc123', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_BUCKET: 'vti-files' });
    vi.stubGlobal('fetch', async (input: Request | string, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      requests.push({ method: req.method, url: req.url, auth: req.headers.get('authorization') });
      const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/vti-files\//, ''));
      if (req.method === 'PUT') {
        bucket.set(key, { body: new Uint8Array(await req.arrayBuffer()), type: req.headers.get('content-type') ?? '' });
        return new Response(null, { status: 200 });
      }
      const stored = bucket.get(key);
      if (req.method === 'DELETE') {
        bucket.delete(key);
        return new Response(null, { status: 204 });
      }
      if (!stored) return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
      return new Response(Buffer.from(stored.body), { status: 200, headers: { 'content-type': stored.type, 'content-length': String(stored.body.length) } });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[k];
  });

  const readAll = async (stream: NodeJS.ReadableStream) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    return Buffer.concat(chunks).toString();
  };

  it('uploads, reads back and deletes a file with signed requests to the bucket', async () => {
    const { putObject, getObject, deleteObject, r2Configured } = await import('../src/server/lib/storage');
    expect(r2Configured()).toBe(true);

    await putObject('payments/abc 1.png', Buffer.from('proof-of-payment'), 'image/png');
    expect(requests[0].method).toBe('PUT');
    expect(requests[0].url).toBe('https://acc123.r2.cloudflarestorage.com/vti-files/payments/abc%201.png');
    expect(requests[0].auth).toMatch(/^AWS4-HMAC-SHA256 Credential=key\/\d{8}\/auto\/s3\/aws4_request/);

    const file = await getObject('payments/abc 1.png');
    expect(file).not.toBeNull();
    expect(file!.contentType).toBe('image/png');
    expect(await readAll(file!.stream)).toBe('proof-of-payment');

    await deleteObject('payments/abc 1.png');
    expect(await getObject('payments/abc 1.png')).toBeNull();
  });

  it('reports a file that isn\'t there as missing', async () => {
    const { getObject, deleteObject } = await import('../src/server/lib/storage');
    expect(await getObject('uploads/nope.pdf')).toBeNull();
    await expect(deleteObject('uploads/nope.pdf')).resolves.toBeUndefined();
  });
});
