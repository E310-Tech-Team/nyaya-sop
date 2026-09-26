/**
 * Scheduling in a named time zone. Everything is stored in UTC; staff pick a wall-clock time
 * in an IANA time zone, Africa/Lagos by default (WAT, UTC+01:00, no daylight saving).
 * Pure Intl, no dependencies; shared by the admin UI and the server.
 */

export const DEFAULT_TIME_ZONE = 'Africa/Lagos';

/** Zones offered in the scheduler (the server accepts any valid IANA zone). */
export const SCHEDULING_TIME_ZONES = ['Africa/Lagos', 'Europe/London', 'America/New_York', 'UTC'] as const;

export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function zonedFields(date: Date, timeZone: string) {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Minutes to add to UTC to get local time in `timeZone` at `date` (Lagos: 60). */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const f = zonedFields(date, timeZone);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** "YYYY-MM-DDTHH:mm" (the value of <input type="datetime-local">) in `timeZone` at `date`. */
export function utcToZonedLocal(date: Date, timeZone: string): string {
  const f = zonedFields(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`;
}

/**
 * The UTC instant for a wall-clock time in `timeZone`.
 * - A time skipped by a daylight-saving change (spring forward) moves forward by the gap.
 * - A time that happens twice (fall back) resolves to the earlier instant.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date {
  const match = LOCAL_RE.exec(local);
  if (!match) throw new RangeError('Expected a local date and time like 2026-10-01T09:00');
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(guess) || new Date(guess).getUTCDate() !== day) throw new RangeError('That date does not exist');
  const day24 = 24 * 60 * 60_000;
  const offsets = [zoneOffsetMinutes(new Date(guess - day24), timeZone), zoneOffsetMinutes(new Date(guess + day24), timeZone)];
  const valid = [...new Set(offsets)]
    .map((offset) => guess - offset * 60_000)
    .filter((utc) => utcToZonedLocal(new Date(utc), timeZone) === local)
    .sort((a, b) => a - b);
  return new Date(valid[0] ?? guess - offsets[0]! * 60_000);
}

/** Short zone name at `date`: "WAT" for Lagos (as Nigerians write it; Intl says "GMT+1"), else Intl's ("BST", "GMT-4", "UTC"). */
export function zoneLabel(timeZone: string, date: Date = new Date()): string {
  if (timeZone === 'Africa/Lagos') return 'WAT';
  const part = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(date).find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

/** "1 Oct 2026, 09:00 WAT"-style text for staff, always naming the zone. */
export function formatInZone(date: Date | string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  const text = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);
  return `${text} ${zoneLabel(timeZone, value)}`;
}
