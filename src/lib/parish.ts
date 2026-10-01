/**
 * The parish question when the form uses the RCCG parish directory (docs/03, Personal step): the
 * province and the parish as the draft keeps them, and the pure pieces of the picker (highlighting,
 * the chain, announcements, re-checking a saved choice). The component is src/components/ParishPicker.tsx.
 */
import type { ParishAnswer } from '../shared/application';
import {
  CHURCH_LEVELS,
  type ChainUnit,
  type ChurchLevel,
  type ParishChain,
  type ParishDetailsResponse,
  type ParishSearchResponse,
  type UnitDetails,
  type UnitSearchResponse,
} from '../shared/directory';

/** The levels step 1 offers: provinces, and regions and continents for their parishes in no province. */
export const PLACE_LEVELS = ['province', 'region', 'continent'] as const satisfies readonly ChurchLevel[];
export type PlaceLevel = (typeof PLACE_LEVELS)[number];

/** A province (or a region or continent) as last fetched from the directory. */
export type ChosenPlace = { kind: 'place'; id: string; level: PlaceLevel; name: string; chain: ParishChain };

/** Step 1 of the parish question (D-59): where the applicant's parish is. */
export type ProvinceDraft =
  | ChosenPlace
  /** "I don't know my province": the search across every province instead. */
  | { kind: 'anywhere' }
  /** A place chosen earlier that is no longer on the list: step 1 asks again, and says why. */
  | { kind: 'withdrawn'; name: string };

/** A parish chosen from the list, with the details the applicant saw. */
export type ListedParish = {
  kind: 'listed';
  id: string;
  name: string;
  chain: ParishChain;
  /** "Yes, this is my parish". */
  confirmed: boolean;
  /** "Details look wrong? Tell us". */
  detailsWrong: boolean;
  /** The details changed since they were chosen, so they must be confirmed again. */
  changed: boolean;
  /**
   * How many same-named parishes in this unit the choice stands for (D-55), when more than one:
   * the form offers them once, and staff settle which is the applicant's.
   */
  lookalikes?: number;
};

/** "2 parishes with this name here", for a look-alike group; null otherwise. */
export function lookalikeNote(lookalikes: number | undefined): string | null {
  return lookalikes && lookalikes > 1 ? `${lookalikes} parishes with this name here` : null;
}

export type ParishDraft =
  | ListedParish
  /** "I can't find my parish": the name as the applicant knows it. */
  | { kind: 'not_listed'; name: string }
  /** A saved choice that is no longer on the list: no answer, but the reason is shown. */
  | { kind: 'withdrawn'; name: string; reason: 'inactive' | 'merged'; mergedInto: ChainUnit | null };

/**
 * What the form sends (POST /api/applications); null while there is no answer. A parish that isn't
 * listed carries the place chosen in step 1, by its ID only: the server names it from the directory.
 */
export function parishAnswer(parish: ParishDraft | null, province: ProvinceDraft | null = null): ParishAnswer | null {
  if (parish?.kind === 'listed') return { kind: 'listed', id: parish.id, confirmed: parish.confirmed, detailsWrong: parish.detailsWrong };
  if (parish?.kind === 'not_listed') return province?.kind === 'place' ? { kind: 'not_listed', name: parish.name, unitId: province.id } : { kind: 'not_listed', name: parish.name };
  return null;
}

/**
 * The place a parish belongs to in step 1: its province, else its region, else its continent (the
 * server's rule, so a draft saved with the one-step picker opens in the right place). Null when its
 * chain has none of them.
 */
export function placeOfChain(chain: ParishChain): ChosenPlace | null {
  for (const level of PLACE_LEVELS) {
    const unit = chain[level];
    if (!unit) continue;
    const depth = CHURCH_LEVELS.indexOf(level);
    // The place itself and the units above it.
    const above = Object.fromEntries(CHURCH_LEVELS.map((other, index) => [other, index <= depth ? chain[other] : null])) as ParishChain;
    return { kind: 'place', id: unit.id, level, name: unit.name, chain: above };
  }
  return null;
}

/** How step 1 names a place: "Region 13 (parishes not in a province)" for a region's own parishes. */
export function placeLabel(place: { level: ChurchLevel; name: string }): string {
  if (place.level === 'region') return `${place.name} (parishes not in a province)`;
  if (place.level === 'continent') return `${place.name} (parishes not in a region)`;
  return place.name;
}

/** What a place is in, for its option and summary: "Region 54 · Continent 3". */
export function placeContext(place: { level: ChurchLevel; chain: ParishChain }): string {
  const depth = CHURCH_LEVELS.indexOf(place.level);
  return namesUpwards(place.chain, (level) => CHURCH_LEVELS.indexOf(level) < depth);
}

/** Where a parish sits inside its place (a zone or area), for step 2's options; '' when directly in it. */
export function belowPlace(chain: ParishChain, level: ChurchLevel): string {
  const depth = CHURCH_LEVELS.indexOf(level);
  return namesUpwards(chain, (other) => CHURCH_LEVELS.indexOf(other) > depth);
}

const LABELS: Record<ChurchLevel, string> = { area: 'Area', zone: 'Zone', province: 'Province', region: 'Region', continent: 'Continent' };
// Lowest level first, as a parish's address reads.
const UPWARDS = [...CHURCH_LEVELS].reverse();

/** The chain's names from the lowest level up, of the levels `include` keeps. */
function namesUpwards(chain: ParishChain, include: (level: ChurchLevel) => boolean): string {
  return UPWARDS.filter(include)
    .map((level) => chain[level]?.name)
    .filter(Boolean)
    .join(' · ');
}

/** "Lagos Province 3 · Region 54 · Continent 3": the levels the directory has for this parish. */
export function chainLine(chain: ParishChain): string {
  return namesUpwards(chain, () => true);
}

/**
 * The rows of the confirmation card: province, region and continent (and zone and area when the
 * directory has them). A missing province or region says what the parish sits under instead.
 */
export function chainRows(chain: ParishChain): [label: string, value: string][] {
  const rows: [string, string][] = [];
  UPWARDS.forEach((level, index) => {
    const unit = chain[level];
    if (unit) rows.push([LABELS[level], unit.name]);
    else if (level === 'province' || level === 'region') {
      const above = UPWARDS.slice(index + 1)
        .map((higher) => chain[higher])
        .find(Boolean);
      if (above) rows.push([LABELS[level], `None (directly under ${above.name})`]);
    }
  });
  return rows;
}

const words = (text: string) => text.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);

/** The name split into runs, with the start of each word that matches a typed word marked. */
export function highlightParts(name: string, query: string): { text: string; match: boolean }[] {
  const terms = words(query);
  const parts: { text: string; match: boolean }[] = [];
  const push = (text: string, match: boolean) => {
    const last = parts[parts.length - 1];
    if (last && last.match === match) last.text += text;
    else if (text) parts.push({ text, match });
  };
  for (const token of name.split(/([A-Za-z0-9']+)/)) {
    const bare = token.replace(/'/g, '').toUpperCase();
    const term = /[A-Za-z0-9]/.test(token) ? terms.filter((candidate) => bare.startsWith(candidate)).sort((a, b) => b.length - a.length)[0] : undefined;
    if (!term) {
      push(token, false);
      continue;
    }
    // Mark as many characters as the term has letters and digits (apostrophes don't count).
    let end = 0;
    for (let counted = 0; end < token.length && counted < term.length; end++) if (token[end] !== "'") counted++;
    push(token.slice(0, end), true);
    push(token.slice(end), false);
  }
  return parts;
}

/** What a screen reader hears when step 1's suggestions arrive ("12 provinces found."). */
export function placesAnnouncement(response: UnitSearchResponse): string {
  const shown = response.results.length;
  if (!shown) return 'No provinces found.';
  const provinces = response.results.every((result) => result.level === 'province');
  const noun = (count: number) => (provinces ? (count === 1 ? 'province' : 'provinces') : count === 1 ? 'match' : 'matches');
  if (response.total > shown) return `Showing ${shown} of ${response.total} ${noun(response.total)}.`;
  return `${shown} ${noun(shown)} found.`;
}

/**
 * Step 2's list in words: "Showing 20 of 104 parishes in Lagos Province 12." `shown` counts every
 * page shown so far; `filtered` says whether a name was typed.
 */
export function placeParishesAnnouncement(found: { total: number; fuzzy: boolean }, shown: number, place: string, filtered: boolean): string {
  if (!shown) return filtered ? `No parishes in ${place} match.` : `No parishes listed in ${place}.`;
  if (found.fuzzy) return `No exact match in ${place}. ${shown} similar ${shown === 1 ? 'name' : 'names'} found.`;
  const noun = (count: number) => (count === 1 ? 'parish' : 'parishes');
  if (found.total > shown) return `Showing ${shown} of ${found.total} ${noun(found.total)} in ${place}.`;
  return `${shown} ${noun(shown)} in ${place}${filtered ? (shown === 1 ? ' matches' : ' match') : ''}.`;
}

/** What a screen reader hears when suggestions arrive. */
export function resultsAnnouncement(response: ParishSearchResponse): string {
  const shown = response.results.length;
  if (!shown) return 'No parishes found.';
  if (response.fuzzy) return `No exact match. ${shown} similar ${shown === 1 ? 'name' : 'names'} found.`;
  if (response.total > shown) return `${response.total} parishes found, showing ${shown}.`;
  return `${shown} ${shown === 1 ? 'parish' : 'parishes'} found.`;
}

const sameUnit = (a: ChainUnit | null, b: ChainUnit | null) => a?.id === b?.id && a?.name === b?.name;

/**
 * A saved choice checked against the directory as it stands now (null: no such parish). Unchanged
 * stays as it is; renamed or moved must be confirmed again; merged or deactivated is withdrawn.
 */
export function recheck(saved: ListedParish, current: ParishDetailsResponse | null): ParishDraft {
  if (!current || current.status === 'inactive') return { kind: 'withdrawn', name: saved.name, reason: 'inactive', mergedInto: null };
  if (current.status === 'merged') return { kind: 'withdrawn', name: saved.name, reason: 'merged', mergedInto: current.mergedInto };
  const lookalikes = current.lookalikes && current.lookalikes > 1 ? current.lookalikes : undefined;
  if (current.name === saved.name && CHURCH_LEVELS.every((level) => sameUnit(current.chain[level], saved.chain[level]))) {
    // Only how many look alike changed (the registry merged or added one): nothing to confirm again.
    if (lookalikes === saved.lookalikes) return saved;
    const { lookalikes: _previous, ...rest } = saved;
    return lookalikes ? { ...rest, lookalikes } : rest;
  }
  const { lookalikes: _previous, ...rest } = saved;
  return { ...rest, name: current.name, chain: current.chain, confirmed: false, changed: true, ...(lookalikes ? { lookalikes } : {}) };
}

/**
 * A saved place checked against the directory as it stands now (null: no longer a place to choose
 * a parish in). Renamed or moved, it takes the new details; gone, it's withdrawn.
 */
export function recheckPlace(saved: ChosenPlace, current: UnitDetails | null): ProvinceDraft {
  if (!current || !(PLACE_LEVELS as readonly string[]).includes(current.level)) return { kind: 'withdrawn', name: saved.name };
  const same = current.name === saved.name && current.level === saved.level && CHURCH_LEVELS.every((level) => sameUnit(current.chain[level], saved.chain[level]));
  return same ? saved : { kind: 'place', id: current.id, level: current.level as PlaceLevel, name: current.name, chain: current.chain };
}
