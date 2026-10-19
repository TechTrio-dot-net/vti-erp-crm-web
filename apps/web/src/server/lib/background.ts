import { waitUntil } from '@vercel/functions';

/**
 * Work that finishes after the response has been sent (emails, notifications, activity log entries).
 * On Vercel a function may be frozen as soon as it responds, so the promise is registered with waitUntil
 * to keep the instance alive until it settles. Elsewhere (local dev, scripts, tests) it simply runs.
 */
export function background<T>(work: Promise<T>, label = 'Background task'): Promise<T | undefined> {
  const settled = work.catch((err) => {
    console.error(`[${label}] failed:`, (err as Error)?.message ?? err);
    return undefined;
  });
  try {
    waitUntil(settled);
  } catch {
    // Not inside a Vercel request
  }
  return settled;
}
