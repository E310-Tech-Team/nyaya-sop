/**
 * The parish question when the form uses the RCCG parish directory (docs/03, Personal step):
 * the answer as the draft keeps it, and the pure pieces of the picker (highlighting, the chain,
 * re-checking a saved choice). The component is src/components/ParishPicker.tsx.
 */
import type { ParishAnswer } from '../shared/application';
import { CHURCH_LEVELS, type ChainUnit, type ChurchLevel, type ParishChain, type ParishDetailsResponse, type ParishSearchResponse } from '../shared/directory';

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
};

export type ParishDraft =
  | ListedParish
  /** "I can't find my parish": the name as the applicant knows it. */
  | { kind: 'not_listed'; name: string }
  /** A saved choice that is no longer on the list: no answer, but the reason is shown. */
  | { kind: 'withdrawn'; name: string; reason: 'inactive' | 'merged'; mergedInto: ChainUnit | null };

/** What the form sends (POST /api/applications); null while there is no answer. */
export function parishAnswer(parish: ParishDraft | null): ParishAnswer | null {
  if (parish?.kind === 'listed') return { kind: 'listed', id: parish.id, confirmed: parish.confirmed, detailsWrong: parish.detailsWrong };
  if (parish?.kind === 'not_listed') return { kind: 'not_listed', name: parish.name };
  return null;
}

const LABELS: Record<ChurchLevel, string> = { area: 'Area', zone: 'Zone', province: 'Province', region: 'Region', continent: 'Continent' };
// Lowest level first, as a parish's address reads.
const UPWARDS = [...CHURCH_LEVELS].reverse();

/** "Lagos Province 3 · Region 54 · Continent 3": the levels the directory has for this parish. */
export function chainLine(chain: ParishChain): string {
  return UPWARDS.map((level) => chain[level]?.name)
    .filter(Boolean)
    .join(' · ');
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
  if (current.name === saved.name && CHURCH_LEVELS.every((level) => sameUnit(current.chain[level], saved.chain[level]))) return saved;
  return { ...saved, name: current.name, chain: current.chain, confirmed: false, changed: true };
}
