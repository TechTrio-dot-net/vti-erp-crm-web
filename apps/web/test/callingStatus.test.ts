import { describe, expect, it } from 'vitest';
import { WORK, callingStatus } from '../src/lib/crm';

/**
 * The red "Not calling" mark on the Call Log. Office hours are 10:30 am to 7:00 pm with lunch from
 * 1:30 to 2:00 pm, and the clock here is the salesperson's own, so the dates are built locally.
 */
describe('Calling status', () => {
  const at = (hour: number, minute = 0) => new Date(2026, 9, 22, hour, minute);
  const status = (now: Date, lastCall: Date | null) => callingStatus(lastCall?.toISOString() ?? null, now);

  it('is quiet about anyone outside office hours', () => {
    expect(status(at(9, 30), at(9)).key).toBe('off');
    expect(status(at(19, 30), at(18)).key).toBe('off');
    expect(status(at(10, 29), null).key).toBe('off');
  });

  it('counts someone as working while they are still calling', () => {
    expect(status(at(11), at(10, 55))).toMatchObject({ key: 'working', label: 'Working' });
  });

  it('turns red once the line has been quiet too long', () => {
    expect(status(at(11), at(10, 35))).toMatchObject({ key: 'idle', label: 'Not calling', sub: 'Quiet for 25 min' });
    expect(status(at(11), null)).toMatchObject({ key: 'idle', sub: 'No calls today' });
  });

  it('leaves everyone alone over lunch', () => {
    expect(status(at(13, 40), at(12))).toMatchObject({ key: 'lunch', label: 'Lunch break' });
    // Someone who does call through lunch is simply on their break too, not red
    expect(status(at(13, 55), at(13, 50)).key).toBe('lunch');
  });

  it('does not hold the lunch break against the quiet time after it', () => {
    // Last call 1:25 pm, now 2:05 pm: 40 minutes, but 30 of them were lunch
    expect(status(at(14, 5), at(13, 25))).toMatchObject({ key: 'working', sub: 'Last call 10 min ago' });
    // 25 minutes of real silence on top of lunch is still too long
    expect(status(at(14, 25), at(13, 25))).toMatchObject({ key: 'idle', sub: 'Quiet for 30 min' });
  });

  it('keeps the window the business asked for', () => {
    expect(WORK).toMatchObject({ startHour: 10, startMinute: 30, endHour: 19, idleMinutes: 20, lunchStart: 13 * 60 + 30, lunchEnd: 14 * 60 });
  });
});
