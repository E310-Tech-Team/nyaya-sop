import { describe, expect, it } from 'vitest';
import type { ListedParish } from '../lib/parish';
import { validPayload } from '../shared/test-fixtures';
import { MESSAGES } from '../shared/validation';
import { emptyDraft, firstIncompletePath, personalErrors, reducer, toPayload, type Draft, type State } from './application';

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
    expect(personalErrors(completeDraft({ parishMode: 'directory' }))).toEqual({ parishName: MESSAGES.parishRequired });
    expect(firstIncompletePath(completeDraft({ parishMode: 'directory' }))).toBe('/apply/personal');
    const typed = completeDraft({ parishMode: 'directory' });
    typed.personal.parishName = 'Jesus House';
    expect(personalErrors(typed)).toEqual({ parishName: MESSAGES.parishRequired });
    expect(personalErrors(completeDraft({ parishMode: 'directory', parish: jesusHouse(false) }))).toEqual({ parishName: MESSAGES.parishConfirm });

    const confirmed = completeDraft({ parishMode: 'directory', parish: jesusHouse(true) });
    expect(personalErrors(confirmed)).toEqual({});
    expect(firstIncompletePath(confirmed)).toBe('/apply/review');
    expect(toPayload(confirmed).parish).toEqual({ kind: 'listed', id: jesusHouse(true).id, confirmed: true, detailsWrong: false });
  });

  it('accepts a parish that isn’t listed, by name', () => {
    const draft = completeDraft({ parishMode: 'directory', parish: { kind: 'not_listed', name: 'Glory Tabernacle' } });
    expect(personalErrors(draft)).toEqual({});
    expect(toPayload(draft).parish).toEqual({ kind: 'not_listed', name: 'Glory Tabernacle' });
    expect(personalErrors(completeDraft({ parishMode: 'directory', parish: { kind: 'not_listed', name: ' ' } }))).toEqual({
      parishName: MESSAGES.parishNameRequired,
    });
  });

  it('asks again for a choice that was withdrawn', () => {
    const draft = completeDraft({ parishMode: 'directory', parish: { kind: 'withdrawn', name: 'Old Parish', reason: 'inactive', mergedInto: null } });
    expect(personalErrors(draft)).toEqual({ parishName: MESSAGES.parishRequired });
    expect(toPayload(draft).parish).toBeNull();
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

  it('clears the parish, its units and its confirmation with “Change parish”', () => {
    const after = reducer(at(completeDraft({ parishMode: 'directory', parish: jesusHouse(true) })), { type: 'parish', value: null }).draft;
    expect(after.parish).toBeNull();
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
