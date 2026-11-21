import type { AgeRange } from './application';

/**
 * Who can apply, by age (06 D-65): 18–30, with a higher limit in some RCCG continents. The
 * continent comes from the parish directory (the chosen parish's chain, or the place chosen
 * for an unlisted parish), never from what the browser sends: the server re-checks it.
 * Used by the form, the submission route and the site's copy.
 */

export const MIN_AGE = 18;
export const STANDARD_AGE_LIMIT = 30;

/** Higher limits by continent number ("CONTINENT 1" in the directory). Everywhere else, or unknown: 30. */
export const AGE_LIMITS_BY_CONTINENT: Readonly<Record<number, number>> = { 1: 35, 2: 40, 11: 40 };

/** The highest age in each range (the ranges are AGE_RANGES in ./application). */
const RANGE_UPPER: Record<AgeRange, number> = { '18_20': 20, '21_24': 24, '25_27': 27, '28_30': 30, '31_35': 35, '36_40': 40 };

/** The number in a directory continent name ("CONTINENT 11" → 11), or null for anything else. */
export function continentNumber(name: string | null | undefined): number | null {
  const match = name?.trim().match(/^continent\s+(\d+)$/i);
  return match ? Number(match[1]) : null;
}

/** The oldest age accepted for a parish in this continent (by its directory name; null: unknown). */
export function ageLimitFor(continentName: string | null | undefined): number {
  const number = continentNumber(continentName);
  if (number === null || !Object.hasOwn(AGE_LIMITS_BY_CONTINENT, number)) return STANDARD_AGE_LIMIT;
  return AGE_LIMITS_BY_CONTINENT[number];
}

export const ageRangeUpper = (range: AgeRange): number => RANGE_UPPER[range];

/** Whether an age range is open to a parish in this continent. */
export const ageRangeAllowed = (range: AgeRange, continentName: string | null | undefined): boolean =>
  ageRangeUpper(range) <= ageLimitFor(continentName);

const listNumbers = (numbers: number[]): string =>
  numbers.length === 1 ? `Continent ${numbers[0]}` : `Continents ${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;

/** The higher limits, lowest first: [[35, [1]], [40, [2, 11]]]. */
function higherLimits(): [limit: number, continents: number[]][] {
  const groups = new Map<number, number[]>();
  for (const [continent, limit] of Object.entries(AGE_LIMITS_BY_CONTINENT)) {
    groups.set(limit, [...(groups.get(limit) ?? []), Number(continent)].sort((a, b) => a - b));
  }
  return [...groups.entries()].sort(([a], [b]) => a - b);
}

/** "18–30, or up to 35 in Continent 1 and up to 40 in Continents 2 and 11": the rule for the site's copy. */
export function ageEligibility(): string {
  const higher = higherLimits().map(([limit, continents]) => `up to ${limit} in ${listNumbers(continents)}`);
  return `${MIN_AGE}–${STANDARD_AGE_LIMIT}${higher.length ? `, or ${higher.join(' and ')}` : ''}`;
}

/** "18–30 (up to 40 in some continents)": the rule where space is short. */
export function ageEligibilityShort(): string {
  const highest = Math.max(STANDARD_AGE_LIMIT, ...Object.values(AGE_LIMITS_BY_CONTINENT));
  return highest > STANDARD_AGE_LIMIT ? `${MIN_AGE}–${STANDARD_AGE_LIMIT} (up to ${highest} in some continents)` : `${MIN_AGE}–${STANDARD_AGE_LIMIT}`;
}

/** Why an age range isn't accepted: the continent's limit, or where the higher limits apply. */
export function ageLimitMessage(continentName: string | null | undefined): string {
  const number = continentNumber(continentName);
  if (number !== null) return `In Continent ${number} the programme is for ages ${MIN_AGE}–${ageLimitFor(continentName)}.`;
  const where = higherLimits().map(([limit, continents]) => `${listNumbers(continents)} (up to ${limit})`);
  return `Ages over ${STANDARD_AGE_LIMIT} are open only to parishes in ${where.join(' and ')}. Choose your parish’s province to check.`;
}
