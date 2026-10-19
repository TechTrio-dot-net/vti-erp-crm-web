import { and, eq, gt, lt, notInArray } from 'drizzle-orm';
import { db } from '../db/index';
import { callLogs } from '../db/schema';
import { normalizePhone } from '../lib/crm';
import { publicApiUrl } from '../lib/publicUrl';
import { applyCallToLead } from './calls';
import { queueExotelRecording } from './recordings';

/**
 * Exotel click-to-call: Exotel rings the BDM's phone first, then connects the customer from your ExoPhone
 * (company number), records the call and reports status/duration. Docs: https://developer.exotel.com/api/
 */
const env = () => ({
  sid: process.env.EXOTEL_SID,
  apiKey: process.env.EXOTEL_API_KEY,
  apiToken: process.env.EXOTEL_API_TOKEN,
  callerId: process.env.EXOTEL_CALLER_ID,
  // api.exotel.com (Singapore cluster) or api.in.exotel.com (Mumbai cluster)
  subdomain: process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com',
  webhookToken: process.env.EXOTEL_WEBHOOK_TOKEN,
  publicApiUrl: publicApiUrl(),
  record: process.env.EXOTEL_RECORD !== 'false',
});

export const exotelConfigured = () => {
  const e = env();
  return !!(e.sid && e.apiKey && e.apiToken && e.callerId);
};

export const exotelStatus = () => {
  const e = env();
  return {
    configured: exotelConfigured(),
    callerId: e.callerId ?? null,
    webhook: !!(e.publicApiUrl && e.webhookToken),
    recording: e.record,
  };
};

const TERMINAL = ['completed', 'busy', 'no-answer', 'failed', 'canceled'];

/** Exotel wants Indian numbers as 0XXXXXXXXXX */
const exotelNumber = (phone: string) => {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `0${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `0${digits.slice(2)}`;
  return digits.startsWith('0') ? digits : `+${digits}`;
};

async function exotelFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const e = env();
  const res = await fetch(`https://${e.subdomain}/v1/Accounts/${e.sid}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${Buffer.from(`${e.apiKey}:${e.apiToken}`).toString('base64')}`, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = (data as { RestException?: { Message?: string } }).RestException?.Message ?? text.slice(0, 200);
    throw new Error(`Exotel: ${msg || res.status}`);
  }
  return data as T;
}

/** Starts a bridged call BDM → customer and records it as a queued call */
export async function startExotelCall(params: { userId: string; agentPhone: string; leadId: string; leadPhone: string }) {
  const e = env();
  const body = new URLSearchParams({
    From: exotelNumber(params.agentPhone),
    To: exotelNumber(params.leadPhone),
    CallerId: e.callerId!,
    Record: String(e.record),
    CustomField: params.leadId,
  });
  if (e.publicApiUrl && e.webhookToken) {
    body.set('StatusCallback', `${e.publicApiUrl}/api/integrations/exotel/status?token=${encodeURIComponent(e.webhookToken)}`);
    body.set('StatusCallbackContentType', 'application/json');
    body.append('StatusCallbackEvents[0]', 'terminal');
  }
  const data = await exotelFetch<{ Call?: { Sid: string; Status?: string } }>('/Calls/connect.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const sid = data.Call?.Sid;
  if (!sid) throw new Error('Exotel did not return a call id');
  const [call] = await db
    .insert(callLogs)
    .values({
      source: 'exotel',
      externalId: sid,
      userId: params.userId,
      leadId: params.leadId,
      phone: params.leadPhone,
      phoneNormalized: normalizePhone(params.leadPhone),
      direction: 'outgoing',
      status: data.Call?.Status ?? 'queued',
      startedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  return { callSid: sid, callLogId: call?.id };
}

/** "2026-09-13 18:22:05" in IST → Date */
const parseExotelTime = (value?: string | null) => {
  if (!value) return null;
  const d = new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Applies a status update (webhook payload or fetched call details) to the stored call */
export async function applyExotelUpdate(update: {
  CallSid?: string;
  Sid?: string;
  Status?: string;
  ConversationDuration?: number | string;
  Duration?: number | string;
  RecordingUrl?: string | null;
  StartTime?: string;
  Details?: { ConversationDuration?: number | string };
}) {
  const sid = update.CallSid ?? update.Sid;
  if (!sid) return false;
  const status = update.Status?.toLowerCase();
  const talk = Number(update.ConversationDuration ?? update.Details?.ConversationDuration ?? (status === 'completed' ? update.Duration : 0)) || 0;
  const startedAt = parseExotelTime(update.StartTime);
  const [call] = await db
    .update(callLogs)
    .set({
      ...(status && { status }),
      durationSec: talk,
      ...(update.RecordingUrl && { recordingUrl: update.RecordingUrl }),
      ...(startedAt && { startedAt }),
      updatedAt: new Date(),
    })
    .where(and(eq(callLogs.source, 'exotel'), eq(callLogs.externalId, sid)))
    .returning();
  if (call?.leadId && status && TERMINAL.includes(status)) {
    await applyCallToLead(call.leadId, { userId: call.userId, direction: call.direction, durationSec: call.durationSec, startedAt: call.startedAt });
  }
  // Recorded company-line calls are transcribed like the phone app's recordings
  if (call && status && TERMINAL.includes(status)) await queueExotelRecording(call);
  return !!call;
}

/** Without a public webhook URL (e.g. running locally), poll Exotel for calls that haven't finished yet */
export async function pollPendingExotelCalls() {
  if (!exotelConfigured()) return 0;
  const pending = await db
    .select({ sid: callLogs.externalId })
    .from(callLogs)
    .where(
      and(
        eq(callLogs.source, 'exotel'),
        notInArray(callLogs.status, TERMINAL),
        lt(callLogs.createdAt, new Date(Date.now() - 45_000)),
        gt(callLogs.createdAt, new Date(Date.now() - 24 * 3600_000))
      )
    )
    .limit(50);
  let updated = 0;
  for (const { sid } of pending) {
    try {
      const data = await exotelFetch<{ Call?: Parameters<typeof applyExotelUpdate>[0] }>(`/Calls/${sid}.json?details=true`);
      if (data.Call && (await applyExotelUpdate(data.Call))) updated++;
    } catch (err) {
      console.error(`[Exotel] Could not fetch call ${sid}:`, (err as Error).message);
    }
  }
  return updated;
}
