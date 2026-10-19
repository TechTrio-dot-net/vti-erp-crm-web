import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { callLogs, callRecordings, leads } from '../src/server/db/schema';
import { runReadOnlyQuery } from '../src/server/services/assistant';
import { actingAsRole, as, db, resetDb } from './harness';

/**
 * Call recordings as the Android app sends them (RecordingUploader.kt): start → upload → complete, then
 * transcription by the speech-to-text service (faked here) and playback on the website.
 */
describe('Call recordings', () => {
  let bdm: Awaited<ReturnType<typeof actingAsRole>>;
  const startedAt = Date.now() - 120_000;
  const call = { phone: '+91 98765 43210', direction: 'outgoing', startedAt, durationSec: 75 };

  beforeEach(async () => {
    await resetDb();
    bdm = await actingAsRole('SALES');
    await db.insert(leads).values({ companyName: 'Recorded Co', phone: '9876543210', phoneNormalized: '9876543210', assignedTo: bdm.userId });
    await as(bdm).post('/api/calls/device-sync').send({ deviceId: 'phone-1', calls: [call] }).expect(200);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.TRANSCRIBE_API_KEY;
  });

  const audio = Buffer.from('ID3fake-mp3-bytes-for-the-test');

  async function upload() {
    const { body: start } = await as(bdm)
      .post('/api/calls/recordings/start')
      .send({ ...call, fileName: 'Call_9876543210_20260925.mp3', sizeBytes: audio.length })
      .expect(200);
    expect(start).toMatchObject({ status: 'upload', uploadUrl: null, contentType: 'audio/mpeg' });
    // No R2 in tests, so the file goes through the API
    await as(bdm).put(`/api/calls/recordings/${start.recordingId}/content`).set('Content-Type', 'audio/mpeg').send(audio).expect(200);
    return start.recordingId as string;
  }

  it('uploads a recording for a synced call and plays it back', async () => {
    const recordingId = await upload();
    const { body: done } = await as(bdm).post(`/api/calls/recordings/${recordingId}/complete`).send({}).expect(200);
    expect(done.status).toBe('uploaded');

    const [logged] = await db.select().from(callLogs);
    const { body: info } = await as(bdm).get(`/api/calls/${logged.id}/recording`).expect(200);
    expect(info.recording).toMatchObject({ status: 'uploaded', hasAudio: true, sizeBytes: audio.length });
    expect(info.transcriptionEnabled).toBe(false);

    const played = await as(bdm).get(`/api/calls/${logged.id}/recording/audio`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(played.headers['content-type']).toBe('audio/mpeg');
    expect(Buffer.compare(played.body as Buffer, audio)).toBe(0);

    // Starting again (the app retries) is not needed any more
    const { body: again } = await as(bdm).post('/api/calls/recordings/start').send({ ...call, fileName: 'x.mp3', sizeBytes: 10 }).expect(200);
    expect(again).toEqual({ status: 'skip', reason: 'already-uploaded' });

    // The call log lists it as recorded
    const { body: log } = await as(bdm).get('/api/calls?recording=yes').expect(200);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0].recordingStatus).toBe('uploaded');
  });

  it('skips recordings of calls the CRM never received', async () => {
    const { body } = await as(bdm)
      .post('/api/calls/recordings/start')
      .send({ phone: '+91 90000 00000', direction: 'incoming', startedAt, durationSec: 30, fileName: 'personal.m4a', sizeBytes: 100 })
      .expect(200);
    expect(body).toEqual({ status: 'skip', reason: 'not-synced' });
  });

  it('keeps recordings on the phone while Vercel has no file storage', async () => {
    process.env.VERCEL = '1';
    try {
      // A 5xx, which the app retries later, rather than a 4xx that makes it delete the file
      await as(bdm).post('/api/calls/recordings/start').send({ ...call, fileName: 'a.m4a', sizeBytes: 100 }).expect(503);
    } finally {
      delete process.env.VERCEL;
    }
    expect(await db.select().from(callRecordings)).toHaveLength(0);
  });

  it('finishes an upload whose file arrived but whose confirmation never did', async () => {
    const recordingId = await upload();
    // No /complete: opening the recording finds the file and makes it playable
    const [logged] = await db.select().from(callLogs);
    const { body: info } = await as(bdm).get(`/api/calls/${logged.id}/recording`).expect(200);
    expect(info.recording).toMatchObject({ id: recordingId, status: 'uploaded', hasAudio: true, sizeBytes: audio.length });
    // No R2 in tests: played through the API
    expect(info.audioUrl).toBeNull();
    await as(bdm).get(`/api/calls/${logged.id}/recording/audio`).expect(200);
  });

  it('refuses to complete an upload that never arrived', async () => {
    const { body: start } = await as(bdm).post('/api/calls/recordings/start').send({ ...call, fileName: 'a.m4a', sizeBytes: 100 }).expect(200);
    await as(bdm).post(`/api/calls/recordings/${start.recordingId}/complete`).send({}).expect(409);
  });

  it("keeps other BDMs away from someone else's recording", async () => {
    const recordingId = await upload();
    await as(bdm).post(`/api/calls/recordings/${recordingId}/complete`).send({}).expect(200);
    const other = await actingAsRole('SALES');
    await as(other).post(`/api/calls/recordings/${recordingId}/complete`).send({}).expect(404);
    const [logged] = await db.select().from(callLogs);
    await as(other).get(`/api/calls/${logged.id}/recording/audio`).expect(403);
  });

  it('transcribes the recording in the language that was spoken', async () => {
    process.env.TRANSCRIBE_API_KEY = 'test-key';
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://api.openai.com/v1/audio/transcriptions');
      return new Response(JSON.stringify({ text: 'नमस्ते, मुझे एक जिंगल बनवाना है। Budget pachas hazaar hai.', language: 'hindi' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const recordingId = await upload();
    await as(bdm).post(`/api/calls/recordings/${recordingId}/complete`).send({}).expect(200);

    let row: typeof callRecordings.$inferSelect | undefined;
    for (let i = 0; i < 50; i++) {
      [row] = await db.select().from(callRecordings).where(eq(callRecordings.id, recordingId));
      if (row?.status === 'transcribed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(row).toMatchObject({ status: 'transcribed', language: 'hindi', attempts: 1 });
    expect(row!.transcript).toContain('जिंगल');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Transcripts are searchable, e.g. by the assistant
    const found = await runReadOnlyQuery(`SELECT count(*)::int AS n FROM call_recordings WHERE transcript ILIKE '%जिंगल%'`);
    expect(found.rows[0]).toEqual({ n: 1 });
  });
});

describe('Assistant SQL', () => {
  beforeEach(resetDb);

  it('only reads', async () => {
    await expect(runReadOnlyQuery('DELETE FROM leads')).rejects.toThrow(/SELECT/);
    await expect(runReadOnlyQuery('SELECT 1; DROP TABLE leads')).rejects.toThrow(/one statement/);
    await expect(runReadOnlyQuery("WITH gone AS (DELETE FROM leads RETURNING id) SELECT count(*) FROM gone")).rejects.toThrow(/data-modifying|read-only/);
  });

  it('never returns passwords or tokens', async () => {
    await actingAsRole('SUPER_ADMIN');
    await expect(runReadOnlyQuery('SELECT password_hash FROM users')).rejects.toThrow(/Passwords/);
    const { rows } = await runReadOnlyQuery('SELECT * FROM users');
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toContain('password_hash');
    expect(Object.keys(rows[0])).not.toContain('reset_token');
  });

  it('caps the rows and allows a trailing semicolon', async () => {
    const { rows, truncated } = await runReadOnlyQuery('SELECT generate_series(1, 500) AS n;');
    expect(rows).toHaveLength(200);
    expect(truncated).toBe(true);
  });

  it('is only open to the super admin', async () => {
    const management = await actingAsRole('MANAGEMENT');
    await as(management).post('/api/assistant/chat').send({ messages: [{ role: 'user', content: 'hi' }] }).expect(403);
    const admin = await actingAsRole('SUPER_ADMIN');
    delete process.env.ANTHROPIC_API_KEY;
    const { body } = await as(admin).post('/api/assistant/chat').send({ messages: [{ role: 'user', content: 'kitne leads aaye aaj?' }] }).expect(503);
    expect(body.message).toMatch(/ANTHROPIC_API_KEY/);
  });
});
