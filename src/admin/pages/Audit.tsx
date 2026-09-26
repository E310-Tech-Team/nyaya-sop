import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Button, Input, LoadError, Loading, PageHeader, Pagination, TableScroll, td, th, when } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { adminApi } from '../api';

/** Who did what, when. Identifiers and field names only: never the personal data itself. */
export default function AuditPage() {
  const [params, setParams] = useSearchParams();
  const action = params.get('action') ?? '';
  const targetId = params.get('targetId') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [actionInput, setActionInput] = useState(action);
  useEffect(() => setActionInput(action), [action]);
  const { data, error, reload } = useAsync((signal) => adminApi.audit({ action, targetId, page, pageSize: 50 }, signal), [action, targetId, page]);
  const set = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  return (
    <>
      <PageHeader eyebrow="Admin" title="Audit history" documentTitle="Audit history · Admin" description="Exports, decisions, account changes, sends and sign-ins, newest first. Times are in Lagos time (WAT)." />
      <form
        role="search"
        className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-white p-4"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          set({ action: actionInput.trim() });
        }}
      >
        <Input label="Action starts with" hint="For example application., campaign., staff., applications.exported" value={actionInput} onChange={(event) => setActionInput(event.currentTarget.value)} className="min-w-[240px] flex-1" />
        <Button type="submit">Filter</Button>
        {(action || targetId) && (
          <Button tone="ghost" onClick={() => setParams(new URLSearchParams())}>
            Clear
          </Button>
        )}
      </form>
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          <TableScroll label="Audit history">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={th}>When (WAT)</th>
                  <th scope="col" className={th}>Who</th>
                  <th scope="col" className={th}>Action</th>
                  <th scope="col" className={th}>On</th>
                  <th scope="col" className={th}>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((row) => (
                  <tr key={row.id}>
                    <td className={`${td} whitespace-nowrap`}>{when(row.at)}</td>
                    <td className={td}>{row.actor}</td>
                    <td className={td}>
                      <code className="font-mono text-[13px]">{row.action}</code>
                    </td>
                    <td className={td}>
                      {row.target ? (
                        <button type="button" className="cursor-pointer text-left font-mono text-[12px] text-brand underline-offset-2 hover:underline" onClick={() => set({ targetId: row.target?.id ?? '' })} title="Show everything about this item">
                          {row.target.type} {row.target.id?.slice(0, 8)}
                        </button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={td}>
                      {Object.keys(row.details).length ? <code className="block max-w-[360px] whitespace-pre-wrap break-words font-mono text-[12px] text-muted">{JSON.stringify(row.details)}</code> : '—'}
                    </td>
                  </tr>
                ))}
                {data.items.length === 0 && (
                  <tr>
                    <td className={td} colSpan={5}>
                      Nothing recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(next) => set({ page: String(next) })} />
        </>
      )}
    </>
  );
}
