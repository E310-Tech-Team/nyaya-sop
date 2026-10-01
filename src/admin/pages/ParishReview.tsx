import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Checkbox, Input, LoadError, Loading, Notice, PageHeader, Pagination, Panel, TableScroll, errorMessage, td, th, when } from '../../components/ui';
import { chainLine, chainRows, placeContext, placeLabel } from '../../lib/parish';
import { useAsync } from '../../lib/useAsync';
import type { ParishChain } from '../../shared/directory';
import { adminApi, type LookalikeCandidate, type ReviewItem, type ReviewKind, type UnitMatch } from '../api';
import { ChainLine, LEVEL_LABELS, ParishFinder, UnitFinder } from '../directory-parts';

const KINDS: { kind: ReviewKind; label: string }[] = [
  { kind: 'not_listed', label: 'Parish not listed' },
  { kind: 'details_wrong', label: 'Details look wrong' },
  { kind: 'lookalike', label: 'Which parish?' },
  { kind: 'earlier_text', label: 'Earlier typed answers' },
];

/** Runs a review action, then shows what happened and reloads the list. */
type Act = (action: () => Promise<unknown>, success: string) => Promise<boolean>;

function Chain({ chain }: { chain: ParishChain }) {
  return (
    <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 font-sans text-[14px]">
      {chainRows(chain).map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold text-muted">{label}</dt>
          <dd className="text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Suggested parishes as one-click links, then a search for anything else. */
function LinkChoices({ item, act, initialQuery }: { item: ReviewItem; act: Act; initialQuery: string }) {
  const link = (parishId: string, name: string) =>
    act(
      () => (item.kind === 'earlier_text' ? adminApi.linkEarlierAnswer(item.id, parishId) : adminApi.resolveReport(item.id, { action: 'link', parishId })),
      `${item.application.fullName}’s application is now linked to ${name}.`,
    );
  const suggestions = item.suggestions.filter((suggestion) => suggestion.id !== item.parish?.id);
  return (
    <div className="flex flex-col gap-3">
      {suggestions.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-sans text-[13px] font-bold uppercase tracking-[0.06em] text-muted">Suggested</p>
          <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 font-sans text-[14px] leading-[1.45]">
                  <strong>{suggestion.name}</strong>
                  {item.exactMatch === suggestion.id && (
                    <>
                      {' '}
                      <Badge tone="success">Only exact match in {item.application.state}</Badge>
                    </>
                  )}
                  <br />
                  <ChainLine chain={suggestion.chain} />
                </div>
                <Button tone="secondary" className="min-h-[36px] px-4 text-[13px]" onClick={() => void link(suggestion.id, suggestion.name)}>
                  Link<span className="sr-only">: {`${suggestion.name}, ${chainLine(suggestion.chain)}`}</span>
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <details className="rounded-[10px] border border-line px-3 py-2">
        <summary className="cursor-pointer font-sans text-[14px] font-bold text-brand">Search the directory</summary>
        <div className="pt-3">
          <ParishFinder label="Parish name" hint="Add a province or region word to narrow it, e.g. “Jesus House Lagos 3”." initialQuery={initialQuery} action="Link" onChoose={(parish) => link(parish.id, parish.name)} />
        </div>
      </details>
    </div>
  );
}

/**
 * "I can't find my parish": add it to the directory in the right unit, and link the application.
 * Starts in the province the applicant chose, when they chose one (D-59).
 */
function AddParish({ item, act }: { item: ReviewItem; act: Act }) {
  const [name, setName] = useState(item.name ?? '');
  const [unit, setUnit] = useState<UnitMatch | null>(item.place ? { ...item.place, parent: null } : null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!unit) return;
    void act(() => adminApi.resolveReport(item.id, { action: 'add', unitId: unit.id, name: name.trim() }), `${name.trim()} was added to ${unit.name} and linked.`);
  };
  return (
    <details className="rounded-[10px] border border-line px-3 py-2">
      <summary className="cursor-pointer font-sans text-[14px] font-bold text-brand">Add it to the directory</summary>
      <div className="flex flex-col gap-3 pt-3">
        <p className="font-sans text-[14px] text-muted">Only for a parish you’ve confirmed exists. Later imports keep parishes staff add.</p>
        {unit ? (
          <p className="flex flex-wrap items-center gap-2 font-sans text-[14px]">
            In: <strong>{unit.name}</strong> <span className="text-muted">({LEVEL_LABELS[unit.level]})</span>
            <Button tone="ghost" className="min-h-[36px] px-3 text-[13px]" onClick={() => setUnit(null)}>
              Change
            </Button>
          </p>
        ) : (
          <UnitFinder label="Its province (or region, if it has no province)" action="Choose" onChoose={(match) => setUnit(match)} />
        )}
        <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Input label="Parish name" value={name} onChange={(event) => setName(event.currentTarget.value)} className="min-w-[220px] flex-1" />
          <Button type="submit" disabled={!unit || name.trim().length < 2}>
            Add and link
          </Button>
        </form>
      </div>
    </details>
  );
}

function ReviewCard({ item, act }: { item: ReviewItem; act: Act }) {
  const who = (
    <p className="font-sans text-[14px] text-muted">
      <Link to={`/admin/applicants/${item.application.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
        {item.application.fullName}
      </Link>{' '}
      · {item.application.reference} · {item.application.cohort} · lives in {item.application.state} · {when(item.createdAt)}
    </p>
  );
  let body: ReactNode;
  if (item.kind === 'lookalike' && item.parish) {
    const candidates = item.candidates ?? [];
    const link = (candidate: LookalikeCandidate) =>
      act(
        () => adminApi.resolveReport(item.id, { action: 'link', parishId: candidate.id }),
        `${item.application.fullName}’s application is linked to ${candidate.name}${candidate.code ? ` (${candidate.code})` : ''}.`,
      );
    body = (
      <>
        <p className="font-sans text-[15px] text-ink">
          They chose <strong>{item.parish.name}</strong> ({chainLine(item.parish.chain)}). The RCCG list has {candidates.length} parishes with this
          name here and nothing to tell them apart, so the form offered them as one. Which is theirs?
        </p>
        <ul className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0 flex-1 font-sans text-[14px] leading-[1.45]">
                <strong>{candidate.name}</strong>
                {candidate.linked && (
                  <>
                    {' '}
                    <Badge>Linked now</Badge>
                  </>
                )}
                <br />
                <span className="text-muted">
                  RCCG code {candidate.code ?? 'not recorded'} · {candidate.applications} {candidate.applications === 1 ? 'application' : 'applications'}
                </span>
              </div>
              <Button tone="secondary" className="min-h-[36px] px-4 text-[13px]" onClick={() => void link(candidate)}>
                {candidate.linked ? 'Keep this one' : 'Link this one'}
                <span className="sr-only">: {`${candidate.name}, RCCG code ${candidate.code ?? 'not recorded'}`}</span>
              </Button>
            </li>
          ))}
        </ul>
        <p className="font-sans text-[13px] leading-[1.5] text-muted">
          If you can’t tell, ask the applicant or the registry team. Until then the application counts under the first of these, so its province, region
          and continent are already right.
        </p>
        <details className="rounded-[10px] border border-line px-3 py-2">
          <summary className="cursor-pointer font-sans text-[14px] font-bold text-brand">It’s a different parish: link another</summary>
          <div className="pt-3">
            <LinkChoices item={item} act={act} initialQuery={item.parish.name} />
          </div>
        </details>
      </>
    );
  } else if (item.kind === 'details_wrong' && item.parish) {
    const unitId = item.parish.chain.province?.id ?? item.parish.chain.region?.id ?? item.parish.chain.continent?.id ?? '';
    body = (
      <>
        <p className="font-sans text-[15px] text-ink">
          They chose <strong>{item.parish.name}</strong> and said its details look wrong.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-[10px] bg-cream px-3 py-2">
            <p className="font-sans text-[13px] font-bold text-muted">As they confirmed it</p>
            {item.submitted ? <Chain chain={item.submitted} /> : <p className="font-sans text-[14px] text-muted">Not recorded</p>}
          </div>
          <div className="flex flex-col gap-2 rounded-[10px] bg-cream px-3 py-2">
            <p className="font-sans text-[13px] font-bold text-muted">In the directory now</p>
            <Chain chain={item.parish.chain} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/admin/directory?unit=${unitId}&parish=${item.parish.id}`}
            className="inline-flex min-h-[44px] items-center rounded-full border border-line-strong bg-white px-5 font-sans text-[14px] font-bold text-ink hover:border-brand hover:text-brand"
          >
            Correct it in the directory
          </Link>
          <Button tone="secondary" onClick={() => void act(() => adminApi.resolveReport(item.id, { action: 'fixed' }), 'Marked fixed.')}>
            Mark fixed
          </Button>
          <Button tone="ghost" onClick={() => void act(() => adminApi.resolveReport(item.id, { action: 'reject' }), 'Closed: the details are right.')}>
            The details are right
          </Button>
        </div>
        <details className="rounded-[10px] border border-line px-3 py-2">
          <summary className="cursor-pointer font-sans text-[14px] font-bold text-brand">They chose the wrong parish: link another</summary>
          <div className="pt-3">
            <LinkChoices item={item} act={act} initialQuery={item.parish.name} />
          </div>
        </details>
      </>
    );
  } else {
    body = (
      <>
        <p className="font-sans text-[15px] text-ink">
          {item.kind === 'earlier_text' ? (
            'Typed on the earlier form:'
          ) : item.place ? (
            // D-59: the province they chose first, as the directory named it then.
            <>
              They chose <strong>{placeLabel(item.place)}</strong>
              {item.submitted && placeContext({ level: item.place.level, chain: item.submitted }) && ` (${placeContext({ level: item.place.level, chain: item.submitted })})`},
              couldn’t find their parish there and typed:
            </>
          ) : (
            'They couldn’t find their parish and typed:'
          )}{' '}
          <strong>{item.name}</strong>
        </p>
        <LinkChoices item={item} act={act} initialQuery={item.name ?? ''} />
        {item.kind === 'not_listed' && <AddParish item={item} act={act} />}
        <div>
          {item.kind === 'earlier_text' ? (
            <Button tone="ghost" onClick={() => void act(() => adminApi.dismissEarlierAnswer(item.id), 'Set aside: no matching parish.')}>
              No matching parish
            </Button>
          ) : (
            <Button tone="ghost" onClick={() => void act(() => adminApi.resolveReport(item.id, { action: 'reject' }), 'Closed without a parish: the application keeps the name they typed.')}>
              Close without a parish
            </Button>
          )}
        </div>
      </>
    );
  }
  return (
    <li>
      <Panel title={item.kind === 'details_wrong' || item.kind === 'lookalike' ? item.parish?.name : (item.name ?? 'No name')} headingLevel={3}>
        {who}
        {body}
      </Panel>
    </li>
  );
}

/** Earlier answers matching exactly one parish in the applicant's state: tick and link together. */
function ExactMatches({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const matches = useAsync((signal) => (open ? adminApi.earlierMatches(signal) : Promise.resolve(null)), [open]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const items = matches.data?.items ?? [];
  const chosen = items.filter((item) => !unticked.has(item.application.id));

  const confirm = async () => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await adminApi.confirmEarlierMatches(chosen.map((item) => ({ applicationId: item.application.id, parishId: item.parish.id })));
      setResult({
        tone: 'success',
        text: `Linked ${outcome.linked}.${outcome.skipped ? ` ${outcome.skipped} had changed since and were left for you to check.` : ''}`,
      });
      setUnticked(new Set());
      matches.reload();
      onDone();
    } catch (caught) {
      setResult({ tone: 'error', text: errorMessage(caught) });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Panel title="Exact matches" description="Earlier answers that match exactly one parish in the applicant’s state can be linked together, after you check them.">
        <div>
          <Button tone="secondary" onClick={() => setOpen(true)}>
            Find exact matches
          </Button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Exact matches" description="Each answer below matches exactly one parish in the applicant’s state. Untick any that look wrong, then link the rest.">
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      {matches.error ? (
        <LoadError error={matches.error} onRetry={matches.reload} />
      ) : !matches.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="font-sans text-[14px] text-muted">No earlier answers match exactly one parish.</p>
      ) : (
        <>
          {matches.data.total > items.length && (
            <p className="font-sans text-[14px] text-muted">
              Showing the first {items.length} of {matches.data.total}.
            </p>
          )}
          <TableScroll label="Exact matches">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={th}>
                    Link
                  </th>
                  <th scope="col" className={th}>
                    Applicant
                  </th>
                  <th scope="col" className={th}>
                    They typed
                  </th>
                  <th scope="col" className={th}>
                    Parish
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.application.id}>
                    <td className={td}>
                      <Checkbox
                        label={<span className="sr-only">Link {item.application.fullName}’s answer</span>}
                        checked={!unticked.has(item.application.id)}
                        onChange={(event) => {
                          const next = new Set(unticked);
                          if (event.currentTarget.checked) next.delete(item.application.id);
                          else next.add(item.application.id);
                          setUnticked(next);
                        }}
                      />
                    </td>
                    <td className={td}>
                      {item.application.fullName}
                      <div className="text-[13px] text-muted">
                        {item.application.reference} · {item.application.state}
                      </div>
                    </td>
                    <td className={td}>{item.name}</td>
                    <td className={td}>
                      {item.parish.name}
                      {item.parish.place && <div className="text-[13px] text-muted">{item.parish.place}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <div>
            <Button busy={busy} disabled={!chosen.length} onClick={() => void confirm()}>
              Link {chosen.length} {chosen.length === 1 ? 'application' : 'applications'}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

/** Parishes applicants couldn't find, details they flagged, look-alike choices, and answers typed before the directory. */
export default function ParishReviewPage() {
  const [params, setParams] = useSearchParams();
  const kind = (KINDS.some((entry) => entry.kind === params.get('kind')) ? params.get('kind') : 'not_listed') as ReviewKind;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const queue = useAsync((signal) => adminApi.parishReview(kind, page, signal), [kind, page]);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const act: Act = async (action, success) => {
    setMessage(null);
    try {
      await action();
      setMessage({ tone: 'success', text: success });
      queue.reload();
      return true;
    } catch (caught) {
      setMessage({ tone: 'error', text: errorMessage(caught) });
      return false;
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Parish review"
        documentTitle="Parish review · Admin"
        description="Parishes applicants couldn’t find, details they said look wrong, same-named parishes to tell apart, and answers typed before the parish directory. Link each application to the right parish, add a missing parish, or correct the directory."
      />
      <nav aria-label="Review lists" className="flex flex-wrap gap-2">
        {KINDS.map((entry) => (
          <Link
            key={entry.kind}
            to={`?kind=${entry.kind}`}
            aria-current={entry.kind === kind ? 'page' : undefined}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-line-strong bg-white px-4 font-sans text-[14px] font-bold text-ink hover:border-brand aria-[current=page]:border-brand aria-[current=page]:bg-brand aria-[current=page]:text-white"
          >
            {entry.label}
            {queue.data && <span className="tabular-nums">({queue.data.counts[entry.kind]})</span>}
          </Link>
        ))}
      </nav>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {kind === 'earlier_text' && <ExactMatches onDone={queue.reload} />}
      {queue.error ? (
        <LoadError error={queue.error} onRetry={queue.reload} />
      ) : !queue.data ? (
        <Loading />
      ) : queue.data.items.length === 0 ? (
        <Notice>Nothing waiting here.</Notice>
      ) : (
        <>
          <ol className="flex flex-col gap-4">
            {queue.data.items.map((item) => (
              <ReviewCard key={item.id} item={item} act={act} />
            ))}
          </ol>
          <Pagination
            page={queue.data.page}
            pageSize={queue.data.pageSize}
            total={queue.data.total}
            onPage={(next) => {
              const search = new URLSearchParams(params);
              search.set('page', String(next));
              setParams(search);
            }}
          />
        </>
      )}
    </>
  );
}
