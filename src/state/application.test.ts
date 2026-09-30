import { describe, expect, it } from 'vitest';
import type { ListedParish } from '../lib/parish';
import { validPayload } from '../shared/test-fixtures';
import { MESSAGES } from '../shared/validation';
import { emptyDraft, firstIncompletePath, personalErrors, toPayload, type Draft } from './application';

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
  it('stays optional free text while the directory is off, and sends no parish answer', () => {
    const draft = completeDraft();
    expect(personalErrors(draft)).toEqual({});
    expect(firstIncompletePath(draft)).toBe('/apply/review');
    expect(toPayload(draft)).not.toHaveProperty('parish');
  });

  it('must be chosen and confirmed while the directory is on', () => {
    expect(personalErrors(completeDraft({ parishMode: 'directory' }))).toEqual({ parishName: MESSAGES.parishRequired });
    expect(firstIncompletePath(completeDraft({ parishMode: 'directory' }))).toBe('/apply/personal');
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
