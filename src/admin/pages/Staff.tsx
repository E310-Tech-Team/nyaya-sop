import { useEffect, useState, type FormEvent } from 'react';
import { Badge, Button, Input, LoadError, Loading, Notice, PageHeader, Panel, Select, TableScroll, errorMessage, td, th, when } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { useAsync } from '../../lib/useAsync';
import { ROLE_LABELS, STAFF_ROLES, type StaffRole } from '../../shared/permissions';
import { adminApi, type StaffRow } from '../api';
import { ConfirmByTyping, useAction } from '../parts';
import { useStaff } from '../session';

const ROLE_OPTIONS = STAFF_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));
const ROLE_HELP: Record<StaffRole, string> = {
  owner: 'Everything, including staff and settings.',
  programme_admin: 'Applicants, decisions, exports, accounts, cohorts, notifications and the audit history.',
  reviewer: 'Only the applications assigned to them: read, add notes, change the review status.',
  communications: 'Announcements and notifications.',
  read_only: 'The dashboard only.',
};

/**
 * An invitation link, shown once: when it couldn't be emailed, or when an owner asked for one to
 * share another way (`requested`, D-60, copied straight away where the browser allows). The owner
 * passes it on privately; it's never shown again.
 */
function InviteLink({ url, name, requested = false }: { url: string; name: string; requested?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    // Asked for with "Copy a new invitation link": copy it at once. Some browsers only allow that
    // during the click itself, so the button below stays for a second try.
    if (requested) void copyText(url).then(setCopied);
  }, [requested, url]);
  return (
    <Notice tone="warning" title={requested ? `Share this link only with ${name}, privately` : 'We couldn’t email this invitation, so share this link privately'}>
      <p className="break-all font-mono text-[13px]">{url}</p>
      <div className="mt-2 flex items-center gap-3">
        <Button tone="secondary" onClick={async () => setCopied(await copyText(url))}>
          Copy link
        </Button>
        <span role="status" className="text-[13px] text-muted">
          {copied ? 'Copied.' : ''}
        </span>
      </div>
      <p className="mt-2 text-[13px]">
        Anyone with it can set up this account. It works once and expires in 72 hours, and any earlier link for {name} no longer works. It won’t be
        shown again.
      </p>
    </Notice>
  );
}

type InviteValues = { email: string; displayName: string; role: StaffRole };

function InviteForm({ onDone, initial }: { onDone: () => void; initial?: InviteValues | null }) {
  const [values, setValues] = useState<InviteValues>(initial ?? { email: '', displayName: '', role: 'reviewer' });
  const [invite, setInvite] = useState<{ url: string; name: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setSent(null);
    setInvite(null);
    const name = values.displayName.trim();
    try {
      const result = await adminApi.inviteStaff({ ...values, email: values.email.trim(), displayName: name });
      if (result.inviteUrl) setInvite({ url: result.inviteUrl, name });
      else setSent(`Invitation emailed to ${values.email.trim()}. To share it another way, choose “Copy a new invitation link” beside ${name} below.`);
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
      {invite && <InviteLink url={invite.url} name={invite.name} />}
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

function StaffActions({ row, isSelf, onChanged, onRemoved }: { row: StaffRow; isSelf: boolean; onChanged: () => void; onRemoved: (row: StaffRow) => void }) {
  const [role, setRole] = useState<StaffRole>(row.role);
  const [invite, setInvite] = useState<{ url: string; requested: boolean } | null>(null);
  const [removing, setRemoving] = useState(false);
  const { busy, run, notice, setMessage } = useAction();
  if (isSelf) return <span className="font-sans text-[13px] text-muted">This is you. Another owner can change your account.</span>;
  const act = (key: string, action: () => Promise<unknown>, success: string) => void run(key, action, success).then((ok) => ok && onChanged());
  return (
    <div className="flex min-w-[260px] flex-col gap-2">
      {notice}
      {invite && <InviteLink url={invite.url} name={row.displayName} requested={invite.requested} />}
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
          <>
            <Button
              tone="secondary"
              busy={busy === 'invite'}
              onClick={() => {
                setInvite(null);
                void run('invite', async () => {
                  const result = await adminApi.resendInvite(row.id);
                  if (result.inviteUrl) setInvite({ url: result.inviteUrl, requested: false });
                  else setMessage({ tone: 'success', text: `A new invitation was emailed to ${row.email}. The earlier link no longer works.` });
                });
              }}
            >
              Email a new invitation
            </Button>
            <Button
              tone="secondary"
              busy={busy === 'copy'}
              onClick={() => {
                setInvite(null);
                void run('copy', async () => {
                  const result = await adminApi.staffInviteLink(row.id);
                  setInvite({ url: result.inviteUrl, requested: true });
                });
              }}
            >
              Copy a new invitation link
            </Button>
          </>
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
        {!removing && (
          <Button tone="ghost" onClick={() => setRemoving(true)}>
            Remove…
          </Button>
        )}
      </div>
      {row.status === 'invited' && (
        <p className="font-sans text-[13px] text-muted">Not accepted yet. Each new invitation, emailed or copied, replaces the last one.</p>
      )}
      {removing && (
        <div className="flex flex-col gap-2 rounded-xl border border-line px-3 py-3">
          <ConfirmByTyping
            expected={row.email}
            label={`Type ${row.email} to confirm`}
            action={`Remove ${row.displayName}`}
            explanation={
              <>
                <strong>{row.displayName}</strong> loses access at once and leaves this list: their password, two-step verification, sessions and links
                stop working, and applications assigned to them are unassigned. Their name stays on what they did. To add them again later, invite this
                email address: they start afresh.
              </>
            }
            onConfirm={async (typed) => {
              await adminApi.removeStaff(row.id, typed);
              onRemoved(row);
            }}
          />
          <div>
            <Button tone="ghost" onClick={() => setRemoving(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function StaffPage() {
  const staff = useStaff();
  const selfId = staff.step === 'signed-in' ? staff.session.staff.id : '';
  const { data, error, reload } = useAsync((signal) => adminApi.staff(signal), []);
  // After a removal: who it was, and (once asked) the invitation form filled in to add them again.
  const [removed, setRemoved] = useState<StaffRow | null>(null);
  const [again, setAgain] = useState<InviteValues | null>(null);
  return (
    <>
      <PageHeader eyebrow="Admin" title="Staff" documentTitle="Staff · Admin" description="Everyone with access to the admin area. Each person has their own account and two-step verification." />
      <Panel title="Invite someone">
        {/* Keyed by what it starts with, so "Invite them again" fills it in afresh. */}
        <InviteForm
          key={again ? `again:${again.email}` : 'blank'}
          initial={again}
          onDone={() => {
            setRemoved(null); // answered by the invitation (its own notice says so)
            reload();
          }}
        />
      </Panel>
      {removed && (
        <Notice tone="success" title={`${removed.displayName} was removed`}>
          <p>They no longer have access. To add them again, invite {removed.email}: they’ll choose a new password and set up two-step verification.</p>
          {!again && (
            <div className="mt-2">
              <Button
                tone="secondary"
                onClick={() => {
                  setAgain({ email: removed.email, displayName: removed.displayName, role: removed.role });
                  window.scrollTo({ top: 0 });
                }}
              >
                Invite them again
              </Button>
            </div>
          )}
          {again && <p className="mt-2">Their details are in the invitation form above: check the role, then send the invitation.</p>}
        </Notice>
      )}
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
                    <StaffActions
                      row={row}
                      isSelf={row.id === selfId}
                      onChanged={reload}
                      onRemoved={(gone) => {
                        setAgain(null);
                        setRemoved(gone);
                        reload();
                      }}
                    />
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
