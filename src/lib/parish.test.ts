import { describe, expect, it } from 'vitest';
import { isChainComplete, type ParishChain, type ParishDetailsResponse } from '../shared/directory';
import {
  belowPlace,
  chainLine,
  chainRows,
  highlightParts,
  lookalikeNote,
  parishAnswer,
  placeContext,
  placeLabel,
  placeOfChain,
  placeParishesAnnouncement,
  placesAnnouncement,
  recheck,
  recheckPlace,
  resultsAnnouncement,
  type ChosenPlace,
  type ListedParish,
} from './parish';

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

  it('treats skipped levels as complete, and only a parish with no continent as a gap in the list', () => {
    expect(isChainComplete(LAGOS_3)).toBe(true);
    expect(isChainComplete({ ...LAGOS_3, province: null })).toBe(true); // directly under a region
    expect(isChainComplete({ ...LAGOS_3, province: null, region: null })).toBe(true); // directly under a continent
    expect(isChainComplete({ ...LAGOS_3, continent: null })).toBe(false);
    // Nothing is made up for the missing level: the card lists what the directory has.
    expect(chainRows({ ...LAGOS_3, continent: null })).toEqual([
      ['Province', 'Lagos Province 3'],
      ['Region', 'Region 54'],
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

  it('sends the province chosen for a parish that isn’t listed, by its ID only (D-59)', () => {
    const place: ChosenPlace = { kind: 'place', id: 'lp3', level: 'province', name: 'Lagos Province 3', chain: LAGOS_3 };
    expect(parishAnswer({ kind: 'not_listed', name: 'Glory Tabernacle' }, place)).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle', unitId: 'lp3' });
    expect(parishAnswer({ kind: 'not_listed', name: 'Glory Tabernacle' }, { kind: 'anywhere' })).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle' });
    expect(parishAnswer({ kind: 'not_listed', name: 'Glory Tabernacle' }, { kind: 'withdrawn', name: 'Lagos Province 3' })).toEqual({
      kind: 'not_listed',
      name: 'Glory Tabernacle',
    });
    // A listed parish carries its own place.
    expect(parishAnswer(listed(), place)).toEqual({ kind: 'listed', id: 'p1', confirmed: true, detailsWrong: false });
  });
});

describe('places (step 1, D-59)', () => {
  const place = (overrides: Partial<ChosenPlace> = {}): ChosenPlace => ({ kind: 'place', id: 'lp3', level: 'province', name: 'Lagos Province 3', chain: LAGOS_3, ...overrides });

  it('finds the place a parish belongs to: its province, else its region, else its continent', () => {
    expect(placeOfChain({ ...LAGOS_3, zone: unit('z1', 'Zone 1') })).toEqual(place());
    expect(placeOfChain({ ...LAGOS_3, province: null })).toEqual(place({ id: 'r54', level: 'region', name: 'Region 54', chain: { ...LAGOS_3, province: null } }));
    const continentOnly = { continent: unit('c2', 'Continent 2'), region: null, province: null, zone: null, area: null };
    expect(placeOfChain(continentOnly)).toEqual(place({ id: 'c2', level: 'continent', name: 'Continent 2', chain: continentOnly }));
    expect(placeOfChain({ continent: null, region: null, province: null, zone: unit('z1', 'Zone 1'), area: null })).toBeNull();
  });

  it('names a region’s or continent’s own parishes as such, and says what a place is in', () => {
    expect(placeLabel(place())).toBe('Lagos Province 3');
    expect(placeLabel({ level: 'region', name: 'Region 13' })).toBe('Region 13 (parishes not in a province)');
    expect(placeLabel({ level: 'continent', name: 'Continent 2' })).toBe('Continent 2 (parishes not in a region)');
    expect(placeContext(place())).toBe('Region 54 · Continent 3');
    expect(placeContext({ level: 'continent', chain: { ...LAGOS_3, region: null, province: null } })).toBe('');
    // Inside a place, only what is below it.
    expect(belowPlace({ ...LAGOS_3, zone: unit('z1', 'Zone 1') }, 'province')).toBe('Zone 1');
    expect(belowPlace(LAGOS_3, 'province')).toBe('');
  });

  it('says how many places and parishes there are, and how many are shown', () => {
    const units = (levels: ChosenPlace['level'][], total: number) => ({
      results: levels.map((level, index) => ({ id: `u${index}`, level, name: 'X', chain: LAGOS_3, parishes: 1, inState: false })),
      total,
    });
    expect(placesAnnouncement(units([], 0))).toBe('No provinces found.');
    expect(placesAnnouncement(units(['province'], 1))).toBe('1 province found.');
    expect(placesAnnouncement(units(['province', 'province'], 30))).toBe('Showing 2 of 30 provinces.');
    expect(placesAnnouncement(units(['province', 'region'], 2))).toBe('2 matches found.');
    const found = (total: number, fuzzy = false) => ({ total, fuzzy });
    expect(placeParishesAnnouncement(found(104), 20, 'Lagos Province 12', false)).toBe('Showing 20 of 104 parishes in Lagos Province 12.');
    expect(placeParishesAnnouncement(found(104), 104, 'Lagos Province 12', false)).toBe('104 parishes in Lagos Province 12.');
    expect(placeParishesAnnouncement(found(1), 1, 'Lagos Province 12', true)).toBe('1 parish in Lagos Province 12 matches.');
    expect(placeParishesAnnouncement(found(3), 3, 'Lagos Province 12', true)).toBe('3 parishes in Lagos Province 12 match.');
    expect(placeParishesAnnouncement(found(2, true), 2, 'Lagos Province 12', true)).toBe('No exact match in Lagos Province 12. 2 similar names found.');
    expect(placeParishesAnnouncement(found(0), 0, 'Lagos Province 12', true)).toBe('No parishes in Lagos Province 12 match.');
  });

  it('checks a saved place again: the same, renamed, or gone', () => {
    const saved = place();
    const details = { id: 'lp3', level: 'province' as const, name: 'Lagos Province 3', chain: LAGOS_3, parishes: 4 };
    expect(recheckPlace(saved, details)).toBe(saved);
    expect(recheckPlace(saved, { ...details, name: 'Lagos Province 3A' })).toEqual(place({ name: 'Lagos Province 3A' }));
    expect(recheckPlace(saved, null)).toEqual({ kind: 'withdrawn', name: 'Lagos Province 3' });
    expect(recheckPlace(saved, { ...details, level: 'zone' })).toEqual({ kind: 'withdrawn', name: 'Lagos Province 3' });
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

  it('keeps a look-alike choice confirmed when only the number that look alike changes (D-55)', () => {
    const saved = listed({ lookalikes: 2 });
    expect(recheck(saved, current({ lookalikes: 2 }))).toBe(saved);
    // The registry added a third, or merged the pair: the note follows; nothing to confirm again.
    expect(recheck(saved, current({ lookalikes: 3 }))).toEqual(listed({ lookalikes: 3 }));
    expect(recheck(saved, current())).toEqual(listed());
    expect(recheck(listed(), current({ lookalikes: 2 }))).toEqual(listed({ lookalikes: 2 }));
    // Renamed as well: confirmed again, with the count as it is now.
    expect(recheck(saved, current({ name: 'Jesus House Parish', lookalikes: 2 }))).toEqual(
      listed({ name: 'Jesus House Parish', confirmed: false, changed: true, lookalikes: 2 }),
    );
  });

  it('withdraws a choice that was merged or is no longer listed', () => {
    const into = unit('p2', 'House of Prayer');
    expect(recheck(listed(), current({ status: 'merged', mergedInto: into }))).toEqual({ kind: 'withdrawn', name: 'Jesus House', reason: 'merged', mergedInto: into });
    expect(recheck(listed(), current({ status: 'inactive' }))).toEqual({ kind: 'withdrawn', name: 'Jesus House', reason: 'inactive', mergedInto: null });
    expect(recheck(listed(), null)).toEqual({ kind: 'withdrawn', name: 'Jesus House', reason: 'inactive', mergedInto: null });
  });
});

describe('lookalikeNote', () => {
  it('speaks only for a group of two or more', () => {
    expect(lookalikeNote(undefined)).toBeNull();
    expect(lookalikeNote(1)).toBeNull();
    expect(lookalikeNote(2)).toBe('2 parishes with this name here');
  });
});
