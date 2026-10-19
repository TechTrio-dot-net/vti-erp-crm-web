import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index';
import { jobRuns } from '../db/schema';
import { background } from '../lib/background';
import { runDeadlineReminders } from './deadlineReminder';
import { syncExotelCalls, syncGoogleSheets, syncMetaForms } from './leadSync';
import { transcribePending } from '../services/recordings';

/**
 * Background jobs without a long-running process. Each job has an interval; whoever notices a job is due
 * claims it with one atomic UPDATE (so two instances never run it together) and runs it. "Noticing"
 * happens on:
 *  - GET /api/cron/tick — Vercel Cron or any external scheduler (e.g. cron-job.org every minute)
 *  - traffic: the website's live-update poll and the phone app's dialer poll call kickJobs(), so jobs
 *    keep running all day while the CRM or any BDM phone is online, even without a scheduler.
 */
interface Job {
  key: string;
  label: string;
  everySec: number;
  run: () => Promise<unknown>;
}

const JOBS: Job[] = [
  { key: 'google-sheets', label: 'Google Sheets sync', everySec: 120, run: syncGoogleSheets },
  { key: 'meta-forms', label: 'Meta lead forms', everySec: 300, run: syncMetaForms },
  { key: 'exotel-calls', label: 'Exotel call status', everySec: 60, run: syncExotelCalls },
  { key: 'call-transcripts', label: 'Call recording transcripts', everySec: 60, run: transcribePending },
  { key: 'deadline-reminders', label: 'Task deadline reminders', everySec: 3600, run: runDeadlineReminders },
];

/** A claim older than this is treated as a crashed run and may be taken over */
const STALE_RUN_SEC = 600;

/** Takes the job if it is due; false when it isn't or another instance got there first */
async function claim(job: Job): Promise<boolean> {
  await db.insert(jobRuns).values({ key: job.key }).onConflictDoNothing();
  const { rows } = await db.execute<{ key: string }>(sql`
    UPDATE job_runs SET last_started_at = now()
    WHERE key = ${job.key}
      AND (last_started_at IS NULL
        OR (last_finished_at >= last_started_at AND last_started_at < now() - make_interval(secs => ${job.everySec - 5}))
        OR last_started_at < now() - make_interval(secs => ${STALE_RUN_SEC}))
    RETURNING key`);
  return rows.length > 0;
}

async function runJob(job: Job): Promise<{ key: string; ran: boolean; error?: string }> {
  if (!(await claim(job))) return { key: job.key, ran: false };
  const started = Date.now();
  let error: string | null = null;
  try {
    await job.run();
  } catch (err) {
    error = ((err as Error)?.message ?? String(err)).slice(0, 500);
    console.error(`[Jobs] ${job.label} failed:`, error);
  }
  // Both times come from the database clock: mixing it with this server's clock could make a finished run
  // look unfinished (and block the job until it counts as stale)
  await db
    .update(jobRuns)
    .set({ lastFinishedAt: sql`greatest(now(), ${jobRuns.lastStartedAt})`, lastDurationMs: Date.now() - started, lastError: error })
    .where(eq(jobRuns.key, job.key));
  return { key: job.key, ran: true, ...(error && { error }) };
}

/** Runs every job that is due, one after another (they share the database pool) */
export async function runDueJobs() {
  const results = [];
  for (const job of JOBS) results.push(await runJob(job));
  return results;
}

// Traffic-driven runs: at most one check per instance every 20 seconds, finished after the response
let lastKick = 0;
export function kickJobs(): void {
  if (process.env.DISABLE_BACKGROUND_JOBS === 'true') return;
  if (Date.now() - lastKick < 20_000) return;
  lastKick = Date.now();
  void background(runDueJobs(), 'Jobs');
}

/** For the integrations health page */
export async function jobStatus() {
  const rows = await db.select().from(jobRuns);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return JOBS.map((job) => {
    const row = byKey.get(job.key);
    const lastRun = row?.lastFinishedAt ?? null;
    return {
      key: job.key,
      label: job.label,
      everySec: job.everySec,
      lastRun,
      lastError: row?.lastError ?? null,
      late: !lastRun || Date.now() - lastRun.getTime() > Math.max(job.everySec * 3, 15 * 60) * 1000,
    };
  });
}
