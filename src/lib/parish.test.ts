import { describe, expect, it } from 'vitest';
import type { ParishChain, ParishDetailsResponse } from '../shared/directory';
import { chainLine, chainRows, highlightParts, parishAnswer, recheck, resultsAnnouncement, type ListedParish } from './parish';

const unit = (id: string, name: string) => ({ id, name });
const LAGOS_3: ParishChain = {
  continent: unit('c3', 'Continent 3'),
  region: unit('r54', 'Region 54'),
  province: unit('lp3', 'Lagos Province 3'),
  zone: null,
  area: null,
};
const listed = (overrides: Partial<ListedParish> = {}): ListedParish => ({
  kind: 'listed',
  id: 'p1',
  name: 'Jesus House',
  chain: LAGOS_3,
  confirmed: true,
  detailsWrong: false,
  changed: false,
  ...overrides,
});
const current = (overrides: Partial<ParishDetailsResponse> = {}): ParishDetailsResponse => ({
  id: 'p1',
  name: 'Jesus House',
  status: 'active',
  mergedInto: null,
  chain: LAGOS_3,
  ...overrides,
});

describe('showing the chain', () => {
  it('reads from the lowest level up', () => {
    expect(chainLine(LAGOS_3)).toBe('Lagos Province 3 · Region 54 · Continent 3');
  });

  it('gives the card rows, saying what a parish with no province sits under', () => {
    expect(chainRows(LAGOS_3)).toEqual([
      ['Province', 'Lagos Province 3'],
      ['Region', 'Region 54'],
      ['Continent', 'Continent 3'],
    ]);
    expect(chainRows({ ...LAGOS_3, province: null, region: unit('r14', 'Region 14') })).toEqual([
      ['Province', 'None (directly under Region 14)'],
      ['Region', 'Region 14'],
      ['Continent', 'Continent 3'],
    ]);
    expect(chainRows({ continent: unit('c1', 'Continent 1'), region: null, province: null, zone: null, area: null })).toEqual([
      ['Province', 'None (directly under Continent 1)'],
      ['Region', 'None (directly under Continent 1)'],
      ['Continent', 'Continent 1'],
    ]);
  });

  it('includes zone and area once the directory has them', () => {
    const chain = { ...LAGOS_3, zone: unit('z2', 'Zone 2'), area: unit('a4', 'Area 4') };
    expect(chainLine(chain)).toBe('Area 4 · Zone 2 · Lagos Province 3 · Region 54 · Continent 3');
    expect(chainRows(chain).map(([label]) => label)).toEqual(['Area', 'Zone', 'Province', 'Region', 'Continent']);
  });
});

describe('highlightParts', () => {
  it('marks the start of each word that matches a typed word', () => {
    expect(highlightParts('Jesus House', 'jes hou')).toEqual([
      { text: 'Jes', match: true },
      { text: 'us ', match: false },
      { text: 'Hou', match: true },
      { text: 'se', match: false },
    ]);
  });

  it('prefers the longest matching word, ignores apostrophes and never matches mid-word', () => {
    expect(highlightParts('House of Prayer', 'ho house')).toEqual([
      { text: 'House', match: true },
      { text: ' of Prayer', match: false },
    ]);
    expect(highlightParts("King's Court", 'kings')).toEqual([
      { text: "King's", match: true },
      { text: ' Court', match: false },
    ]);
    expect(highlightParts('Jesus House', 'ouse')).toEqual([{ text: 'Jesus House', match: false }]);
  });
});

describe('resultsAnnouncement', () => {
  const response = (shown: number, total: number, fuzzy = false) => ({
    results: Array.from({ length: shown }, (_, index) => ({ id: `p${index}`, name: 'Grace', chain: LAGOS_3, inState: false })),
    total,
    fuzzy,
  });

  it('says how many parishes matched, and how many are shown', () => {
    expect(resultsAnnouncement(response(0, 0))).toBe('No parishes found.');
    expect(resultsAnnouncement(response(1, 1))).toBe('1 parish found.');
    expect(resultsAnnouncement(response(3, 3))).toBe('3 parishes found.');
    expect(resultsAnnouncement(response(10, 60))).toBe('60 parishes found, showing 10.');
    expect(resultsAnnouncement(response(2, 2, true))).toBe('No exact match. 2 similar names found.');
  });
});

describe('parishAnswer', () => {
  it('sends a listed parish or a name that isn’t listed, and nothing otherwise', () => {
    expect(parishAnswer(listed({ detailsWrong: true }))).toEqual({ kind: 'listed', id: 'p1', confirmed: true, detailsWrong: true });
    expect(parishAnswer({ kind: 'not_listed', name: 'Glory Tabernacle' })).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle' });
    expect(parishAnswer({ kind: 'withdrawn', name: 'Old', reason: 'inactive', mergedInto: null })).toBeNull();
    expect(parishAnswer(null)).toBeNull();
  });
});

describe('recheck', () => {
  it('keeps a choice that hasn’t changed', () => {
    const saved = listed();
    expect(recheck(saved, current())).toBe(saved);
  });

  it('asks again when the parish was renamed or moved', () => {
    expect(recheck(listed(), current({ name: 'Jesus House Parish' }))).toMatchObject({ name: 'Jesus House Parish', confirmed: false, changed: true });
    const moved = { ...LAGOS_3, province: unit('lp135', 'Lagos Province 135') };
    expect(recheck(listed({ detailsWrong: true }), current({ chain: moved }))).toEqual(
      listed({ chain: moved, confirmed: false, changed: true, detailsWrong: true }),
    );
  });

  it('withdraws a choice that was merged or is no longer listed', () => {
    const into = unit('p2', 'House of Prayer');
    expect(recheck(listed(), current({ status: 'merged', mergedInto: into }))).toEqual({ kind: 'withdrawn', name: 'Jesus House', reason: 'merged', mergedInto: into });
    expect(recheck(listed(), current({ status: 'inactive' }))).toEqual({ kind: 'withdrawn', name: 'Jesus House', reason: 'inactive', mergedInto: null });
    expect(recheck(listed(), null)).toEqual({ kind: 'withdrawn', name: 'Jesus House', reason: 'inactive', mergedInto: null });
  });
});
