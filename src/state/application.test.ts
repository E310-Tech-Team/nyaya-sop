import { describe, expect, it } from 'vitest';
import type { ChosenPlace, ListedParish } from '../lib/parish';
import { validPayload } from '../shared/test-fixtures';
import { MESSAGES } from '../shared/validation';
import { emptyDraft, firstIncompletePath, isReachable, personalErrors, reducer, restoreDraft, toPayload, type Draft, type State } from './application';

function completeDraft(overrides: Partial<Draft> = {}): Draft {
  const { fullName, email, phone, gender, ageRange, stateOfResidence, city, parishName, educationLevel, currentStatus, purposeClarity } = validPayload();
  return {
    ...emptyDraft(),
    consent: true,
    personal: { fullName, email, phone, gender, ageRange, stateOfResidence, city, parishName },
    education: { educationLevel, currentStatus },
    purpose: { purposeClarity },
    ...overrides,
  };
}

const jesusHouse = (confirmed: boolean): ListedParish => ({
  kind: 'listed',
  id: '3f2a1c9e-7b4d-4e8a-9c1f-2d3e4f5a6b7c',
  name: 'Jesus House',
  chain: { continent: { id: 'c3', name: 'Continent 3' }, region: null, province: null, zone: null, area: null },
  confirmed,
  detailsWrong: false,
  changed: false,
});

// Step 1 of the directory question (D-59): Lagos Province 3, as the directory names it.
const LAGOS_3: ChosenPlace = {
  kind: 'place',
  id: '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',
  level: 'province',
  name: 'Lagos Province 3',
  chain: {
    continent: { id: 'c3', name: 'Continent 3' },
    region: { id: 'r54', name: 'Region 54' },
    province: { id: '7c1e2d3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f', name: 'Lagos Province 3' },
    zone: null,
    area: null,
  },
};

describe('the parish question in the draft', () => {
  it('asks for the parish’s name while the directory is off, and sends it as text', () => {
    const draft = completeDraft();
    expect(personalErrors(draft)).toEqual({});
    expect(firstIncompletePath(draft)).toBe('/apply/review');
    expect(toPayload(draft)).not.toHaveProperty('parish');

    const blank = completeDraft({ personal: { ...draft.personal, parishName: '  ' } });
    expect(personalErrors(blank)).toEqual({ parishName: MESSAGES.parishTextRequired });
    expect(firstIncompletePath(blank)).toBe('/apply/personal');
  });

  it('must be chosen and confirmed while the directory is on: typed text doesn’t count', () => {
    // Step 1 first: the province, or "I don't know my province".
    expect(personalErrors(completeDraft({ parishMode: 'directory' }))).toEqual({ parishName: MESSAGES.parishPlaceRequired });
    expect(firstIncompletePath(completeDraft({ parishMode: 'directory' }))).toBe('/apply/personal');
    const typed = completeDraft({ parishMode: 'directory' });
    typed.personal.parishName = 'Jesus House';
    expect(personalErrors(typed)).toEqual({ parishName: MESSAGES.parishPlaceRequired });
    // Then the parish.
    for (const province of [LAGOS_3, { kind: 'anywhere' } as const]) {
      expect(personalErrors(completeDraft({ parishMode: 'directory', province }))).toEqual({ parishName: MESSAGES.parishRequired });
    }
    expect(personalErrors(completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: jesusHouse(false) }))).toEqual({ parishName: MESSAGES.parishConfirm });

    const confirmed = completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: jesusHouse(true) });
    expect(personalErrors(confirmed)).toEqual({});
    expect(firstIncompletePath(confirmed)).toBe('/apply/review');
    // The parish only: the server takes its chain from the directory.
    expect(toPayload(confirmed).parish).toEqual({ kind: 'listed', id: jesusHouse(true).id, confirmed: true, detailsWrong: false });
  });

  it('accepts a parish that isn’t listed, by name, with the province chosen for it (by its ID only)', () => {
    const draft = completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: { kind: 'not_listed', name: 'Glory Tabernacle' } });
    expect(personalErrors(draft)).toEqual({});
    expect(toPayload(draft).parish).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle', unitId: LAGOS_3.id });
    // "I don't know my province": the name on its own.
    const anywhere = completeDraft({ parishMode: 'directory', province: { kind: 'anywhere' }, parish: { kind: 'not_listed', name: 'Glory Tabernacle' } });
    expect(personalErrors(anywhere)).toEqual({});
    expect(toPayload(anywhere).parish).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle' });
    expect(personalErrors(completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: { kind: 'not_listed', name: ' ' } }))).toEqual({
      parishName: MESSAGES.parishNameRequired,
    });
  });

  it('asks again for a choice that was withdrawn', () => {
    const withdrawn = { kind: 'withdrawn', name: 'Old Parish', reason: 'inactive', mergedInto: null } as const;
    const draft = completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: withdrawn });
    expect(personalErrors(draft)).toEqual({ parishName: MESSAGES.parishRequired });
    expect(toPayload(draft).parish).toBeNull();
    // A province withdrawn the same way: step 1 again.
    expect(personalErrors(completeDraft({ parishMode: 'directory', province: { kind: 'withdrawn', name: 'Lagos Province 3' } }))).toEqual({
      parishName: MESSAGES.parishPlaceRequired,
    });
  });
});

describe('the province step (D-59)', () => {
  const at = (draft: Draft): State => ({ draft, submission: null });
  const LAGOS_2: ChosenPlace = {
    ...LAGOS_3,
    id: '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091',
    name: 'Lagos Province 2',
    chain: { ...LAGOS_3.chain, region: { id: 'r19', name: 'Region 19' }, province: { id: '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091', name: 'Lagos Province 2' } },
  };
  const inLagos3: ListedParish = { ...jesusHouse(true), chain: LAGOS_3.chain };

  it('clears the parish when another province is chosen, or none, and keeps it for the same one', () => {
    for (const parish of [inLagos3, { kind: 'not_listed', name: 'Glory Tabernacle' } as const]) {
      const before = at(completeDraft({ parishMode: 'directory', province: LAGOS_3, parish }));
      expect(reducer(before, { type: 'province', value: LAGOS_3 }).draft.parish).toEqual(parish);
      for (const next of [LAGOS_2, { kind: 'anywhere' } as const, null]) {
        const after = reducer(before, { type: 'province', value: next }).draft;
        expect(after).toMatchObject({ province: next, parish: null });
      }
    }
    // "Change province": step 1 again.
    const cleared = reducer(at(completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: inLagos3 })), { type: 'province', value: null }).draft;
    expect(personalErrors(cleared)).toEqual({ parishName: MESSAGES.parishPlaceRequired });
    expect(toPayload(cleared).parish).toBeNull();
  });

  it('checks a saved province again: renamed it takes the new name, gone it asks again, and a late answer for another is ignored', () => {
    const state = at(completeDraft({ parishMode: 'directory', province: LAGOS_3 }));
    const details = { id: LAGOS_3.id, level: 'province' as const, name: LAGOS_3.name, chain: LAGOS_3.chain, parishes: 12 };
    expect(reducer(state, { type: 'recheckProvince', id: LAGOS_3.id, current: details }).draft.province).toBe(LAGOS_3);
    const renamed = { ...details, name: 'Lagos Province 3A', chain: { ...LAGOS_3.chain, province: { id: LAGOS_3.id, name: 'Lagos Province 3A' } } };
    expect(reducer(state, { type: 'recheckProvince', id: LAGOS_3.id, current: renamed }).draft.province).toEqual({ ...LAGOS_3, name: 'Lagos Province 3A', chain: renamed.chain });
    const gone = reducer(state, { type: 'recheckProvince', id: LAGOS_3.id, current: null }).draft;
    expect(gone.province).toEqual({ kind: 'withdrawn', name: 'Lagos Province 3' });
    expect(personalErrors(gone)).toEqual({ parishName: MESSAGES.parishPlaceRequired });
    expect(reducer(state, { type: 'recheckProvince', id: LAGOS_2.id, current: null })).toBe(state);
  });

  it('moves the province with a parish the directory moved', () => {
    const state = at(completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: inLagos3 }));
    const moved = { id: inLagos3.id, name: inLagos3.name, status: 'active' as const, mergedInto: null, chain: LAGOS_2.chain };
    const after = reducer(state, { type: 'recheck', id: inLagos3.id, current: moved }).draft;
    expect(after.province).toEqual(LAGOS_2);
    expect(after.parish).toMatchObject({ confirmed: false, changed: true, chain: LAGOS_2.chain });
    // Unmoved: the same province, as it was.
    const same = { ...moved, chain: LAGOS_3.chain };
    expect(reducer(state, { type: 'recheck', id: inLagos3.id, current: same }).draft.province).toBe(LAGOS_3);
  });

  it('opens a draft saved with the one-step picker in the right step', () => {
    // As sessionStorage hands it back: JSON from before the province step, with no `province` at all.
    const old = (parish: unknown) => {
      const { province: _none, ...rest } = completeDraft({ parishMode: 'directory' });
      return JSON.parse(JSON.stringify({ ...rest, parish })) as Partial<Draft>;
    };
    // A listed parish: its province, with the units above it (not a zone below it).
    const inZone = { ...inLagos3, chain: { ...LAGOS_3.chain, zone: { id: 'z1', name: 'Zone 1' } } };
    const restored = restoreDraft(old(inZone));
    expect(restored.province).toEqual(LAGOS_3);
    expect(restored.parish).toEqual(inZone);
    expect(personalErrors(restored)).toEqual({});
    // A parish in no province: its region (or continent).
    const inRegion = { ...inLagos3, chain: { ...LAGOS_3.chain, province: null } };
    expect(restoreDraft(old(inRegion)).province).toMatchObject({ kind: 'place', id: 'r54', level: 'region', name: 'Region 54' });
    // Not listed: answered without a province, as "I don't know my province".
    const notListed = restoreDraft(old({ kind: 'not_listed', name: 'Glory Tabernacle' }));
    expect(notListed.province).toEqual({ kind: 'anywhere' });
    expect(toPayload(notListed).parish).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle' });
    // Nothing chosen (or withdrawn): step 1.
    expect(restoreDraft(old(null)).province).toBeNull();
    expect(restoreDraft(old({ kind: 'withdrawn', name: 'Old Parish', reason: 'inactive', mergedInto: null })).province).toBeNull();
  });

  it('keeps a saved province only in a shape it understands', () => {
    const saved = (province: unknown) => JSON.parse(JSON.stringify({ ...completeDraft({ parishMode: 'directory' }), province })) as Partial<Draft>;
    expect(restoreDraft(saved(LAGOS_3)).province).toEqual(LAGOS_3);
    expect(restoreDraft(saved({ kind: 'anywhere' })).province).toEqual({ kind: 'anywhere' });
    expect(restoreDraft(saved({ kind: 'withdrawn', name: 'Lagos Province 3' })).province).toEqual({ kind: 'withdrawn', name: 'Lagos Province 3' });
    for (const broken of [{ ...LAGOS_3, level: 'zone' }, { ...LAGOS_3, id: 42 }, { ...LAGOS_3, chain: null }, { kind: 'somewhere' }, 'Lagos', null]) {
      expect(restoreDraft(saved(broken)).province).toBeNull();
    }
    // A unit in the chain without a name or ID is read as missing.
    const odd = { ...LAGOS_3, chain: { ...LAGOS_3.chain, region: { id: 'r54' } } };
    expect(restoreDraft(saved(odd)).province).toEqual({ ...LAGOS_3, chain: { ...LAGOS_3.chain, region: null } });
  });
});

describe('changing the parish', () => {
  const at = (draft: Draft): State => ({ draft, submission: null });
  const other: ListedParish = {
    ...jesusHouse(false),
    id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
    chain: {
      continent: { id: 'c3', name: 'Continent 3' },
      region: { id: 'r19', name: 'Region 19' },
      province: { id: 'lp2', name: 'Lagos Province 2' },
      zone: null,
      area: null,
    },
  };

  it('replaces the earlier parish’s units and confirmation when another is chosen', () => {
    const before = at(completeDraft({ parishMode: 'directory', parish: jesusHouse(true) }));
    const after = reducer(before, { type: 'parish', value: other }).draft;
    expect(after.parish).toEqual(other);
    expect(personalErrors(after)).toEqual({ parishName: MESSAGES.parishConfirm });
  });

  it('clears the parish, its units and its confirmation with “Change parish”, keeping the province', () => {
    const after = reducer(at(completeDraft({ parishMode: 'directory', province: LAGOS_3, parish: jesusHouse(true) })), { type: 'parish', value: null }).draft;
    expect(after.parish).toBeNull();
    expect(after.province).toEqual(LAGOS_3);
    expect(personalErrors(after)).toEqual({ parishName: MESSAGES.parishRequired });
    expect(toPayload(after).parish).toBeNull();
  });

  it('never lets a late check of an earlier choice restore it over a newer one', () => {
    const state = at(completeDraft({ parishMode: 'directory', parish: other }));
    const earlier = { id: jesusHouse(true).id, name: 'Jesus House', status: 'active' as const, mergedInto: null, chain: jesusHouse(true).chain };
    expect(reducer(state, { type: 'recheck', id: earlier.id, current: earlier })).toBe(state);
    expect(reducer(state, { type: 'recheck', id: earlier.id, current: null })).toBe(state);
  });

  it('asks again when a check finds the chosen parish moved', () => {
    const state = at(completeDraft({ parishMode: 'directory', parish: { ...other, confirmed: true } }));
    const moved = { id: other.id, name: other.name, status: 'active' as const, mergedInto: null, chain: { ...other.chain, province: { id: 'lp9', name: 'Lagos Province 9' } } };
    const parish = reducer(state, { type: 'recheck', id: other.id, current: moved }).draft.parish;
    expect(parish).toMatchObject({ kind: 'listed', confirmed: false, changed: true, chain: moved.chain });
  });

  it('sends a draft started while the directory was off back to the parish question once it is on', () => {
    const typed = completeDraft();
    expect(firstIncompletePath(typed)).toBe('/apply/review');
    const switched = reducer(at(typed), { type: 'parishMode', value: 'directory' }).draft;
    expect(switched.parish).toBeNull();
    expect(switched.personal.parishName).toBe(typed.personal.parishName); // kept to start the search
    expect(firstIncompletePath(switched)).toBe('/apply/personal');
    expect(toPayload(switched).parish).toBeNull();
  });

  it('keeps a chosen parish as its name when the directory is switched off', () => {
    const chosen = at(completeDraft({ parishMode: 'directory', parish: jesusHouse(true) }));
    const off = reducer(chosen, { type: 'parishMode', value: 'text' }).draft;
    expect(off.personal.parishName).toBe('Jesus House');
    expect(personalErrors(off)).toEqual({});
  });
});

describe('a draft saved with a gender the form no longer offers (docs/06 D-54)', () => {
  // As sessionStorage hands it back: JSON, possibly from before 2026-09-30.
  const saved = (gender: unknown, overrides: Partial<Draft> = {}) => {
    const draft = completeDraft(overrides);
    return JSON.parse(JSON.stringify({ ...draft, personal: { ...draft.personal, gender } })) as Partial<Draft>;
  };
  const answered = { parishMode: 'directory', province: { kind: 'anywhere' }, parish: jesusHouse(true) } satisfies Partial<Draft>;

  it('loads with "Prefer not to say" cleared and every other answer kept', () => {
    const expected = completeDraft(answered);
    expect(restoreDraft(saved('prefer_not_to_say', answered))).toEqual({ ...expected, personal: { ...expected.personal, gender: '' } });
  });

  it('asks for the gender again on the Personal step, and the step guards send later steps there', () => {
    const draft = restoreDraft(saved('prefer_not_to_say'));
    expect(personalErrors(draft)).toEqual({ gender: MESSAGES.genderRequired });
    expect(firstIncompletePath(draft)).toBe('/apply/personal');
    expect(isReachable(draft, '/apply/personal')).toBe(true);
    for (const path of ['/apply/education', '/apply/purpose', '/apply/review']) expect(isReachable(draft, path)).toBe(false);
  });

  it('clears any other value that isn’t an option, and keeps male or female', () => {
    for (const gender of ['other', 'Female', '', 5, null, { value: 'male' }]) expect(restoreDraft(saved(gender)).personal.gender).toBe('');
    expect(restoreDraft(saved(undefined)).personal.gender).toBe(''); // missing from an older draft
    for (const gender of ['male', 'female'] as const) {
      const draft = restoreDraft(saved(gender));
      expect(draft.personal.gender).toBe(gender);
      expect(firstIncompletePath(draft)).toBe('/apply/review');
    }
  });

  it('starts from an empty draft when nothing was saved', () => {
    expect(restoreDraft(null)).toEqual(emptyDraft());
  });
});
