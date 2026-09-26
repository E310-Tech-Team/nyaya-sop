import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Badge, Button, Input, LoadError, Loading, PageHeader, Pagination, Select, TableScroll, td, th, when } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { APPLICATION_STATUSES, PUBLISHED_STATUS_LABELS, REVIEW_STATUS_LABELS } from '../../shared/platform';
import { adminApi } from '../api';
import { PublishedBadge, ReviewBadge } from '../parts';
import { useCan } from '../session';

const FILTER_KEYS = ['q', 'cohort', 'status', 'published', 'reviewer', 'claimed', 'sort'] as const;
const PAGE_SIZE = 25;

export default function ApplicantsPage() {
  const [params, setParams] = useSearchParams();
  const canViewAll = useCan('applications.view_all');
  const canExport = useCan('applications.export');
  const canAssign = useCan('applications.assign');
  const filters = Object.fromEntries(FILTER_KEYS.map((key) => [key, params.get(key) ?? ''])) as Record<(typeof FILTER_KEYS)[number], string>;
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(filters.q);
  useEffect(() => setSearch(filters.q), [filters.q]);
  const [filtersOpen, setFiltersOpen] = useState(false); // phones and tablets: filters fold away

  const list = useAsync((signal) => adminApi.applicants({ ...filters, page, pageSize: PAGE_SIZE }, signal), [params.toString()]);
  const cohorts = useAsync((signal) => adminApi.cohorts(signal), []);
  const reviewers = useAsync((signal) => (canAssign ? adminApi.reviewers(signal) : Promise.resolve({ items: [] })), [canAssign]);

  const update = (changes: Partial<Record<string, string>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    update({ q: search.trim() });
  };
  const activeFilters = FILTER_KEYS.filter((key) => key !== 'sort' && filters[key]).length;
  const foldedFilters = FILTER_KEYS.filter((key) => key !== 'sort' && key !== 'q' && filters[key]).length;

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Applicants"
        documentTitle="Applicants · Admin"
        description={canViewAll ? 'Every application, newest first. Search and filters run on the server.' : 'Applications assigned to you.'}
        actions={
          canExport ? (
            <a
              href={adminApi.exportUrl({ ...filters, sort: undefined })}
              className="inline-flex min-h-[44px] items-center rounded-full border border-line-strong bg-white px-5 font-sans text-[14px] font-bold text-ink hover:border-brand hover:text-brand"
            >
              Download CSV{activeFilters ? ' (filtered)' : ''}
            </a>
          ) : undefined
        }
      />
      {canExport && <p className="-mt-3 font-sans text-[13px] text-muted">Downloads contain personal data and are recorded in the audit history.</p>}

      <section aria-label="Search and filters" className="flex flex-col gap-4 rounded-[14px] border border-line bg-white p-4">
        <form role="search" onSubmit={submitSearch} className="flex flex-wrap items-end gap-3">
          <Input
            label="Search"
            hint="Name, email, town, parish or reference (SOP-…)"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            className="min-w-[240px] flex-1"
          />
          <Button type="submit">Search</Button>
        </form>
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls="applicant-filters"
          onClick={() => setFiltersOpen((open) => !open)}
          className="min-h-[44px] self-start rounded-full border border-line-strong px-4 font-sans text-[14px] font-bold text-ink lg:hidden"
        >
          {filtersOpen ? 'Hide filters' : `Filters${foldedFilters ? ` (${foldedFilters} on)` : ''}`}
        </button>
        <div id="applicant-filters" className={`${filtersOpen ? 'grid' : 'hidden'} gap-3 sm:grid-cols-2 lg:grid lg:grid-cols-4`}>
          <Select
            label="Cohort"
            value={filters.cohort}
            onChange={(event) => update({ cohort: event.currentTarget.value })}
            options={[{ value: '', label: 'All cohorts' }, ...(cohorts.data?.items ?? []).map((cohort) => ({ value: cohort.id, label: cohort.name }))]}
          />
          <Select
            label="Review status"
            value={filters.status}
            onChange={(event) => update({ status: event.currentTarget.value })}
            options={[{ value: '', label: 'Any' }, ...APPLICATION_STATUSES.map((status) => ({ value: status, label: REVIEW_STATUS_LABELS[status] }))]}
          />
          <Select
            label="Published to applicant"
            value={filters.published}
            onChange={(event) => update({ published: event.currentTarget.value })}
            options={[{ value: '', label: 'Any' }, ...APPLICATION_STATUSES.map((status) => ({ value: status, label: PUBLISHED_STATUS_LABELS[status].label }))]}
          />
          {canViewAll && (
            <Select
              label="Reviewer"
              value={filters.reviewer}
              onChange={(event) => update({ reviewer: event.currentTarget.value })}
              options={[
                { value: '', label: 'Anyone' },
                { value: 'me', label: 'Assigned to me' },
                { value: 'unassigned', label: 'Not assigned' },
                ...(reviewers.data?.items ?? []).map((reviewer) => ({ value: reviewer.id, label: reviewer.name })),
              ]}
            />
          )}
          <Select
            label="Account"
            value={filters.claimed}
            onChange={(event) => update({ claimed: event.currentTarget.value })}
            options={[
              { value: '', label: 'Any' },
              { value: 'yes', label: 'Linked to an account' },
              { value: 'no', label: 'No account' },
            ]}
          />
          <Select
            label="Sort"
            value={filters.sort || 'newest'}
            onChange={(event) => update({ sort: event.currentTarget.value === 'newest' ? '' : event.currentTarget.value })}
            options={[
              { value: 'newest', label: 'Newest first' },
              { value: 'oldest', label: 'Oldest first' },
              { value: 'name', label: 'Name (A–Z)' },
              { value: 'status', label: 'Review status' },
            ]}
          />
        </div>
        {activeFilters > 0 && (
          <div>
            <Button tone="ghost" onClick={() => setParams(new URLSearchParams())}>
              Clear filters
            </Button>
          </div>
        )}
      </section>

      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <>
          <TableScroll label="Applications">
            <table className="w-full border-collapse">
              <caption className="sr-only">Applications, {list.data.total} in total</caption>
              <thead>
                <tr>
                  <th scope="col" className={th}>Applicant</th>
                  <th scope="col" className={th}>Location</th>
                  <th scope="col" className={th}>Cohort</th>
                  <th scope="col" className={th}>Submitted (WAT)</th>
                  <th scope="col" className={th}>Review status</th>
                  <th scope="col" className={th}>Published</th>
                  <th scope="col" className={th}>Reviewer</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.id} className="hover:bg-cream/60">
                    <td className={td}>
                      <Link to={`/admin/applicants/${row.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                        {row.fullName}
                      </Link>
                      <div className="text-[13px] text-muted">
                        {row.reference} · {row.email}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.claimed && <Badge>Account</Badge>}
                        {row.notes > 0 && <Badge>{row.notes === 1 ? '1 note' : `${row.notes} notes`}</Badge>}
                      </div>
                    </td>
                    <td className={td}>{row.location}</td>
                    <td className={td}>{row.cohortName}</td>
                    <td className={`${td} whitespace-nowrap`}>{when(row.submittedAt)}</td>
                    <td className={td}>
                      <ReviewBadge status={row.status} />
                    </td>
                    <td className={td}>
                      <PublishedBadge status={row.publishedStatus} />
                    </td>
                    <td className={td}>{row.reviewer?.name ?? <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
                {list.data.items.length === 0 && (
                  <tr>
                    <td className={td} colSpan={7}>
                      No applications match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(next) => update({ page: String(next) })} />
        </>
      )}
    </>
  );
}
