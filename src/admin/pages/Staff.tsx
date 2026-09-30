import { useState, type FormEvent } from 'react';
import { Badge, Button, Input, LoadError, Loading, Notice, PageHeader, Panel, Select, TableScroll, errorMessage, td, th, when } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { useAsync } from '../../lib/useAsync';
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from '../../shared/permissions';
import { adminApi, type StaffRow } from '../api';
import { useAction } from '../parts';
import { useStaff } from '../session';

const ROLE_OPTIONS = STAFF_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const ROLE_HELP: Record<StaffRole, string> = {
  owner: 'Everything, including staff and settings.',
  programme_admin: 'Applicants, decisions, exports, accounts, cohorts, notifications and the audit history.',
  reviewer: 'Only the applications assigned to them: read, add notes, change the review status.',
  communications: 'Announcements and notifications.',
  read_only: 'The dashboard only.',
};

/** Shown once when an invitation couldn't be emailed: the owner shares it privately. */
function InviteLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Notice tone="warning" title="Email isn’t set up, so share this invitation link privately">
      <p className="break-all font-mono text-[13px]">{url}</p>
      <div className="mt-2 flex items-center gap-3">
        <Button tone="secondary" onClick={async () => setCopied(await copyText(url))}>
          Copy link
        </Button>
        <span role="status" className="text-[13px] text-muted">
          {copied ? 'Copied.' : ''}
        </span>
      </div>
      <p className="mt-2 text-[13px]">It works once and expires in 72 hours. It won’t be shown again.</p>
    </Notice>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const [values, setValues] = useState<{ email: string; displayName: string; role: StaffRole }>({ email: '', displayName: '', role: 'reviewer' });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setSent(null);
    setInviteUrl(null);
    try {
      const result = await adminApi.inviteStaff({ ...values, email: values.email.trim(), displayName: values.displayName.trim() });
      if (result.inviteUrl) setInviteUrl(result.inviteUrl);
      else setSent(`Invitation emailed to ${values.email.trim()}.`);
      setValues({ email: '', displayName: '', role: 'reviewer' });
      onDone();
    } catch (caught) {
      setProblem(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      {problem && <Notice tone="error">{problem}</Notice>}
      {sent && <Notice tone="success">{sent}</Notice>}
      {inviteUrl && <InviteLink url={inviteUrl} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Name" value={values.displayName} onChange={(event) => setValues({ ...values, displayName: event.currentTarget.value })} />
        <Input label="Email address" type="email" value={values.email} onChange={(event) => setValues({ ...values, email: event.currentTarget.value })} />
        <Select label="Role" hint={ROLE_HELP[values.role]} value={values.role} options={ROLE_OPTIONS} onChange={(event) => setValues({ ...values, role: event.currentTarget.value as StaffRole })} />
      </div>
      <div>
        <Button type="submit" busy={busy} disabled={!values.email.trim() || !values.displayName.trim()}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

function StaffActions({ row, isSelf, onChanged }: { row: StaffRow; isSelf: boolean; onChanged: () => void }) {
  const [role, setRole] = useState<StaffRole>(row.role);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const { busy, run, notice } = useAction();
  if (isSelf) return <span className="font-sans text-[13px] text-muted">This is you. Another owner can change your account.</span>;
  const act = (key: string, action: () => Promise<unknown>, success: string) => void run(key, action, success).then((ok) => ok && onChanged());
  return (
    <div className="flex min-w-[260px] flex-col gap-2">
      {notice}
      {inviteUrl && <InviteLink url={inviteUrl} />}
      <div className="flex flex-wrap items-end gap-2">
        <Select label={`Role for ${row.displayName}`} value={role} options={ROLE_OPTIONS} onChange={(event) => setRole(event.currentTarget.value as StaffRole)} className="min-w-[170px]" />
        <Button tone="secondary" disabled={role === row.role} busy={busy === 'role'} onClick={() => act('role', () => adminApi.setStaffRole(row.id, role), 'Role changed. They’ve been signed out so it takes effect.')}>
          Change role
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {row.status === 'suspended' ? (
          <Button tone="secondary" busy={busy === 'reactivate'} onClick={() => act('reactivate', () => adminApi.reactivateStaff(row.id), 'Reactivated.')}>
            Reactivate
          </Button>
        ) : (
          <Button tone="secondary" busy={busy === 'suspend'} onClick={() => act('suspend', () => adminApi.suspendStaff(row.id), 'Suspended and signed out.')}>
            Suspend
          </Button>
        )}
        {row.status === 'invited' && (
          <Button
            tone="secondary"
            busy={busy === 'invite'}
            onClick={() =>
              void run('invite', async () => {
                const result = await adminApi.resendInvite(row.id);
                if (result.inviteUrl) setInviteUrl(result.inviteUrl);
              }, 'A new invitation link was created (the old one no longer works).')
            }
          >
            New invitation link
          </Button>
        )}
        {row.lockedUntil && (
          <Button tone="secondary" busy={busy === 'unlock'} onClick={() => act('unlock', () => adminApi.unlockStaff(row.id), 'Unlocked. They can sign in again.')}>
            Unlock sign-in
          </Button>
        )}
        {row.mfaEnabled && (
          <Button tone="secondary" busy={busy === 'mfa'} onClick={() => act('mfa', () => adminApi.resetStaffMfa(row.id), 'Two-step verification reset. They’ll set it up again at their next sign-in.')}>
            Reset two-step verification
          </Button>
        )}
        <Button tone="secondary" busy={busy === 'sessions'} onClick={() => act('sessions', () => adminApi.revokeStaffSessions(row.id), 'Signed out everywhere.')}>
          Sign out everywhere
        </Button>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const staff = useStaff();
  const selfId = staff.step === 'signed-in' ? staff.session.staff.id : '';
  const { data, error, reload } = useAsync((signal) => adminApi.staff(signal), []);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Staff" documentTitle="Staff · Admin" description="Everyone with access to the admin area. Each person has their own account and two-step verification." />
      <Panel title="Invite someone">
        <InviteForm onDone={reload} />
      </Panel>
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : (
        <TableScroll label="Staff accounts">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={th}>Person</th>
                <th scope="col" className={th}>Role</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>Last sign-in</th>
                <th scope="col" className={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.id}>
                  <td className={td}>
                    <strong>{row.displayName}</strong>
                    <div className="text-[13px] text-muted">{row.email}</div>
                  </td>
                  <td className={td}>{ROLE_LABELS[row.role]}</td>
                  <td className={td}>
                    <div className="flex flex-col items-start gap-1">
                      <Badge tone={row.status === 'active' ? 'success' : row.status === 'invited' ? 'warning' : 'danger'}>
                        {row.status === 'active' ? 'Active' : row.status === 'invited' ? 'Invited' : 'Suspended'}
                      </Badge>
                      <Badge tone={row.mfaEnabled ? 'success' : 'warning'}>{row.mfaEnabled ? 'Two-step on' : 'Two-step not set up'}</Badge>
                      {row.lockedUntil && <Badge tone="danger">Locked until {when(row.lockedUntil)}</Badge>}
                    </div>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{when(row.lastLoginAt)}</td>
                  <td className={td}>
                    <StaffActions row={row} isSelf={row.id === selfId} onChanged={reload} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
    </>
  );
}
