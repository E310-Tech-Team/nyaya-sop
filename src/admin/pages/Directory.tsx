import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Pagination, Panel, Select, TableScroll, td, th, when } from '../../components/ui';
import { chainRows } from '../../lib/parish';
import { useAsync } from '../../lib/useAsync';
import { NIGERIAN_STATES } from '../../shared/application';
import type { ChurchLevel } from '../../shared/directory';
import { adminApi, type History, type ParishEntry, type UnitDetail } from '../api';
import { correctedWords, describeChange, DirectoryStatusBadge, LEVEL_LABELS, LEVEL_PLURALS, ParishFinder, plural, UnitFinder, useFocusOnPlaceChange } from '../directory-parts';
import { useAction } from '../parts';
import { useCan } from '../session';

const TABS = [
  { tab: 'tree', label: 'Directory' },
  { tab: 'imports', label: 'Imports' },
  { tab: 'changes', label: '2026 changes' },
] as const;
type Tab = (typeof TABS)[number]['tab'];

/** The level staff add under a unit (zone and area wait for the RCCG API). */
const CHILD_LEVEL: Partial<Record<ChurchLevel, 'region' | 'province'>> = { continent: 'region', region: 'province' };

function useParamsSetter() {
  const [params, setParams] = useSearchParams();
  const set = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  return { params, set };
}

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-4 gap-y-2 font-sans text-[14px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold text-muted">{label}</dt>
          <dd className="break-words text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HistoryList({ history }: { history: History }) {
  if (!history.items.length) return <p className="font-sans text-[14px] text-muted">No changes recorded.</p>;
  return (
    <ol className="flex flex-col gap-2 font-sans text-[14px] text-ink">
      {history.items.map((item) => (
        <li key={item.id} className="border-l-2 border-line pl-3">
          {describeChange(item, history.names)}
          <div className="text-[12px] text-muted">
            {when(item.at)} · {item.by}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A small form: one text field and a button. */
function OneField({ label, initial = '', action, onSubmit, busy }: { label: string; initial?: string; action: string; onSubmit: (value: string) => void; busy: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <Input label={label} value={value} onChange={(event) => setValue(event.currentTarget.value)} className="min-w-[200px] flex-1" />
      <Button type="submit" tone="secondary" busy={busy} disabled={!value.trim() || value.trim() === initial}>
        {action}
      </Button>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-[10px] border border-line px-3 py-2">
      <summary className="cursor-pointer font-sans text-[14px] font-bold text-brand">{title}</summary>
      <div className="flex flex-col gap-3 pt-3">{children}</div>
    </details>
  );
}

/** The panel heading takes focus when the panel opens, so keyboard and screen-reader users land on it. */
function PanelHeading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <h2 ref={ref} tabIndex={-1} className="font-sans text-[20px] font-bold leading-[1.25] text-ink outline-none">
      {children}
    </h2>
  );
}

/** The provider's canonical code from an external ID ("rccg-org:production:RCCG-F3A7C912" → "RCCG-F3A7C912"). */
const directoryCode = (externalId: string) => externalId.split(':').pop() ?? externalId;

function ParishPanel({ parishId, onChanged, onClose }: { parishId: string; onChanged: () => void; onClose: () => void }) {
  const canManage = useCan('directory.manage');
  const entry = useAsync((signal) => adminApi.parishEntry(parishId, signal), [parishId]);
  const { busy, run, notice } = useAction();
  const [mergeInto, setMergeInto] = useState<{ id: string; name: string } | null>(null);
  const done = (ok: boolean) => {
    if (!ok) return;
    entry.reload();
    onChanged();
  };
  if (entry.error) return <LoadError error={entry.error} onRetry={entry.reload} />;
  if (!entry.data) return <Loading />;
  const { parish, aliases, applications, history, apiManaged }: ParishEntry = entry.data;
  const active = parish.status === 'active';
  return (
    <section aria-label="Parish" className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-5 shadow-[0px_8px_24px_0px_rgba(45,9,20,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <PanelHeading>
          {parish.name} <DirectoryStatusBadge status={parish.status} />
        </PanelHeading>
        <Button tone="ghost" className="min-h-[36px] px-3 text-[13px]" onClick={onClose}>
          Close
        </Button>
      </div>
      {notice}
      <Details
        rows={[
          ...(parish.origin === 'import' ? [['In the RCCG list as', parish.officialName] as [string, ReactNode]] : []),
          ...(parish.externalId ? [['RCCG directory code', directoryCode(parish.externalId)] as [string, ReactNode]] : []),
          ...chainRows(parish.chain).map(([label, value]) => [label, value] as [string, ReactNode]),
          ['Listed', parish.listedRows > 1 ? `${parish.listedRows} times (one entry until RCCG confirms)` : 'Once'],
          ...(aliases.length ? [['Other spellings', aliases.join(' · ')] as [string, ReactNode]] : []),
          ['Added by', parish.origin === 'staff' ? 'Staff' : 'An import'],
          ...(parish.corrected.length ? [['Corrected', `Staff set its ${correctedWords(parish.corrected)}; imports keep it.`] as [string, ReactNode]] : []),
          ...(parish.listedUnder ? [['The list has it under', parish.listedUnder.name ?? 'another unit'] as [string, ReactNode]] : []),
          ...(parish.mergedInto ? [['Merged into', parish.mergedInto.name] as [string, ReactNode]] : []),
          [
            'Applications',
            applications ? (
              <Link to={`/admin/applicants?parish=${parish.id}`} className="font-bold text-brand underline underline-offset-4">
                {applications}
              </Link>
            ) : (
              '0'
            ),
          ],
        ]}
      />
      {apiManaged && (
        <p className="font-sans text-[13px] leading-[1.5] text-muted">
          This entry comes from the RCCG directory API. Changes are made there (ask the registry team) and reach this site with its next release.
        </p>
      )}
      {canManage && !apiManaged && parish.status !== 'merged' && (
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-[15px] font-bold text-ink">Correct it</h3>
          <Section title="Rename">
            <OneField label="Name applicants see" initial={parish.name} action="Rename" busy={busy === 'rename'} onSubmit={(displayName) => void run('rename', () => adminApi.updateParish(parish.id, { displayName }), 'Renamed.').then(done)} />
          </Section>
          <Section title="Move to another province, region or continent">
            <UnitFinder label="Move it to" action="Move here" exclude={[parish.unit.id]} onChoose={(unit) => run('move', () => adminApi.updateParish(parish.id, { unitId: unit.id }), `Moved to ${unit.name}.`).then(done)} />
          </Section>
          <Section title={`Merge into another parish${applications ? ` (its ${plural(applications, 'application')} move too)` : ''}`}>
            {mergeInto ? (
              <div className="flex flex-col gap-3 rounded-[10px] border border-brand/40 bg-rose/20 p-3">
                <p className="font-sans text-[14px] text-ink">
                  Merge <strong>{parish.name}</strong> into <strong>{mergeInto.name}</strong>? {applications ? `Its ${plural(applications, 'application')} will count under ${mergeInto.name}. ` : ''}
                  What applicants confirmed stays on their applications.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button busy={busy === 'merge'} onClick={() => void run('merge', () => adminApi.mergeParish(parish.id, mergeInto.id), `Merged into ${mergeInto.name}.`).then(done)}>
                    Merge
                  </Button>
                  <Button tone="ghost" onClick={() => setMergeInto(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <ParishFinder label="Merge it into" action="Choose" exclude={[parish.id]} onChoose={(into) => setMergeInto({ id: into.id, name: into.name })} />
            )}
          </Section>
          {parish.listedRows > 1 && active && (
            <Section title="Split: it’s really more than one parish">
              <p className="font-sans text-[14px] text-muted">Adds a second parish here under a name that tells them apart. Move any applications that belong to it afterwards.</p>
              <OneField label="Name of the other parish" action="Add it" busy={busy === 'split'} onSubmit={(name) => void run('split', () => adminApi.splitParish(parish.id, name), `${name} was added.`).then(done)} />
            </Section>
          )}
          <div>
            {active ? (
              <Button tone="ghost" busy={busy === 'status'} onClick={() => void run('status', () => adminApi.updateParish(parish.id, { status: 'inactive' }), 'Deactivated: applicants can no longer choose it.').then(done)}>
                Deactivate (applicants can’t choose it)
              </Button>
            ) : (
              <Button tone="secondary" busy={busy === 'status'} onClick={() => void run('status', () => adminApi.updateParish(parish.id, { status: 'active' }), 'Reactivated.').then(done)}>
                Reactivate
              </Button>
            )}
          </div>
        </div>
      )}
      <h3 className="font-sans text-[15px] font-bold text-ink">History</h3>
      <HistoryList history={history} />
    </section>
  );
}

function UnitPanel({ unitId, onChanged, onClose, onOpenParish }: { unitId: string; onChanged: () => void; onClose: () => void; onOpenParish: (id: string) => void }) {
  const canManage = useCan('directory.manage');
  const detail = useAsync((signal) => adminApi.unitDetail(unitId, signal), [unitId]);
  const { busy, run, notice } = useAction();
  const [mergeInto, setMergeInto] = useState<{ id: string; name: string } | null>(null);
  const [state, setState] = useState('');
  useEffect(() => setState(detail.data?.unit.state ?? ''), [detail.data?.unit.state]);
  const done = (ok: boolean) => {
    if (!ok) return;
    detail.reload();
    onChanged();
  };
  if (detail.error) return <LoadError error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  const { unit, counts, lineage, history, apiManaged }: UnitDetail = detail.data;
  const childLevel = CHILD_LEVEL[unit.level];
  return (
    <section aria-label={LEVEL_LABELS[unit.level]} className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-5 shadow-[0px_8px_24px_0px_rgba(45,9,20,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <PanelHeading>
          {unit.name} <DirectoryStatusBadge status={unit.status} />
        </PanelHeading>
        <Button tone="ghost" className="min-h-[36px] px-3 text-[13px]" onClick={onClose}>
          Close
        </Button>
      </div>
      {notice}
      <Details
        rows={[
          ['Level', LEVEL_LABELS[unit.level]],
          ['In the RCCG list as', unit.officialName],
          ...(unit.externalId ? [['RCCG directory code', directoryCode(unit.externalId)] as [string, ReactNode]] : []),
          ...(unit.level === 'province' ? [['State', unit.state ?? 'Not linked to a state'] as [string, ReactNode]] : []),
          ['Active parishes', counts.activeParishes.toLocaleString('en-GB')],
          [
            'Applications',
            counts.applications ? (
              <Link to={`/admin/applicants?unit=${unit.id}`} className="font-bold text-brand underline underline-offset-4">
                {counts.applications}
              </Link>
            ) : (
              '0'
            ),
          ],
          ['Added by', unit.origin === 'staff' ? 'Staff' : 'An import'],
          ...(unit.corrected.length ? [['Corrected', `Staff set its ${correctedWords(unit.corrected)}; imports keep it.`] as [string, ReactNode]] : []),
          ...(unit.mergedInto ? [['Merged into', unit.mergedInto.name ?? 'another unit'] as [string, ReactNode]] : []),
          ...(lineage.createdFrom.length ? [['Created in 2026 from', lineage.createdFrom.map((source) => source.name).join(', ')] as [string, ReactNode]] : []),
          ...(lineage.sourceOf.length ? [['In 2026, gave parishes to', lineage.sourceOf.map((target) => target.name).join(', ')] as [string, ReactNode]] : []),
        ]}
      />
      {apiManaged && (
        <p className="font-sans text-[13px] leading-[1.5] text-muted">
          This entry comes from the RCCG directory API. Changes are made there (ask the registry team) and reach this site with its next release.
        </p>
      )}
      {canManage && !apiManaged && unit.status === 'active' && (
        <div className="flex flex-col gap-2">
          <h3 className="font-sans text-[15px] font-bold text-ink">Correct it</h3>
          <Section title="Rename">
            <OneField label="Name shown" initial={unit.name} action="Rename" busy={busy === 'rename'} onSubmit={(displayName) => void run('rename', () => adminApi.updateUnit(unit.id, { displayName }), 'Renamed.').then(done)} />
          </Section>
          {unit.level !== 'continent' && (
            <Section title="Move under another unit">
              <UnitFinder
                label={unit.level === 'region' ? 'Move it to the continent' : 'Move it to the region (or continent)'}
                level={unit.level === 'region' ? 'continent' : undefined}
                action="Move here"
                onChoose={(parent) => run('move', () => adminApi.updateUnit(unit.id, { parentId: parent.id }), `Moved under ${parent.name}.`).then(done)}
              />
            </Section>
          )}
          {unit.level === 'province' && (
            <Section title="Set its state">
              <p className="font-sans text-[14px] text-muted">Parishes in the applicant’s state come first in search.</p>
              <form
                noValidate
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run('state', () => adminApi.updateUnit(unit.id, { state: state || null }), 'State saved.').then(done);
                }}
              >
                <Select
                  label="State"
                  value={state}
                  onChange={(event) => setState(event.currentTarget.value)}
                  options={[{ value: '', label: 'Not linked to a state' }, ...NIGERIAN_STATES.map((name) => ({ value: name, label: name }))]}
                  className="min-w-[220px]"
                />
                <Button type="submit" tone="secondary" busy={busy === 'state'} disabled={state === (unit.state ?? '')}>
                  Save
                </Button>
              </form>
            </Section>
          )}
          <Section title={`Merge into another ${unit.level}`}>
            {mergeInto ? (
              <div className="flex flex-col gap-3 rounded-[10px] border border-brand/40 bg-rose/20 p-3">
                <p className="font-sans text-[14px] text-ink">
                  Merge <strong>{unit.name}</strong> into <strong>{mergeInto.name}</strong>? Everything under it moves across; a parish whose name {mergeInto.name} already lists is merged into that one.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button busy={busy === 'merge'} onClick={() => void run('merge', () => adminApi.mergeUnit(unit.id, mergeInto.id), `Merged into ${mergeInto.name}.`).then(done)}>
                    Merge
                  </Button>
                  <Button tone="ghost" onClick={() => setMergeInto(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <UnitFinder label="Merge it into" level={unit.level} action="Choose" exclude={[unit.id]} onChoose={(into) => setMergeInto({ id: into.id, name: into.name })} />
            )}
          </Section>
          <Section title="Add a parish here">
            <OneField
              label="Parish name"
              action="Add"
              busy={busy === 'add-parish'}
              onSubmit={(name) =>
                void run('add-parish', async () => {
                  const created = await adminApi.createParish({ unitId: unit.id, name });
                  onOpenParish(created.id);
                }, `${name} was added.`).then(done)
              }
            />
          </Section>
          {childLevel && (
            <Section title={`Add a ${childLevel} under it`}>
              <OneField
                label={`${LEVEL_LABELS[childLevel]} name`}
                action="Add"
                busy={busy === 'add-unit'}
                onSubmit={(name) => void run('add-unit', () => adminApi.createUnit({ level: childLevel, name, parentId: unit.id }), `${name} was added.`).then(done)}
              />
            </Section>
          )}
        </div>
      )}
      <h3 className="font-sans text-[15px] font-bold text-ink">History</h3>
      <HistoryList history={history} />
    </section>
  );
}

function TreeTab() {
  const { params, set } = useParamsSetter();
  const unit = params.get('unit') ?? '';
  const parish = params.get('parish') ?? '';
  const panel = params.get('panel') ?? '';
  const q = params.get('q') ?? '';
  const show = params.get('show') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const canManage = useCan('directory.manage');
  const browse = useAsync((signal) => adminApi.browseDirectory({ unit: unit || undefined, q: q || undefined, page, show: show || undefined }, signal), [unit, q, page, show]);
  const [filter, setFilter] = useState(q);
  useEffect(() => setFilter(q), [q]);
  const { busy, run, notice } = useAction();

  const openUnit = (id: string | null) => set({ unit: id, parish: null, panel: null, q: null, page: null });
  const data = browse.data;
  const whereNav = useFocusOnPlaceChange(data ? (data.unit?.id ?? 'top') : null);
  // A level column only when the units listed mix levels (a province directly under a continent).
  const childLevels = [...new Set(data?.children.map((child) => child.level) ?? [])];
  const here = 'rounded-[4px] font-bold text-ink outline-offset-2 focus-visible:outline-2 focus-visible:outline-brand';

  const side = parish ? (
    <ParishPanel key={parish} parishId={parish} onChanged={browse.reload} onClose={() => set({ parish: null })} />
  ) : panel === 'unit' && unit ? (
    <UnitPanel key={unit} unitId={unit} onChanged={browse.reload} onClose={() => set({ panel: null })} onOpenParish={(id) => set({ parish: id, panel: null })} />
  ) : !unit && canManage && data && !data.apiManaged ? (
    <Panel title="Add a continent" description="Only for a continent RCCG has confirmed. Regions and provinces are added from the continent or region they belong to.">
      {notice}
      <OneField label="Continent name" action="Add" busy={busy === 'continent'} onSubmit={(name) => void run('continent', () => adminApi.createUnit({ level: 'continent', name, parentId: null }), `${name} was added.`).then((ok) => ok && browse.reload())} />
    </Panel>
  ) : (
    <Panel title="Choose an entry">
      <p className="font-sans text-[14px] text-muted">Open a province, region or continent to see what’s under it, or a parish to see its details and history{canManage ? ' and correct it' : ''}.</p>
    </Panel>
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="flex min-w-0 flex-col gap-5">
        <nav ref={whereNav} aria-label="Where you are" className="font-sans text-[14px]">
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <li>
              {unit ? (
                <Link to="?" className="font-bold text-brand underline-offset-4 hover:underline">
                  All continents
                </Link>
              ) : (
                <span aria-current="page" tabIndex={-1} className={here}>
                  All continents
                </span>
              )}
            </li>
            {data?.ancestors.map((ancestor) => (
              <li key={ancestor.id} className="flex items-center gap-2">
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
                <Link to={`?unit=${ancestor.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                  {ancestor.name}
                </Link>
              </li>
            ))}
            {data?.unit && (
              <li className="flex items-center gap-2">
                <span aria-hidden="true" className="text-muted">
                  ›
                </span>
                <span aria-current="page" tabIndex={-1} className={here}>
                  {data.unit.name}
                </span>
              </li>
            )}
          </ol>
        </nav>

        <Section title="Find a parish or unit">
          <ParishFinder label="Parish" action="Open" onChoose={(found) => set({ unit: found.chain.province?.id ?? found.chain.region?.id ?? found.chain.continent?.id ?? null, parish: found.id, panel: null, q: null, page: null })} />
          <UnitFinder label="Province, region or continent" action="Open" onChoose={(found) => openUnit(found.id)} />
        </Section>

        {browse.error ? (
          <LoadError error={browse.error} onRetry={browse.reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            {data.unit && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex flex-wrap items-center gap-2 font-sans text-[18px] font-bold text-ink">
                  {data.unit.name} <span className="font-sans text-[14px] font-semibold text-muted">{LEVEL_LABELS[data.unit.level]}</span>
                  <DirectoryStatusBadge status={data.unit.status} />
                </p>
                <Button tone="secondary" onClick={() => set({ panel: 'unit', parish: null })}>
                  Details{canManage ? ' and corrections' : ''}
                </Button>
              </div>
            )}
            {data.children.length > 0 && (
              <section aria-labelledby="units-heading" className="flex flex-col gap-3">
                <h2 id="units-heading" className="font-sans text-[18px] font-bold text-ink">
                  {childLevels.length === 1 ? LEVEL_PLURALS[childLevels[0]!] : 'Units'}
                  {data.unit ? ` under ${data.unit.name}` : ''}
                </h2>
                <TableScroll label={data.unit ? `Units under ${data.unit.name}` : 'Continents'}>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <th scope="col" className={th}>
                          Name
                        </th>
                        {childLevels.length > 1 && (
                          <th scope="col" className={th}>
                            Level
                          </th>
                        )}
                        <th scope="col" className={`${th} text-right`}>
                          Active parishes
                        </th>
                        <th scope="col" className={`${th} text-right`}>
                          Units under it
                        </th>
                        <th scope="col" className={th}>
                          Notes
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.children.map((child) => (
                        <tr key={child.id} className="hover:bg-cream/60">
                          <th scope="row" className={`${td} text-left font-semibold`}>
                            <Link to={`?unit=${child.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                              {child.name}
                            </Link>
                            {child.state && <div className="text-[13px] font-normal text-muted">{child.state}</div>}
                          </th>
                          {childLevels.length > 1 && <td className={td}>{LEVEL_LABELS[child.level]}</td>}
                          <td className={`${td} text-right tabular-nums`}>{child.parishes.toLocaleString('en-GB')}</td>
                          <td className={`${td} text-right tabular-nums`}>{child.units}</td>
                          <td className={td}>
                            <span className="flex flex-wrap gap-1">
                              <DirectoryStatusBadge status={child.status} />
                              {child.changed2026 && <Badge tone="warning">Changed in 2026</Badge>}
                              {child.corrected && <Badge>Corrected</Badge>}
                              {child.origin === 'staff' && <Badge>Added by staff</Badge>}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              </section>
            )}
            {data.unit && (
              <section aria-labelledby="parishes-heading" className="flex flex-col gap-3">
                <h2 id="parishes-heading" className="font-sans text-[18px] font-bold text-ink">
                  Parishes directly under {data.unit.name}
                </h2>
                <form
                  role="search"
                  className="flex flex-wrap items-end gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    set({ q: filter.trim() || null, page: null });
                  }}
                >
                  <Input label="Filter by name" value={filter} onChange={(event) => setFilter(event.currentTarget.value)} className="min-w-[200px] flex-1" />
                  <Button type="submit" tone="secondary">
                    Filter
                  </Button>
                  <Checkbox label="Show inactive and merged" checked={show === 'all'} onChange={(event) => set({ show: event.currentTarget.checked ? 'all' : null, page: null })} />
                </form>
                {data.parishes.items.length ? (
                  <>
                    <TableScroll label={`Parishes directly under ${data.unit.name}`}>
                      <table className="w-full border-collapse">
                        <thead>
                          <tr>
                            <th scope="col" className={th}>
                              Parish
                            </th>
                            <th scope="col" className={`${th} text-right`}>
                              Applications
                            </th>
                            <th scope="col" className={th}>
                              Notes
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.parishes.items.map((item) => (
                            <tr key={item.id} className={item.id === parish ? 'bg-rose/30' : 'hover:bg-cream/60'}>
                              <th scope="row" className={`${td} text-left`}>
                                <button
                                  type="button"
                                  aria-current={item.id === parish ? 'true' : undefined}
                                  className="cursor-pointer text-left font-bold text-brand underline-offset-4 hover:underline"
                                  onClick={() => set({ parish: item.id, panel: null })}
                                >
                                  {item.name}
                                </button>
                              </th>
                              <td className={`${td} text-right tabular-nums`}>{item.applications}</td>
                              <td className={td}>
                                <span className="flex flex-wrap gap-1">
                                  <DirectoryStatusBadge status={item.status} />
                                  {item.listedRows > 1 && <Badge tone="warning">Listed {item.listedRows} times</Badge>}
                                  {item.corrected && <Badge>Corrected</Badge>}
                                  {item.origin === 'staff' && <Badge>Added by staff</Badge>}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </TableScroll>
                    <Pagination page={data.parishes.page} pageSize={data.parishes.pageSize} total={data.parishes.total} onPage={(next) => set({ page: String(next) })} />
                  </>
                ) : (
                  <p className="font-sans text-[14px] text-muted">{q ? 'No parishes match.' : `No parishes sit directly under ${data.unit.name}.`}</p>
                )}
              </section>
            )}
          </>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-5">{side}</div>
    </div>
  );
}

const COUNT_LABELS: [string, (counts: Record<string, unknown>) => unknown][] = [
  ['Rows read', (counts) => counts.rows],
  ['Parish entries', (counts) => counts.entries],
  ['Same-name groups', (counts) => (counts.duplicateGroups ? `${counts.duplicateGroups} (${counts.duplicateRows} rows)` : 0)],
  ['No province', (counts) => counts.noProvince],
  ['Provinces without a state', (counts) => counts.provincesWithoutState],
  ['New parishes', (counts) => (counts.parishes as Record<string, number> | undefined)?.create],
  ['Moved', (counts) => (counts.parishes as Record<string, number> | undefined)?.move],
  ['Deactivated', (counts) => (counts.parishes as Record<string, number> | undefined)?.deactivate],
];

function ImportDetailView({ importId }: { importId: string }) {
  const { params, set } = useParamsSetter();
  const code = params.get('code') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const detail = useAsync((signal) => adminApi.directoryImport(importId, { code: code || undefined, page }, signal), [importId, code, page]);
  if (detail.error) return <LoadError error={detail.error} onRetry={detail.reload} />;
  if (!detail.data) return <Loading />;
  const { import: record, codes, issues } = detail.data;
  return (
    <div className="flex flex-col gap-5">
      <Link to="?tab=imports" className="font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline">
        ← All imports
      </Link>
      <Panel title={record.label} description={`Started ${when(record.startedAt)}${record.structureAsAt ? ` · structure as at ${record.structureAsAt}` : ''} · ${record.status}`}>
        <Details rows={COUNT_LABELS.map(([label, read]) => [label, String(read(record.counts) ?? 0)])} />
      </Panel>
      <Panel title="What the import found" description="Directory names only. Same-name groups go back to RCCG to confirm.">
        <nav aria-label="Issue types" className="flex flex-wrap gap-2">
          <Link to={`?tab=imports&import=${importId}`} aria-current={!code ? 'page' : undefined} className="rounded-full border border-line-strong px-3 py-1 font-sans text-[13px] font-bold aria-[current=page]:bg-brand aria-[current=page]:text-white">
            All
          </Link>
          {codes.map((entry) => (
            <Link
              key={`${entry.code}-${entry.severity}`}
              to={`?tab=imports&import=${importId}&code=${entry.code}`}
              aria-current={code === entry.code ? 'page' : undefined}
              className="rounded-full border border-line-strong px-3 py-1 font-sans text-[13px] font-bold aria-[current=page]:bg-brand aria-[current=page]:text-white"
            >
              {entry.code.replace(/_/g, ' ')} ({entry.n})
            </Link>
          ))}
        </nav>
        {issues.items.length ? (
          <>
            <TableScroll label="Issues">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={th}>
                      Row
                    </th>
                    <th scope="col" className={th}>
                      Type
                    </th>
                    <th scope="col" className={th}>
                      What it found
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {issues.items.map((issue, index) => (
                    <tr key={index}>
                      <td className={`${td} tabular-nums`}>{issue.line ?? '—'}</td>
                      <td className={td}>
                        <Badge tone={issue.severity === 'error' ? 'danger' : issue.severity === 'warning' ? 'warning' : 'neutral'}>{issue.code.replace(/_/g, ' ')}</Badge>
                      </td>
                      <td className={td}>{issue.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pagination page={issues.page} pageSize={issues.pageSize} total={issues.total} onPage={(next) => set({ page: String(next) })} />
          </>
        ) : (
          <p className="font-sans text-[14px] text-muted">Nothing to show.</p>
        )}
      </Panel>
    </div>
  );
}

function ImportsTab() {
  const { params, set } = useParamsSetter();
  const importId = params.get('import');
  const page = Math.max(1, Number(params.get('page')) || 1);
  const list = useAsync((signal) => (importId ? Promise.resolve(null) : adminApi.directoryImports(page, signal)), [importId, page]);
  if (importId) return <ImportDetailView importId={importId} />;
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        Imports run on the server with <code className="font-mono text-[13px]">pnpm directory import</code>, a dry run first (docs/DEPLOYMENT.md, “Parish directory”). The RCCG file itself is never
        stored here.
      </Notice>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.items.length === 0 ? (
        <p className="font-sans text-[14px] text-muted">No imports yet.</p>
      ) : (
        <>
          <TableScroll label="Imports">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Started (WAT)
                  </th>
                  <th scope="col" className={th}>
                    Source
                  </th>
                  <th scope="col" className={th}>
                    Status
                  </th>
                  <th scope="col" className={`${th} text-right`}>
                    Entries
                  </th>
                  <th scope="col" className={th}>
                    Found
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((item) => (
                  <tr key={item.id}>
                    <td className={`${td} whitespace-nowrap`}>{when(item.startedAt)}</td>
                    <td className={td}>
                      <Link to={`?tab=imports&import=${item.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                        {item.label}
                      </Link>
                      <div className="text-[13px] text-muted">
                        {item.source === 'api' ? 'RCCG API' : 'Spreadsheet'}
                        {item.structureAsAt ? ` · as at ${item.structureAsAt}` : ''} · {item.via === 'cli' ? 'command line' : item.via}
                        {item.by ? ` · ${item.by}` : ''}
                      </div>
                    </td>
                    <td className={td}>
                      <Badge tone={item.status === 'applied' ? 'success' : item.status === 'failed' ? 'danger' : 'neutral'}>{item.status}</Badge>
                      {item.error && <div className="text-[13px] text-muted">{item.error}</div>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{String(item.counts.entries ?? '—')}</td>
                    <td className={td}>
                      {plural(item.issues.error, 'error')} · {plural(item.issues.warning, 'warning')} · {plural(item.issues.info, 'note')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(next) => set({ page: String(next) })} />
        </>
      )}
    </div>
  );
}

function ChangesTab() {
  const lineage = useAsync((signal) => adminApi.directoryLineage(signal), []);
  return (
    <div className="flex flex-col gap-4">
      <Notice>
        RCCG’s August 2026 changes: new regions and provinces, and the units they were created from. Until RCCG’s updated list is imported, parishes stay under the older units, and Reports marks the units
        involved.
      </Notice>
      {lineage.error ? (
        <LoadError error={lineage.error} onRetry={lineage.reload} />
      ) : !lineage.data ? (
        <Loading />
      ) : lineage.data.items.length === 0 ? (
        <p className="font-sans text-[14px] text-muted">
          No 2026 changes recorded yet. They’re loaded with <code className="font-mono text-[13px]">pnpm directory lineage</code> (docs/DEPLOYMENT.md).
        </p>
      ) : (
        <TableScroll label="2026 changes">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={th}>
                  New unit
                </th>
                <th scope="col" className={th}>
                  In the directory
                </th>
                <th scope="col" className={th}>
                  Created from
                </th>
              </tr>
            </thead>
            <tbody>
              {lineage.data.items.map((item) => (
                <tr key={`${item.level}-${item.name}`}>
                  <th scope="row" className={`${td} text-left font-semibold`}>
                    {item.name}
                    <div className="text-[13px] font-normal text-muted">
                      {LEVEL_LABELS[item.level]}
                      {item.approvedOn ? ` · approved ${item.approvedOn}` : ''}
                    </div>
                  </th>
                  <td className={td}>
                    {item.unit ? (
                      <Link to={`?unit=${item.unit.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                        Yes
                      </Link>
                    ) : (
                      <Badge tone="warning">Waiting for updated data</Badge>
                    )}
                  </td>
                  <td className={td}>
                    <ul className="flex flex-col gap-1">
                      {item.sources.map((source) => (
                        <li key={source.name}>
                          {source.unit ? (
                            <Link to={`?unit=${source.unit.id}`} className="text-brand underline-offset-4 hover:underline">
                              {source.name}
                            </Link>
                          ) : (
                            source.name
                          )}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </div>
  );
}

/** Browse and correct the parish directory; its imports; the 2026 changes waiting for data. */
export default function DirectoryPage() {
  const [params] = useSearchParams();
  const tab: Tab = TABS.some((entry) => entry.tab === params.get('tab')) ? (params.get('tab') as Tab) : 'tree';
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Parish directory"
        documentTitle="Parish directory · Admin"
        description="The RCCG parish list as applicants search it: continents, regions, provinces and parishes. Corrections made here are kept when a new list is imported, and recorded in each entry’s history."
      />
      <nav aria-label="Directory sections" className="flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <Link
            key={entry.tab}
            to={entry.tab === 'tree' ? '?' : `?tab=${entry.tab}`}
            aria-current={entry.tab === tab ? 'page' : undefined}
            className="inline-flex min-h-[44px] items-center rounded-full border border-line-strong bg-white px-4 font-sans text-[14px] font-bold text-ink hover:border-brand aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-white"
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {tab === 'tree' ? <TreeTab /> : tab === 'imports' ? <ImportsTab /> : <ChangesTab />}
    </>
  );
}
