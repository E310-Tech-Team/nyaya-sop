/** How the region, province and parish report names what it lists (shared by its cards and its table). */
import type { ChurchLevel } from '../../shared/directory';
import type { ReportCard, ReportListing } from '../api';
import { LEVEL_LABELS, LEVEL_PLURALS, plural } from '../directory-parts';

export const singular = (level: ChurchLevel) => LEVEL_LABELS[level].toLowerCase();
export const plurals = (level: ChurchLevel) => LEVEL_PLURALS[level].toLowerCase();

/** What a listing lists: "regions", "provinces in Region 54", "parishes directly under Region 19". */
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
  return card.name === 'No region' ? 'Parishes in provinces that sit straight under a continent, with no region.' : 'Parishes that sit straight under a region or continent, with no province.';
}

/** The drill-down action: "View 3 provinces", "View parishes". */
export const drillLabel = (card: ReportCard) => (card.children ? `View ${plural(card.children.count, singular(card.children.level), plurals(card.children.level))}` : 'View parishes');
