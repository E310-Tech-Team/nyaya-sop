import { describe, expect, it } from 'vitest';
import { formatInZone, isValidTimeZone, utcToZonedLocal, zonedLocalToUtc, zoneOffsetMinutes } from './time';

describe('scheduling time zones', () => {
  it('converts Lagos wall-clock time (UTC+1 all year) to UTC and back', () => {
    expect(zonedLocalToUtc('2026-10-01T09:00', 'Africa/Lagos').toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect(zonedLocalToUtc('2027-01-15T00:30', 'Africa/Lagos').toISOString()).toBe('2027-01-14T23:30:00.000Z');
    expect(utcToZonedLocal(new Date('2026-10-01T08:00:00Z'), 'Africa/Lagos')).toBe('2026-10-01T09:00');
    expect(zoneOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Africa/Lagos')).toBe(60);
  });

  it('follows daylight saving in zones that have it', () => {
    expect(zonedLocalToUtc('2026-07-01T09:00', 'Europe/London').toISOString()).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedLocalToUtc('2026-12-01T09:00', 'Europe/London').toISOString()).toBe('2026-12-01T09:00:00.000Z');
    expect(zonedLocalToUtc('2026-07-01T09:00', 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });

  it('moves a time skipped by the clocks going forward to just after the change', () => {
    // New York, 8 March 2026: 02:00 → 03:00. 02:30 doesn't exist; it becomes 03:30 EDT.
    const skipped = zonedLocalToUtc('2026-03-08T02:30', 'America/New_York');
    expect(skipped.toISOString()).toBe('2026-03-08T07:30:00.000Z');
    expect(utcToZonedLocal(skipped, 'America/New_York')).toBe('2026-03-08T03:30');
    // London, 29 March 2026: 01:00 → 02:00.
    expect(utcToZonedLocal(zonedLocalToUtc('2026-03-29T01:30', 'Europe/London'), 'Europe/London')).toBe('2026-03-29T02:30');
  });

  it('picks the first of two identical times when the clocks go back', () => {
    // New York, 1 November 2026: 01:30 happens in EDT and again in EST.
    expect(zonedLocalToUtc('2026-11-01T01:30', 'America/New_York').toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('rejects malformed and impossible dates, and unknown zones', () => {
    expect(() => zonedLocalToUtc('2026-02-30T09:00', 'Africa/Lagos')).toThrow(RangeError);
    expect(() => zonedLocalToUtc('1 Oct 2026 9am', 'Africa/Lagos')).toThrow(RangeError);
    expect(isValidTimeZone('Africa/Lagos')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });

  it('always names the zone when showing a time to staff', () => {
    expect(formatInZone('2026-10-01T08:00:00Z')).toBe('1 Oct 2026, 09:00 WAT');
    expect(formatInZone('2026-10-01T08:00:00Z', 'Europe/London')).toBe('1 Oct 2026, 09:00 BST');
    expect(formatInZone('2026-10-01T08:00:00Z', 'UTC')).toBe('1 Oct 2026, 08:00 UTC');
  });
});
