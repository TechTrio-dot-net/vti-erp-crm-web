/**
 * Calendar days in the business timezone (APP_TIMEZONE, Asia/Kolkata). "Today", a quotation number's
 * date and a from/to filter must agree on where a day starts, whatever the server's own timezone.
 */
import { APP_TIMEZONE } from '../lib/crm';

export { APP_TIMEZONE };

type Parts = Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', string>;

function partsIn(date: Date, timeZone: string): Parts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Parts;
}

/** YYYY-MM-DD of `date` as a calendar day in `timeZone` */
export function dayIn(date: Date, timeZone = APP_TIMEZONE): string {
  const p = partsIn(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** dd-mm-yyyy of `date` in `timeZone`, the date portion of a quotation number */
export function dayMonthYearIn(date: Date, timeZone = APP_TIMEZONE): string {
  const p = partsIn(date, timeZone);
  return `${p.day}-${p.month}-${p.year}`;
}

/** Calendar arithmetic on YYYY-MM-DD strings */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function offsetMs(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a YYYY-MM-DD calendar day begins in `timeZone` */
export function startOfDay(day: string, timeZone = APP_TIMEZONE): Date {
  const utcMidnight = Date.parse(`${day}T00:00:00.000Z`);
  // Re-measuring at the guessed instant settles days on which daylight saving changes the offset
  const guess = utcMidnight - offsetMs(new Date(utcMidnight), timeZone);
  return new Date(utcMidnight - offsetMs(new Date(guess), timeZone));
}

/** The last millisecond of a YYYY-MM-DD calendar day in `timeZone` */
export function endOfDay(day: string, timeZone = APP_TIMEZONE): Date {
  return new Date(startOfDay(addDays(day, 1), timeZone).getTime() - 1);
}

/** YYYY-MM-DD in the server's local time (how quotation validity dates have always been printed) */
export function localDateString(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
