/**
 * Pieces the admin's parish screens share (Parish directory, Parish review, Reports, applicants):
 * finding a parish or unit to link, move or merge into; the chain on one line; directory
 * statuses; counts some roles see as "fewer than 5"; and how a directory change reads.
 */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Badge, Button, Input, errorMessage } from '../components/ui';
import { chainLine } from '../lib/parish';
import type { ChurchLevel, ParishChain, ParishSuggestion } from '../shared/directory';
import { adminApi, type HistoryItem, type UnitMatch } from './api';

export const LEVEL_LABELS: Record<ChurchLevel, string> = { continent: 'Continent', region: 'Region', province: 'Province', zone: 'Zone', area: 'Area' };
export const LEVEL_PLURALS: Record<ChurchLevel, string> = { continent: 'Continents', region: 'Regions', province: 'Provinces', zone: 'Zones', area: 'Areas' };

/** "1 warning", "3 warnings". */
export const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString('en-GB')} ${count === 1 ? one : many}`;

export function DirectoryStatusBadge({ status }: { status: string | null }) {
  if (!status || status === 'active') return null;
  return <Badge tone={status === 'merged' ? 'neutral' : 'warning'}>{status === 'merged' ? 'Merged' : 'Inactive'}</Badge>;
}

/** Counts from 1 to 4 arrive as null for roles that can't see applicants' details: "fewer than 5". */
export { formatCount } from './reports/model';

export const ChainLine = ({ chain }: { chain: ParishChain }) => <span className="text-muted">{chainLine(chain) || 'Not placed in a unit'}</span>;

/**
 * For drill-down breadcrumbs: when the place shown changes (after the new level has loaded, not
 * on the first render), focus moves to the breadcrumb's current item, since the link that was
 * followed has gone. The current item needs aria-current="page" and tabIndex={-1}.
 */
export function useFocusOnPlaceChange(place: string | null) {
  const nav = useRef<HTMLElement>(null);
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (place === null) return;
    if (shown.current !== null && shown.current !== place) nav.current?.querySelector<HTMLElement>('[aria-current="page"]')?.focus();
    shown.current = place;
  }, [place]);
  return nav;
}

type FinderProps<T extends { id: string }> = {
  label: string;
  hint?: ReactNode;
  initialQuery?: string;
  /** The button on each result, e.g. "Link" or "Move here". */
  action: string;
  onChoose: (item: T) => Promise<unknown> | void;
  /** Results to leave out (the entry being changed). */
  exclude?: string[];
};

type FinderState<T> = { step: 'idle' } | { step: 'loading' } | { step: 'done'; items: T[] } | { step: 'error'; message: string };

function Finder<T extends { id: string }>({
  label,
  hint,
  initialQuery = '',
  action,
  onChoose,
  exclude = [],
  search,
  describe,
  name,
}: FinderProps<T> & {
  search: (query: string) => Promise<T[]>;
  describe: (item: T) => ReactNode;
  /** Said with each button ("Link: Jesus House, Lagos Province 3 …"), so the buttons aren't all just "Link". */
  name: (item: T) => string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [state, setState] = useState<FinderState<T>>({ step: 'idle' });
  const [choosing, setChoosing] = useState<string | null>(null);
  const run = async (event: FormEvent) => {
    event.preventDefault();
    const text = query.trim();
    if (text.length < 2) {
      setState({ step: 'error', message: 'Type at least 2 characters.' });
      return;
    }
    setState({ step: 'loading' });
    try {
      setState({ step: 'done', items: (await search(text)).filter((item) => !exclude.includes(item.id)) });
    } catch (caught) {
      setState({ step: 'error', message: errorMessage(caught) });
    }
  };
  const choose = async (item: T) => {
    setChoosing(item.id);
    try {
      await onChoose(item);
    } finally {
      setChoosing(null);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <form role="search" onSubmit={run} className="flex flex-wrap items-end gap-2">
        <Input label={label} hint={hint} value={query} onChange={(event) => setQuery(event.currentTarget.value)} className="min-w-[200px] flex-1" />
        <Button type="submit" tone="secondary" busy={state.step === 'loading'}>
          Search
        </Button>
      </form>
      <p role="status" className="sr-only">
        {state.step === 'done' ? (state.items.length === 1 ? '1 result.' : `${state.items.length} results.`) : ''}
      </p>
      {state.step === 'error' && <p className="font-sans text-[13px] font-semibold text-brand">{state.message}</p>}
      {state.step === 'done' &&
        (state.items.length ? (
          <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
            {state.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 font-sans text-[14px] leading-[1.45] text-ink">{describe(item)}</div>
                <Button tone="secondary" className="min-h-[36px] px-4 text-[13px]" busy={choosing === item.id} disabled={choosing !== null} onClick={() => void choose(item)}>
                  {action}
                  <span className="sr-only">: {name(item)}</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-sans text-[14px] text-muted">Nothing found. Try another spelling, or fewer words.</p>
        ))}
    </div>
  );
}

/** Active parishes, found the way applicants find them (name, then province or region words). */
export function ParishFinder(props: FinderProps<ParishSuggestion>) {
  return (
    <Finder<ParishSuggestion>
      {...props}
      search={async (query) => (await adminApi.searchDirectoryParishes(query)).parishes}
      name={(parish) => `${parish.name}, ${chainLine(parish.chain)}`}
      describe={(parish) => (
        <>
          <strong>{parish.name}</strong>
          <br />
          <ChainLine chain={parish.chain} />
        </>
      )}
    />
  );
}

/** Active units by name, optionally at one level. */
export function UnitFinder({ level, ...props }: FinderProps<UnitMatch> & { level?: ChurchLevel }) {
  return (
    <Finder<UnitMatch>
      {...props}
      search={async (query) => (await adminApi.searchUnits(query, level)).units}
      name={(unit) => `${unit.name}${unit.parent ? `, under ${unit.parent}` : ''}`}
      describe={(unit) => (
        <>
          <strong>{unit.name}</strong>{' '}
          <span className="text-muted">
            {LEVEL_LABELS[unit.level]}
            {unit.parent ? ` · under ${unit.parent}` : ''}
          </span>
        </>
      )}
    />
  );
}

const FIELD_WORDS: Record<string, string> = { display_name: 'name', parent: 'place', unit_id: 'place', state: 'state', status: 'status' };
/** "name and place" from staff_fields. */
export const correctedWords = (fields: string[]) => {
  const words = [...new Set(fields.map((field) => FIELD_WORDS[field] ?? field))];
  return words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
};

/** One line for a change in an entry's history. */
export function describeChange(item: HistoryItem, names: Record<string, string>): string {
  const before = item.before ?? {};
  const after = item.after;
  const name = (value: unknown) => (typeof value === 'string' ? (names[value] ?? 'another unit') : 'nothing');
  const parts: string[] = [];
  switch (item.change) {
    case 'create':
      return typeof after.split_from === 'string' ? `Added, split from ${name(after.split_from)}` : 'Added';
    case 'merge':
      return `Merged into ${name(after.merged_into_id)}`;
    case 'deactivate':
      return 'Deactivated';
    case 'reactivate':
      return 'Reactivated';
  }
  if ('display_name' in after && before.display_name !== after.display_name) parts.push(`renamed from “${String(before.display_name)}” to “${String(after.display_name)}”`);
  for (const key of ['unit_id', 'parent_id']) {
    if (key in after && before[key] !== after[key]) parts.push(`moved from ${name(before[key])} to ${name(after[key])}`);
  }
  if ('state' in after && before.state !== after.state) parts.push(after.state ? `state set to ${String(after.state)}` : 'state removed');
  if ('listed_rows' in after && before.listed_rows !== after.listed_rows) parts.push(`listed ${String(after.listed_rows)} times`);
  if ('official_name' in after && before.official_name !== after.official_name) parts.push(`spelled “${String(after.official_name)}” in the list`);
  const text = parts.join('; ') || 'Updated';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
