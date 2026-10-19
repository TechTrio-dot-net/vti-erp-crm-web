import { randomUUID } from 'crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { callLogs, callRecordings, leads, users, type CallDirection } from '../db/schema';
import { HttpError } from '../lib/http';
import { normalizePhone } from '../lib/crm';
import { aiConfigured, AI_MODEL, anthropic, FALLBACK, responseText } from '../lib/ai';
import { background } from '../lib/background';
import { objectSize, presignedPutUrl, putObject, r2Configured, readObject } from '../lib/storage';
import { deviceCallId } from './calls';
import { SpeechError, speechConfigured, transcribeAudio } from './speech';

/**
 * Call recordings: the phone app finds the file its call recorder saved, asks for an upload address
 * (start), sends the file (straight to R2, or through the API without R2) and confirms (complete). The file
 * is then transcribed in the background — right away, and by the "call-transcripts" job for anything missed.
 */

/** Phones record roughly 0.5–1 MB a minute; this allows calls of well over an hour */
export const RECORDING_MAX_BYTES = 60 * 1024 * 1024;

const AUDIO_TYPES: Record<string, string> = {
  m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', amr: 'audio/amr', '3gp': 'audio/3gpp',
  wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm', flac: 'audio/flac',
};

const extensionOf = (fileName: string) => fileName.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1] ?? '';

/** A temporary failure (network, rate limit) is tried again, waiting 5 more minutes before each attempt */
const MAX_ATTEMPTS = 4;
const STALE_TRANSCRIBING = "interval '10 minutes'";

/** Words that help the speech-to-text service with names and the business's vocabulary */
const SPEECH_PROMPT = 'Sales call for Voice Tunes India — voice over, dubbing, jingles, video editing, quotation, GST. Hindi, English and Hinglish.';

// ─── Upload from the phone app ────────────────────────────────────────────────────────────────────────────────

export interface RecordingStart {
  phone: string;
  direction: CallDirection;
  startedAt: Date;
  durationSec: number;
  fileName: string;
  sizeBytes: number;
}

/** The synced call a recording belongs to: the exact call-log entry, or the same number within a few seconds */
async function findDeviceCall(userId: string, c: RecordingStart) {
  const [exact] = await db
    .select({ id: callLogs.id })
    .from(callLogs)
    .where(and(eq(callLogs.source, 'device'), eq(callLogs.externalId, deviceCallId(userId, c))))
    .limit(1);
  if (exact) return exact;
  const phone = normalizePhone(c.phone);
  if (!phone) return null;
  const [near] = await db
    .select({ id: callLogs.id })
    .from(callLogs)
    .where(
      and(
        eq(callLogs.userId, userId),
        eq(callLogs.phoneNormalized, phone),
        sql`abs(extract(epoch from ${callLogs.startedAt} - ${c.startedAt.toISOString()}::timestamptz)) < 5`
      )
    )
    .limit(1);
  return near ?? null;
}

export type StartResult =
  | { status: 'skip'; reason: 'not-synced' | 'already-uploaded' }
  | { status: 'upload'; recordingId: string; uploadUrl: string | null; contentType: string };

export async function startRecordingUpload(userId: string, input: RecordingStart): Promise<StartResult> {
  const ext = extensionOf(input.fileName);
  if (!AUDIO_TYPES[ext]) throw new HttpError(400, `Unsupported recording type: ${input.fileName}`);
  if (!(input.sizeBytes > 0)) throw new HttpError(400, 'The recording is empty');
  if (input.sizeBytes > RECORDING_MAX_BYTES) throw new HttpError(413, 'The recording is too large');
  // Vercel keeps no files and refuses bodies over 4.5 MB, which the phone would take as final and delete the
  // recording. A 5xx instead keeps it queued on the phone until storage is set up.
  if (process.env.VERCEL && !r2Configured()) {
    throw new HttpError(503, 'Recording storage is not set up: add R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET to Vercel, then redeploy');
  }

  // Personal-phone mode never sends calls with non-leads, so their recordings have nothing to attach to
  const call = await findDeviceCall(userId, input);
  if (!call) return { status: 'skip', reason: 'not-synced' };

  const [existing] = await db.select().from(callRecordings).where(eq(callRecordings.callLogId, call.id)).limit(1);
  if (existing && existing.status !== 'uploading') return { status: 'skip', reason: 'already-uploaded' };

  const contentType = AUDIO_TYPES[ext];
  const storageKey = `recordings/${call.id}-${randomUUID().slice(0, 8)}.${ext}`;
  const values = { storageKey, fileName: input.fileName.slice(0, 200), mimeType: contentType, sizeBytes: Math.round(input.sizeBytes), userId, error: null };
  const [row] = existing
    ? await db.update(callRecordings).set(values).where(eq(callRecordings.id, existing.id)).returning({ id: callRecordings.id })
    : await db.insert(callRecordings).values({ ...values, callLogId: call.id }).returning({ id: callRecordings.id });
  return { status: 'upload', recordingId: row.id, uploadUrl: await presignedPutUrl(storageKey), contentType };
}

async function ownUploadingRecording(userId: string, recordingId: string) {
  const [row] = await db.select().from(callRecordings).where(eq(callRecordings.id, recordingId)).limit(1);
  if (!row || row.userId !== userId) throw new HttpError(404, 'Recording not found');
  return row;
}

/** Without R2 the file comes through the API (development, or small files) */
export async function saveRecordingContent(userId: string, recordingId: string, body: Buffer) {
  const row = await ownUploadingRecording(userId, recordingId);
  if (row.status !== 'uploading' || !row.storageKey) throw new HttpError(409, 'This recording is already uploaded');
  if (!body.length) throw new HttpError(400, 'The recording is empty');
  await putObject(row.storageKey, body, row.mimeType || 'application/octet-stream');
}

/** The phone confirms the file is up; transcription starts right after the response */
export async function completeRecordingUpload(userId: string, recordingId: string) {
  const row = await ownUploadingRecording(userId, recordingId);
  if (row.status !== 'uploading') return { status: row.status };
  if (!(await finishIfArrived(row))) throw new HttpError(409, 'The recording has not arrived yet — upload it again');
  return { status: 'uploaded' as const };
}

/**
 * Marks an upload done when its file is in storage, and starts transcription. Also used for uploads whose
 * "complete" call never reached the CRM (the phone lost signal after sending the file), which would otherwise
 * stay "uploading" and never be playable.
 */
export async function finishIfArrived(row: { id: string; status: string; storageKey: string | null }): Promise<boolean> {
  if (row.status !== 'uploading' || !row.storageKey) return false;
  const size = await objectSize(row.storageKey);
  if (!size) return false;
  const updated = await db
    .update(callRecordings)
    .set({ status: 'uploaded', sizeBytes: size })
    .where(and(eq(callRecordings.id, row.id), eq(callRecordings.status, 'uploading')))
    .returning({ id: callRecordings.id });
  if (updated.length && speechConfigured()) void background(transcribeRecording(row.id), 'Transcription');
  return true;
}

/** Uploads left "uploading" for a while whose file did arrive */
async function finishStalledUploads() {
  const stalled = await db
    .select({ id: callRecordings.id, status: callRecordings.status, storageKey: callRecordings.storageKey })
    .from(callRecordings)
    .where(sql`${callRecordings.status} = 'uploading' AND ${callRecordings.updatedAt} < now() - interval '15 minutes' AND ${callRecordings.updatedAt} > now() - interval '14 days'`)
    .orderBy(asc(callRecordings.createdAt))
    .limit(20);
  for (const row of stalled) await finishIfArrived(row).catch((err) => console.error('[Recordings] Could not check upload:', (err as Error).message));
}

// ─── Company-line (Exotel) recordings ─────────────────────────────────────────────────────────────────────────

/** Called when Exotel reports a finished call with a recording; the audio is fetched when it is transcribed */
export async function queueExotelRecording(call: { id: string; userId: string | null; durationSec: number; recordingUrl: string | null }) {
  if (!call.recordingUrl || call.durationSec <= 0) return;
  await db
    .insert(callRecordings)
    .values({ callLogId: call.id, userId: call.userId, sourceUrl: call.recordingUrl, fileName: 'exotel.mp3', mimeType: 'audio/mpeg', status: 'uploaded' })
    .onConflictDoNothing();
}

/** Copies Exotel's recording into our storage, so it can be played later without Exotel */
async function fetchExotelAudio(recordingId: string, url: string) {
  const { EXOTEL_API_KEY, EXOTEL_API_TOKEN } = process.env;
  const res = await fetch(url, {
    headers: EXOTEL_API_KEY && EXOTEL_API_TOKEN ? { Authorization: `Basic ${Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString('base64')}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new SpeechError(`Could not download the Exotel recording (${res.status})`, res.status >= 500 || res.status === 404);
  const audio = Buffer.from(await res.arrayBuffer());
  const mimeType = res.headers.get('content-type')?.split(';')[0] || 'audio/mpeg';
  const ext = Object.entries(AUDIO_TYPES).find(([, t]) => t === mimeType)?.[0] ?? 'mp3';
  const storageKey = `recordings/${recordingId}.${ext}`;
  await putObject(storageKey, audio, mimeType);
  await db.update(callRecordings).set({ storageKey, mimeType, fileName: `exotel.${ext}`, sizeBytes: audio.length }).where(eq(callRecordings.id, recordingId));
  return { audio, fileName: `exotel.${ext}`, mimeType };
}

// ─── Transcription ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Transcribes one recording and summarises it. Claims the row first, so the upload's immediate run and the
 * background job never work on the same recording together. `retry` also takes failed recordings.
 */
export async function transcribeRecording(recordingId: string, options: { retry?: boolean } = {}) {
  const { rows } = await db.execute<{ id: string }>(sql`
    UPDATE call_recordings SET status = 'transcribing', attempts = attempts + 1, updated_at = now()
    WHERE id = ${recordingId}
      AND (status = 'uploaded'
        OR (status = 'transcribing' AND updated_at < now() - ${sql.raw(STALE_TRANSCRIBING)})
        OR (${options.retry === true} AND status = 'failed'))
    RETURNING id`);
  if (!rows.length) return false;

  const [row] = await db.select().from(callRecordings).where(eq(callRecordings.id, recordingId)).limit(1);
  try {
    let audio: Buffer | null;
    let fileName = row.fileName || 'recording.m4a';
    let mimeType = row.mimeType || 'audio/mp4';
    if (row.storageKey) {
      audio = await readObject(row.storageKey);
      if (!audio) throw new SpeechError('The recording file is missing from storage', false);
    } else if (row.sourceUrl) {
      ({ audio, fileName, mimeType } = await fetchExotelAudio(row.id, row.sourceUrl));
    } else {
      throw new SpeechError('The recording was never uploaded', false);
    }

    const { text, language } = await transcribeAudio(audio, fileName, mimeType, { prompt: SPEECH_PROMPT });
    await db
      .update(callRecordings)
      .set({ status: 'transcribed', transcript: text, language, error: null, transcribedAt: new Date() })
      .where(eq(callRecordings.id, row.id));

    if (text.length > 40 && aiConfigured()) {
      const summary = await summariseCall(row.callLogId, text).catch((err) => {
        console.error('[Recordings] Summary failed:', (err as Error).message);
        return null;
      });
      if (summary) await db.update(callRecordings).set({ summary }).where(eq(callRecordings.id, row.id));
    }
    return true;
  } catch (err) {
    const message = ((err as Error).message ?? String(err)).slice(0, 500);
    const retryable = !(err instanceof SpeechError) || err.retryable;
    // Temporary failures go back in the queue; the job waits longer after each attempt
    await db
      .update(callRecordings)
      .set({ status: retryable && row.attempts + 1 < MAX_ATTEMPTS ? 'uploaded' : 'failed', error: message })
      .where(eq(callRecordings.id, row.id));
    console.error(`[Recordings] Transcription of ${row.id} failed:`, message);
    return false;
  }
}

/** Background job: recordings waiting to be transcribed, oldest first, within a time budget */
export async function transcribePending() {
  await finishStalledUploads();
  if (!speechConfigured()) return 0;
  const due = await db
    .select({ id: callRecordings.id })
    .from(callRecordings)
    .where(
      sql`(${callRecordings.status} = 'uploaded' AND ${callRecordings.updatedAt} < now() - make_interval(mins => ${callRecordings.attempts} * 5))
        OR (${callRecordings.status} = 'transcribing' AND ${callRecordings.updatedAt} < now() - ${sql.raw(STALE_TRANSCRIBING)})`
    )
    .orderBy(asc(callRecordings.createdAt))
    .limit(5);
  const started = Date.now();
  let done = 0;
  for (const { id } of due) {
    if (Date.now() - started > 40_000) break;
    if (await transcribeRecording(id)) done++;
  }
  return done;
}

/** A few lines for the CRM: what the customer wants, what was agreed, what happens next */
async function summariseCall(callLogId: string, transcript: string): Promise<string | null> {
  const [ctx] = await db
    .select({ direction: callLogs.direction, durationSec: callLogs.durationSec, bdm: users.name, lead: leads.companyName, contact: leads.contactName })
    .from(callLogs)
    .leftJoin(users, eq(users.id, callLogs.userId))
    .leftJoin(leads, eq(leads.id, callLogs.leadId))
    .where(eq(callLogs.id, callLogId))
    .limit(1);
  const response = await anthropic().beta.messages.create({
    ...FALLBACK,
    model: AI_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'low' },
    system:
      'You summarise sales phone calls for the CRM of Voice Tunes India (voice-over, dubbing, jingles and video production). ' +
      'The transcript may be in Hindi, English, Hinglish or another Indian language and may contain speech-recognition mistakes. ' +
      'Write the summary in English as 2–5 short bullet points starting with "- ": what the customer needs, prices or quantities mentioned, ' +
      'objections, what was agreed, and the next step with its date if one was given. No heading, no preamble. ' +
      'If the call is not a business conversation (wrong number, personal call, voicemail), say so in one bullet.',
    messages: [
      {
        role: 'user',
        content:
          `${ctx?.direction ?? 'Phone'} call, ${ctx?.durationSec ?? 0} seconds, salesperson ${ctx?.bdm ?? 'unknown'}` +
          `${ctx?.lead ? `, lead "${ctx.lead}"${ctx.contact ? ` (${ctx.contact})` : ''}` : ''}.\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') return null;
  return responseText(response.content) || null;
}
