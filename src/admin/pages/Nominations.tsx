import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge, Button, Input, LoadError, Loading, PageHeader, Pagination, Panel, Select, when } from '../../components/ui';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { useAsync } from '../../lib/useAsync';
import { labelFor } from '../../shared/application';
import { MENTOR_AGE_RANGES, RCCG_STATUSES } from '../../shared/mentor-nomination';
import { adminApi, type NominationRow } from '../api';
import { ConfirmByTyping } from '../parts';
import { useCan } from '../session';

const PAGE_SIZE = 24;
const linkClass = 'font-bold text-brand underline-offset-4 hover:underline';

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[180px_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-sans text-[13px] font-semibold text-muted">{label}</dt>
          <dd className="break-words font-sans text-[15px] text-ink">{value || <span className="text-muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A web address becomes a link (opened apart from the admin area); anything else stays text. */
function SocialProfile({ value }: { value: string | null }) {
  if (!value) return null;
  let url: URL | null = null;
  try {
    url = new URL(value);
  } catch {
    url = null;
  }
  if (url && (url.protocol === 'https:' || url.protocol === 'http:')) {
    return (
      <a href={url.href} target="_blank" rel="noopener noreferrer nofollow" className={`${linkClass} break-all`}>
        {value}
      </a>
    );
  }
  return <>{value}</>;
}

function NominationCard({ row }: { row: NominationRow }) {
  return (
    <Card as="li" className="gap-3">
      <CardHeader>
        <CardTitle as="h2">
          <Link to={`/admin/nominations/${row.id}`} className={linkClass}>
            {row.nomineeName}
          </Link>
        </CardTitle>
        <CardDescription>
          {row.jobRole} · {row.regionLocation}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge>{labelFor(MENTOR_AGE_RANGES, row.ageRange)}</Badge>
          <Badge tone={row.rccgStatus === 'rccg_member' ? 'brand' : 'neutral'}>{labelFor(RCCG_STATUSES, row.rccgStatus)}</Badge>
        </div>
        <p className="font-sans text-[14px] leading-[1.5] text-ink [overflow-wrap:anywhere]">
          <span className="font-semibold text-muted">Pillar fit: </span>
          {row.pillarFit}
        </p>
      </CardContent>
      <CardFooter className="font-sans text-[13px] text-muted">
        Nominated by {row.nominatorName}, {when(row.submittedAt)}
      </CardFooter>
    </Card>
  );
}

/** Mentor nominations from the public form, newest first, as cards (docs/03, 06 20.4). */
export default function NominationsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const age = params.get('age') ?? '';
  const rccg = params.get('rccg') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const canExport = useCan('nominations.export');
  const list = useAsync((signal) => adminApi.nominations({ q, age, rccg, page, pageSize: PAGE_SIZE }, signal), [q, age, rccg, page]);
  const filtered = Boolean(q || age || rccg);
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const data = list.data;
  const summary = !data
    ? ''
    : data.all === 0
      ? 'No nominations yet.'
      : filtered
        ? `${data.total} of ${data.all} ${data.all === 1 ? 'nomination matches' : 'nominations match'}.`
        : `${data.all} ${data.all === 1 ? 'nomination' : 'nominations'}.`;
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Mentor nominations"
        documentTitle="Mentor nominations · Admin"
        description="People nominated as mentors through the mentor nomination form, newest first."
        actions={
          canExport ? (
            <a
              href={adminApi.nominationsExportUrl({ q: q || undefined, age: age || undefined, rccg: rccg || undefined })}
              className="inline-flex min-h-[44px] items-center rounded-full border border-line-strong bg-white px-5 font-sans text-[14px] font-bold text-ink hover:border-brand hover:text-brand"
            >
              Download CSV{filtered ? ' (filtered)' : ''}
            </a>
          ) : undefined
        }
      />
      {canExport && <p className="-mt-3 font-sans text-[13px] text-muted">Downloads contain nominees’ contact details and are recorded in the audit history.</p>}

      <section aria-label="Search and filters" className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-white p-4">
        <form
          role="search"
          className="flex min-w-[min(100%,320px)] flex-1 flex-wrap items-end gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            set({ q: search.trim() });
          }}
        >
          <Input
            label="Search"
            hint="Nominee, email, location, role, pillar or who nominated them"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            className="min-w-[220px] flex-1"
          />
          <Button type="submit">Search</Button>
        </form>
        <Select label="Age range" value={age} onChange={(event) => set({ age: event.currentTarget.value })} options={[{ value: '', label: 'All' }, ...MENTOR_AGE_RANGES]} />
        <Select label="RCCG status" value={rccg} onChange={(event) => set({ rccg: event.currentTarget.value })} options={[{ value: '', label: 'All' }, ...RCCG_STATUSES]} />
      </section>

      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <p role="status" className="font-sans text-[14px] text-muted">
            {summary}
          </p>
          {data.items.length > 0 ? (
            <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Nominations">
              {data.items.map((row) => (
                <NominationCard key={row.id} row={row} />
              ))}
            </ul>
          ) : (
            <Card className="items-start px-5 sm:px-6">
              <p className="font-sans text-[15px] text-ink">
                {data.all === 0 ? 'Nominations sent through the mentor nomination form will appear here.' : 'No nominations match these filters.'}
              </p>
              {filtered && (
                <Button tone="secondary" onClick={() => setParams(new URLSearchParams())}>
                  Clear the filters
                </Button>
              )}
            </Card>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(next) => set({ page: String(next) })} />
        </>
      )}
    </>
  );
}

/** One nomination in full; opening it is recorded in the audit history. */
export function NominationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canManage = useCan('nominations.manage');
  const { data, error, reload } = useAsync((signal) => adminApi.nomination(id, signal), [id]);
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <Link to="/admin/nominations" className="font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline">
        ← Mentor nominations
      </Link>
      <PageHeader
        eyebrow="Mentor nomination"
        title={data.nomineeName}
        documentTitle={`${data.nomineeName} · Mentor nominations · Admin`}
        description={`Nominated by ${data.nominatorName}, ${when(data.submittedAt)}.`}
      />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Panel title="The nominee">
          <Details
            rows={[
              [
                'Email',
                <a key="email" href={`mailto:${data.nomineeEmail}`} className={`${linkClass} break-all`}>
                  {data.nomineeEmail}
                </a>,
              ],
              [
                'Phone',
                <a key="phone" href={`tel:${data.nomineePhoneE164}`} className={linkClass}>
                  {data.nomineePhone}
                </a>,
              ],
              ['Age range', labelFor(MENTOR_AGE_RANGES, data.ageRange)],
              ['Job role / profession', data.jobRole],
              ['Region / base / location', data.regionLocation],
              ['RCCG status', labelFor(RCCG_STATUSES, data.rccgStatus)],
              ['Social media profile', <SocialProfile key="social" value={data.socialProfile} />],
            ]}
          />
        </Panel>
        <Panel title="Mentoring fit">
          <Details
            rows={[
              ['Pillar fit', data.pillarFit],
              ['Experience', data.experience],
              ['Why they’re a good fit', data.whyFit],
              ['Testimonial', data.testimonial],
            ]}
          />
        </Panel>
      </div>
      {canManage && (
        <Panel title="Delete this nomination">
          <ConfirmByTyping
            expected={data.nomineeEmail}
            label={`Type ${data.nomineeEmail} to confirm`}
            action="Delete nomination"
            explanation="Only for a request to remove these details, for example from the nominee. The nomination is deleted for good; the audit history records that it was deleted, not what it said."
            onConfirm={async (typed) => {
              await adminApi.deleteNomination(data.id, typed);
              navigate('/admin/nominations', { replace: true });
            }}
          />
        </Panel>
      )}
    </>
  );
}
