import { describe, expect, it } from 'vitest';
import { compare, dateToDay, dayToDate, describeSeries, periodLabel, periodText, presetOf, presetRange, rangeLabel, seriesStats, statusRows, todayInLagos } from './model';

const comparison = (applications: number | null, days = 30) => ({ from: '2026-08-02', to: '2026-08-31', days, applications, uniqueApplicants: applications });

describe('reporting periods in Lagos days', () => {
  it('takes today from Lagos, not from the browser or UTC', () => {
    // 23:30 UTC on 30 September is 00:30 on 1 October in Lagos (WAT, UTC+1).
    expect(todayInLagos(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
    expect(todayInLagos(new Date('2026-09-30T22:59:00Z'))).toBe('2026-09-30');
  });

  it('turns calendar days into date-picker dates and back without moving them', () => {
    for (const day of ['2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29']) expect(dateToDay(dayToDate(day))).toBe(day);
    expect(dayToDate('2026-09-07').getHours()).toBe(12);
  });

  it('computes presets as whole days ending today, and recognises them again', () => {
    expect(presetRange('7', '2026-09-30')).toEqual({ from: '2026-09-24', to: '2026-09-30' });
    expect(presetRange('30', '2026-09-30')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetRange('year', '2026-09-30')).toEqual({ from: '2026-01-01', to: '2026-09-30' });
    expect(presetOf('', '', '2026-09-30')).toBe('all');
    expect(presetOf('2026-09-01', '2026-09-30', '2026-09-30')).toBe('30');
    // The same dates on a later day are no longer "the last 30 days".
    expect(presetOf('2026-09-01', '2026-09-30', '2026-10-01')).toBe('custom');
    expect(presetOf('2026-09-01', '', '2026-09-30')).toBe('custom');
  });

  it('labels a period briefly for the control and fully in the sentence', () => {
    expect(periodLabel('', '', '2026-09-30')).toBe('All time');
    expect(periodLabel('2026-09-24', '2026-09-30', '2026-09-30')).toBe('Last 7 days');
    expect(periodLabel('2026-09-01', '2026-09-15', '2026-09-30')).toBe('1 Sept – 15 Sept 2026');
    expect(periodLabel('2026-09-01', '', '2026-09-30')).toBe('Since 1 Sept 2026');
    expect(periodLabel('', '2026-09-15', '2026-09-30')).toBe('Up to 15 Sept 2026');
    expect(rangeLabel('2025-12-20', '2026-01-10')).toBe('20 Dec 2025 – 10 Jan 2026');
    expect(periodText('2026-09-01', '2026-09-30')).toBe('from 1 Sept 2026 to 30 Sept 2026 (WAT)');
    expect(periodText('2026-09-07', '2026-09-07')).toBe('on 7 Sept 2026 (WAT)');
    expect(periodText(null, null)).toBe('at any time');
  });
});

describe('comparisons with the period before', () => {
  it('gives no comparison without an earlier period or when the current figure is hidden', () => {
    expect(compare(12, null)).toBeNull();
    expect(compare(null, comparison(10))).toBeNull();
  });

  it('shows a percentage only against a real, non-zero earlier figure', () => {
    expect(compare(12, comparison(10))).toMatchObject({ direction: 'up', badge: '+20%' });
    expect(compare(8, comparison(10))).toMatchObject({ direction: 'down', badge: '−20%' });
    expect(compare(10, comparison(10))).toMatchObject({ direction: 'same', badge: 'No change' });
    expect(compare(12, comparison(10))!.text).toBe('Up 20% on the 30 days before (2 Aug – 31 Aug 2026), which had 10.');
  });

  it('says so in words, with no percentage, when the earlier period had none or its count is hidden', () => {
    expect(compare(5, comparison(0))).toEqual({ direction: 'none', badge: null, text: "None in the 30 days before (2 Aug – 31 Aug 2026), so there's no percentage change to show." });
    expect(compare(0, comparison(0))!.text).toBe('None in the 30 days before (2 Aug – 31 Aug 2026) either.');
    expect(compare(7, comparison(null))).toMatchObject({ direction: 'none', badge: null, text: 'Fewer than 5 in the 30 days before (2 Aug – 31 Aug 2026).' });
    expect(compare(3, comparison(1, 1))!.text).toBe('Up 200% on the day before, which had 1.');
  });
});

describe('series and status summaries', () => {
  const points = [
    { period: '2026-09-07', applications: 4 },
    { period: '2026-09-14', applications: 9 },
    { period: '2026-09-21', applications: 0 },
    { period: '2026-09-28', applications: 5 },
  ];

  it('totals a series, finds its busiest period and averages over every period, empty ones included', () => {
    expect(seriesStats(points)).toEqual({ total: 18, busiest: points[1], average: 4.5, hidden: false });
    expect(seriesStats([{ period: '2026-09-07', applications: null }, ...points.slice(1)])).toMatchObject({ total: null, average: null, hidden: true });
    expect(seriesStats([{ period: '2026-09-07', applications: 0 }])).toMatchObject({ total: 0, busiest: null, average: 0 });
  });

  it('describes a series in words, saying when hidden periods leave the total incomplete', () => {
    expect(describeSeries(points, 'week')).toBe(
      'Weeks starting 7 Sept 2026 to 28 Sept 2026 (4 weeks, WAT): 18 applications. The busiest week began 14 Sept 2026, with 9.',
    );
    expect(describeSeries([{ period: '2026-09-07', applications: 0 }], 'day')).toBe('7 Sept 2026 to 7 Sept 2026 (1 day, WAT): no applications.');
    expect(describeSeries([{ period: '2026-09-07', applications: null }, { period: '2026-09-08', applications: 6 }], 'day')).toContain('at least 6 applications');
  });

  it('lists every status with its share of the total, keeping hidden counts hidden', () => {
    const rows = statusRows({ submitted: 6, under_review: 3, shortlisted: 1, invited: 0, not_selected: null, withdrawn: 0 }, 'review', 10);
    expect(rows.map((row) => [row.status, row.value, row.share])).toEqual([
      ['submitted', 6, 60],
      ['under_review', 3, 30],
      ['shortlisted', 1, 10],
      ['invited', 0, 0],
      ['not_selected', null, null],
      ['withdrawn', 0, 0],
    ]);
    expect(statusRows({ submitted: 1, under_review: 0, shortlisted: 0, invited: 0, not_selected: 0, withdrawn: 0 }, 'published', 1)[0]!.label).toBe('Received');
  });
});
