import { Link } from 'react-router';
import { usePushDevice } from '../components/notifications/usePushDevice';
import { Badge, ButtonLink, LoadError, Loading, Panel, when } from '../components/ui';
import { useAccount } from '../lib/account';
import { useAsync } from '../lib/useAsync';
import { AccountFrame } from './AccountApp';
import { accountApi } from './api';
import { STATUS_TONE } from './status';

function NotificationSummary() {
  const device = usePushDevice({ signedIn: true });
  const text =
    !device.serverEnabled
      ? 'Notifications aren’t available on this site yet.'
      : device.support.kind === 'install-required'
        ? 'On iPhone and iPad, add School of Purpose to your Home Screen to get notifications.'
        : device.support.kind === 'unsupported'
          ? 'Notifications aren’t available in this browser.'
          : device.status?.kind === 'enabled'
            ? `On for this device (${device.status.server.topics.length} ${device.status.server.topics.length === 1 ? 'topic' : 'topics'}).`
            : device.status?.kind === 'denied'
              ? 'Blocked in this browser’s settings.'
              : device.status
                ? 'Off for this device.'
                : 'Checking…';
  return <p className="font-sans text-[15px] text-ink">{text}</p>;
}

export default function AccountOverviewPage() {
  const account = useAccount();
  const email = account.status === 'signed-in' ? account.account.email : '';
  const applications = useAsync((signal) => accountApi.applications(signal), []);
  const inbox = useAsync((signal) => accountApi.inbox(signal), []);

  return (
    <AccountFrame title="Overview" documentTitle="Your account">
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Your application" actions={<ButtonLink to="/account/application">View</ButtonLink>}>
          {applications.error ? (
            <LoadError error={applications.error} onRetry={applications.reload} />
          ) : !applications.data ? (
            <Loading />
          ) : applications.data.claimed.length ? (
            <ul className="flex flex-col gap-3">
              {applications.data.claimed.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 font-sans text-[15px]">
                  <span className="font-bold text-ink">{item.reference}</span>
                  <Badge tone={STATUS_TONE[item.status]}>{item.statusLabel}</Badge>
                </li>
              ))}
            </ul>
          ) : applications.data.claimable.length ? (
            <p className="font-sans text-[15px] leading-[1.6] text-ink">
              We found an application sent with {email}.{' '}
              <Link to="/account/application" className="font-bold text-brand underline underline-offset-4">
                Link it to your account
              </Link>{' '}
              to see its status here.
            </p>
          ) : (
            <p className="font-sans text-[15px] leading-[1.6] text-ink">
              There’s no application sent with {email}.{' '}
              <Link to="/apply" className="font-bold text-brand underline underline-offset-4">
                Apply now
              </Link>
              , or sign in with the email address you applied with.
            </p>
          )}
        </Panel>

        <Panel
          title="Messages"
          description={inbox.data?.unread ? `${inbox.data.unread} unread` : undefined}
          actions={<ButtonLink to="/account/notifications">All messages</ButtonLink>}
        >
          {inbox.error ? (
            <LoadError error={inbox.error} onRetry={inbox.reload} />
          ) : !inbox.data ? (
            <Loading />
          ) : inbox.data.items.length ? (
            <ul className="flex flex-col gap-3">
              {inbox.data.items.slice(0, 3).map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5">
                  <span className="font-sans text-[15px] font-bold text-ink">
                    {item.title}
                    {!item.read && <span className="ml-2 align-middle"><Badge tone="brand">New</Badge></span>}
                  </span>
                  <span className="font-sans text-[13px] text-muted">{when(item.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-sans text-[15px] text-muted">No messages yet.</p>
          )}
        </Panel>

        <Panel title="Notifications on this device" actions={<ButtonLink to="/account/notifications">Manage</ButtonLink>}>
          <NotificationSummary />
        </Panel>

        <Panel title="Settings" actions={<ButtonLink to="/account/settings">Open</ButtonLink>}>
          <p className="font-sans text-[15px] leading-[1.6] text-ink">Where you’re signed in, signing out everywhere, and deleting your account.</p>
        </Panel>
      </div>
    </AccountFrame>
  );
}
