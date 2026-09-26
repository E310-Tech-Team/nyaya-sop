import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Badge, Button, Input, LoadError, Loading, PageHeader, Pagination, Panel, Select, TableScroll, td, th, when } from '../../components/ui';
import { useAsync } from '../../lib/useAsync';
import { TOPIC_DETAILS } from '../../shared/platform';
import { adminApi } from '../api';
import { ConfirmByTyping, PublishedBadge, useAction } from '../parts';
import { useCan } from '../session';

export default function AccountsPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const list = useAsync((signal) => adminApi.accounts({ q, status, page, pageSize: 25 }, signal), [q, status, page]);
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
      <PageHeader eyebrow="Admin" title="Applicant accounts" documentTitle="Accounts · Admin" description="Optional accounts people use to follow their applications." />
      <section aria-label="Search and filters" className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-white p-4">
        <form
          role="search"
          className="flex flex-1 flex-wrap items-end gap-3"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            set({ q: search.trim() });
          }}
        >
          <Input label="Email contains" value={search} onChange={(event) => setSearch(event.currentTarget.value)} className="min-w-[220px] flex-1" />
          <Button type="submit">Search</Button>
        </form>
        <Select
          label="Status"
          value={status}
          onChange={(event) => set({ status: event.currentTarget.value })}
          options={[
            { value: '', label: 'All' },
            { value: 'active', label: 'Active' },
            { value: 'suspended', label: 'Suspended' },
          ]}
        />
      </section>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <>
          <TableScroll label="Accounts">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th scope="col" className={th}>Email</th>
                  <th scope="col" className={th}>Status</th>
                  <th scope="col" className={th}>Created</th>
                  <th scope="col" className={th}>Last sign-in</th>
                  <th scope="col" className={`${th} text-right`}>Applications</th>
                  <th scope="col" className={`${th} text-right`}>Devices</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.id}>
                    <td className={td}>
                      <Link to={`/admin/accounts/${row.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                        {row.email}
                      </Link>
                    </td>
                    <td className={td}>
                      <Badge tone={row.status === 'active' ? 'success' : 'danger'}>{row.status === 'active' ? 'Active' : 'Suspended'}</Badge>
                    </td>
                    <td className={`${td} whitespace-nowrap`}>{when(row.createdAt)}</td>
                    <td className={`${td} whitespace-nowrap`}>{when(row.lastLoginAt)}</td>
                    <td className={`${td} text-right tabular-nums`}>{row.applications}</td>
                    <td className={`${td} text-right tabular-nums`}>{row.devices}</td>
                  </tr>
                ))}
                {list.data.items.length === 0 && (
                  <tr>
                    <td className={td} colSpan={6}>
                      No accounts match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableScroll>
          <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={(next) => set({ page: String(next) })} />
        </>
      )}
    </>
  );
}

export function AccountDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const canManage = useCan('accounts.manage');
  const { data, error, reload } = useAsync((signal) => adminApi.account(id, signal), [id]);
  const { busy, run, notice } = useAction();
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <>
      <Link to="/admin/accounts" className="font-sans text-[14px] font-bold text-brand underline-offset-4 hover:underline">
        ← Accounts
      </Link>
      <PageHeader
        eyebrow="Applicant account"
        title={data.email}
        documentTitle="Account · Admin"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={data.status === 'active' ? 'success' : 'danger'}>{data.status === 'active' ? 'Active' : `Suspended ${when(data.suspendedAt)}`}</Badge>
            Created {when(data.createdAt)} · last sign-in {when(data.lastLoginAt)} · {data.activeSessions} active {data.activeSessions === 1 ? 'session' : 'sessions'}
          </span>
        }
      />
      {notice}
      <Panel title="Applications">
        {data.applications.length ? (
          <ul className="flex flex-col gap-2">
            {data.applications.map((application) => (
              <li key={application.id} className="flex flex-wrap items-center gap-2 font-sans text-[15px]">
                <Link to={`/admin/applicants/${application.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                  {application.reference}
                </Link>
                {application.cohort} · published: <PublishedBadge status={application.publishedStatus} /> · linked {when(application.claimedAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-sans text-[14px] text-muted">No applications linked.</p>
        )}
      </Panel>
      <Panel title="Notification devices">
        {data.devices.length ? (
          <ul className="flex flex-col gap-2 font-sans text-[14px] text-ink">
            {data.devices.map((device) => (
              <li key={device.id}>
                <strong>{device.label}</strong> · {device.status} · {device.topics.map((topic) => TOPIC_DETAILS[topic].label).join(', ') || 'no topics'} · last seen {when(device.lastSeenAt)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-sans text-[14px] text-muted">No devices.</p>
        )}
      </Panel>
      {canManage && (
        <>
          <Panel title="Access" description="Suspending signs the person out everywhere and stops notifications to their devices. Their applications are unaffected.">
            <div className="flex flex-wrap gap-2">
              {data.status === 'active' ? (
                <Button tone="danger" busy={busy === 'suspend'} onClick={() => void run('suspend', () => adminApi.suspendAccount(data.id), 'Account suspended.').then((ok) => ok && reload())}>
                  Suspend account
                </Button>
              ) : (
                <Button busy={busy === 'reactivate'} onClick={() => void run('reactivate', () => adminApi.reactivateAccount(data.id), 'Account reactivated.').then((ok) => ok && reload())}>
                  Reactivate account
                </Button>
              )}
              <Button tone="secondary" busy={busy === 'sessions'} onClick={() => void run('sessions', () => adminApi.revokeAccountSessions(data.id), 'Signed out everywhere.').then((ok) => ok && reload())}>
                Sign out everywhere
              </Button>
            </div>
          </Panel>
          <Panel title="Delete account">
            <ConfirmByTyping
              expected={data.email}
              label={`Type ${data.email} to confirm`}
              action="Delete account"
              explanation="For a request to delete the account. Applications stay, unlinked; sessions and inbox messages are deleted; devices stop receiving notifications."
              onConfirm={async (typed) => {
                await adminApi.deleteAccount(data.id, typed);
                navigate('/admin/accounts', { replace: true });
              }}
            />
          </Panel>
        </>
      )}
    </>
  );
}
