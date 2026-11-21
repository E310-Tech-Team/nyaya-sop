import { describe, expect, it } from 'vitest';
import { AGE_RANGES } from './application';
import { ageEligibility, ageEligibilityShort, ageLimitFor, ageLimitMessage, ageRangeAllowed, ageRangeUpper, continentNumber } from './ageLimits';

describe('age limits by continent', () => {
  it('reads the continent number from the directory’s name, in any case or spacing', () => {
    expect(continentNumber('CONTINENT 1')).toBe(1);
    expect(continentNumber('Continent 11')).toBe(11);
    expect(continentNumber('  continent  2 ')).toBe(2);
    expect(continentNumber('REGION 5')).toBeNull();
    expect(continentNumber(null)).toBeNull();
  });

  it('allows 35 in Continent 1, 40 in Continents 2 and 11, and 30 everywhere else or when unknown', () => {
    expect(ageLimitFor('CONTINENT 1')).toBe(35);
    expect(ageLimitFor('CONTINENT 2')).toBe(40);
    expect(ageLimitFor('CONTINENT 11')).toBe(40);
    expect(ageLimitFor('CONTINENT 3')).toBe(30);
    expect(ageLimitFor('CONTINENT 12')).toBe(30);
    expect(ageLimitFor(null)).toBe(30);
  });

  it('offers ranges up to 40, each with its upper age', () => {
    expect(AGE_RANGES.map((range) => range.value)).toEqual(['18_20', '21_24', '25_27', '28_30', '31_35', '36_40']);
    expect(AGE_RANGES.map((range) => ageRangeUpper(range.value))).toEqual([20, 24, 27, 30, 35, 40]);
  });

  it('accepts a range only when its upper age is within the continent’s limit', () => {
    expect(ageRangeAllowed('28_30', null)).toBe(true);
    expect(ageRangeAllowed('31_35', null)).toBe(false);
    expect(ageRangeAllowed('31_35', 'CONTINENT 1')).toBe(true);
    expect(ageRangeAllowed('36_40', 'CONTINENT 1')).toBe(false);
    expect(ageRangeAllowed('36_40', 'CONTINENT 2')).toBe(true);
    expect(ageRangeAllowed('36_40', 'CONTINENT 11')).toBe(true);
    expect(ageRangeAllowed('31_35', 'CONTINENT 4')).toBe(false);
  });

  it('explains the limit that applies, naming the continent when it is known', () => {
    expect(ageLimitMessage('CONTINENT 1')).toBe('In Continent 1 the programme is for ages 18–35.');
    expect(ageLimitMessage('CONTINENT 4')).toBe('In Continent 4 the programme is for ages 18–30.');
    expect(ageLimitMessage(null)).toBe(
      'Ages over 30 are open only to parishes in Continent 1 (up to 35) and Continents 2 and 11 (up to 40). Choose your parish’s province to check.',
    );
  });

  it('states the rule in one line for the site’s copy', () => {
    expect(ageEligibility()).toBe('18–30, or up to 35 in Continent 1 and up to 40 in Continents 2 and 11');
    // Where space is short (the homepage hero): the highest limit, without the list.
    expect(ageEligibilityShort()).toBe('18–30 (up to 40 in some continents)');
  });
});
