/** How the drill-down from continents to parishes names what it lists (shared by its cards, its table and the overview). */
import type { ChurchLevel } from '../../shared/directory';
import type { Count, ReportCard, ReportListing } from '../api';
import { LEVEL_LABELS, LEVEL_PLURALS, plural } from '../directory-parts';

export const singular = (level: ChurchLevel) => LEVEL_LABELS[level].toLowerCase();
export const plurals = (level: ChurchLevel) => LEVEL_PLURALS[level].toLowerCase();

/** What a listing lists: "regions", "regions in Continent 3", "parishes directly under Region 19". */
export function listed(data: ReportListing): { noun: string; one: string; title: string } {
  if (data.mode === 'parishes') {
    const title = data.within ? (data.direct ? `Parishes directly under ${data.within.name}` : `Parishes in ${data.within.name}`) : data.without ? `Parishes with no ${data.without}` : 'All parishes';
    return { noun: 'parishes', one: 'parish', title };
  }
  if (data.mode === 'children') {
    const level = data.within?.childLevel;
    const noun = level ? plurals(level) : 'places';
    return { noun, one: level ? singular(level) : 'place', title: `${noun.charAt(0).toUpperCase()}${noun.slice(1)} in ${data.within!.name}` };
  }
  const noun = plurals(data.level as ChurchLevel);
  return { noun, one: singular(data.level as ChurchLevel), title: `All ${noun}` };
}

/** What a card is, under its name. */
export function describePlace(card: ReportCard): string {
  if (card.kind === 'unit') return `${LEVEL_LABELS[card.level!]}${card.parent ? ` in ${card.parent.name}` : ''}`;
  if (card.kind === 'parish') return [card.chain?.province, card.chain?.region, card.chain?.continent].filter(Boolean).join(' · ') || 'Not placed in a unit';
  if (card.kind === 'direct') return 'Parishes the RCCG list places directly under it, with no level in between.';
  if (card.kind === 'unassigned') return "No directory parish: the applicant couldn't find theirs, typed a name on the earlier form, or gave none.";
  return card.name === 'No region' ? 'Parishes in provinces that sit straight under a continent, with no region.' : 'Parishes that sit straight under a region or continent, with no province.';
}

/** The way into a card: "View regions", "View regions and provinces", "View parishes", "View applications". */
export function drillLabel(card: ReportCard): string {
  if (card.kind === 'parish') return 'View applications';
  const levels = card.children.map((child) => plurals(child.level));
  return levels.length ? `View ${levels.join(' and ')}` : 'View parishes';
}

/** The units and parishes beneath a card, each with how many have applications: "Regions 22, 18 with applications". */
export function beneath(card: ReportCard): { label: string; total: number; withApplications: Count }[] {
  const lines = card.children.map((child, index) => ({
    label: index === 0 ? LEVEL_PLURALS[child.level] : `${LEVEL_PLURALS[child.level]} directly under it`,
    total: child.count,
    withApplications: child.withApplications,
  }));
  if (card.activeParishes !== null) lines.push({ label: 'Parishes', total: card.activeParishes, withApplications: card.parishesWithApplications });
  return lines;
}

/** "22 regions", "1 parish". */
export const countOf = (count: number, level: ChurchLevel | 'parish') => (level === 'parish' ? plural(count, 'parish', 'parishes') : plural(count, singular(level), plurals(level)));
