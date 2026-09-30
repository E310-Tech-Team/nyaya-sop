/**
 * The region, province and parish report as a table (TanStack Table): the same places side by
 * side for comparing status by status. Sorting happens on the server (the listing is paged), so
 * the headers only change the sort in the URL; roles that see small counts as "fewer than 5" can
 * sort by name and applications only, since other orders would give those counts away.
 */
import { createColumnHelper, rowSortingFeature, tableFeatures, useTable, type SortingState } from '@tanstack/react-table';
import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { APPLICATION_STATUSES, REVIEW_STATUS_LABELS } from '../../shared/platform';
import type { ReportCard, ReportListing, ReportSort } from '../api';
import { formatCount } from './model';
import { describePlace, listed } from './places';

const features = tableFeatures({ rowSortingFeature });
const helper = createColumnHelper<typeof features, ReportCard>();

type Props = {
  data: ReportListing;
  drillHref: (card: ReportCard) => string | null;
  applicantsFor: (card: ReportCard) => string | null;
  onSort: (sort: ReportSort, dir: 'asc' | 'desc') => void;
};

export default function PlaceTable({ data, drillHref, applicantsFor, onSort }: Props) {
  const units = data.mode !== 'parishes';
  const exact = !data.masked;
  const { title, one } = listed(data);

  const columns = useMemo(
    () =>
      helper.columns([
        helper.accessor('name', {
          header: 'Name',
          cell: ({ row }) => {
            const card = row.original;
            const drill = drillHref(card);
            return (
              <>
                {drill ? (
                  <Link to={drill} className="font-bold text-brand underline-offset-4 hover:underline">
                    {card.name}
                  </Link>
                ) : (
                  <span className="font-bold">{card.name}</span>
                )}
                <span className="block text-[13px] font-normal text-muted">{describePlace(card)}</span>
              </>
            );
          },
        }),
        helper.accessor((card) => card.applications, {
          id: 'applications',
          header: 'Applications',
          sortDescFirst: true,
          cell: ({ row }) => {
            const card = row.original;
            const href = applicantsFor(card);
            const count = formatCount(card.applications);
            return href ? (
              <Link to={href} aria-label={`View ${count} ${card.applications === 1 ? 'application' : 'applications'}: ${card.name}`} className="font-bold text-brand underline underline-offset-4">
                {count}
              </Link>
            ) : (
              <span className="font-bold">{count}</span>
            );
          },
        }),
        ...APPLICATION_STATUSES.map((status) =>
          helper.accessor((card) => card.byStatus[status], {
            id: status,
            header: REVIEW_STATUS_LABELS[status],
            sortDescFirst: true,
            enableSorting: exact,
            cell: ({ getValue }) => formatCount(getValue()),
          }),
        ),
        ...(units
          ? [
              helper.accessor((card) => card.parishesWithApplications, {
                id: 'parishes',
                header: 'Parishes with applications',
                sortDescFirst: true,
                enableSorting: exact,
                cell: ({ row }) => (row.original.activeParishes !== null ? `${formatCount(row.original.parishesWithApplications)} of ${row.original.activeParishes}` : '—'),
              }),
            ]
          : []),
      ]),
    [units, exact, drillHref, applicantsFor],
  );

  const sorting: SortingState = [{ id: data.sort, desc: data.dir === 'desc' }];
  const table = useTable({
    features,
    columns,
    data: data.items,
    manualSorting: true,
    enableMultiSort: false,
    enableSortingRemoval: false,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = (typeof updater === 'function' ? updater(sorting) : updater)[0];
      if (next) onSort(next.id as ReportSort, next.desc ? 'desc' : 'asc');
    },
  });

  const firstRow = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const lastRow = Math.min(data.total, data.page * data.pageSize);
  const span = APPLICATION_STATUSES.length + (units ? 1 : 0);

  return (
    <Table label={title}>
      <caption className="sr-only">
        {title}: applications by review status. Rows {firstRow} to {lastRow} of {data.total}. Choose a column heading to sort by it.
      </caption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const sorted = header.column.getIsSorted();
              const name = header.column.id === 'name';
              return (
                <TableHead
                  key={header.id}
                  aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                  className={name ? 'w-52 min-w-44 px-3' : 'px-3 text-right'}
                >
                  {header.column.getCanSort() ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={`inline-flex cursor-pointer items-center gap-1 text-[12px] font-extrabold tracking-[0.8px] uppercase hover:text-ink ${name ? '' : 'justify-end text-right'} ${sorted ? 'text-ink' : ''}`}
                    >
                      <span className="whitespace-normal">
                        <table.FlexRender header={header} />
                      </span>
                      {sorted === 'asc' ? (
                        <ArrowUpIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      ) : sorted === 'desc' ? (
                        <ArrowDownIcon aria-hidden="true" className="size-3.5 shrink-0" />
                      ) : (
                        <ChevronsUpDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-50" />
                      )}
                    </button>
                  ) : (
                    <span className="whitespace-normal">
                      <table.FlexRender header={header} />
                    </span>
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) =>
              cell.column.id === 'name' ? (
                <th key={cell.id} scope="row" className="px-3 py-3 text-left align-top font-normal">
                  <table.FlexRender cell={cell} />
                </th>
              ) : (
                <TableCell key={cell.id} className="px-3 text-right tabular-nums">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ),
            )}
          </TableRow>
        ))}
      </TableBody>
      {data.extras.length > 0 && (
        <TableBody className="border-t-2 border-line">
          <TableRow className="hover:bg-transparent">
            <th scope="colgroup" colSpan={span + 2} className="bg-paper px-3 py-2 text-left text-[13px] font-bold text-muted">
              Outside any {one}
            </th>
          </TableRow>
          {data.extras.map((card) => {
            const href = applicantsFor(card);
            const drill = drillHref(card);
            return (
              <TableRow key={card.key}>
                <th scope="row" className="px-3 py-3 text-left align-top font-normal">
                  {drill ? (
                    <Link to={drill} className="font-bold text-brand underline-offset-4 hover:underline">
                      {card.name}
                    </Link>
                  ) : (
                    <span className="font-bold">{card.name}</span>
                  )}
                  <span className="block text-[13px] text-muted">{describePlace(card)}</span>
                </th>
                <TableCell className="px-3 text-right font-bold tabular-nums">
                  {href ? (
                    <Link to={href} aria-label={`View ${formatCount(card.applications)} applications: ${card.name}`} className="text-brand underline underline-offset-4">
                      {formatCount(card.applications)}
                    </Link>
                  ) : (
                    formatCount(card.applications)
                  )}
                </TableCell>
                {APPLICATION_STATUSES.map((status) => (
                  <TableCell key={status} className="px-3 text-right tabular-nums">
                    {formatCount(card.byStatus[status])}
                  </TableCell>
                ))}
                {units && (
                  <TableCell className="px-3 text-right tabular-nums">
                    {card.activeParishes !== null ? `${formatCount(card.parishesWithApplications)} of ${card.activeParishes}` : '—'}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      )}
      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <th scope="row" className="px-3 py-3 text-left">
            Total (all pages)
          </th>
          <TableCell className="px-3 text-right tabular-nums">{formatCount(data.totals.applications)}</TableCell>
          <TableCell colSpan={span} />
        </TableRow>
      </TableFooter>
    </Table>
  );
}
