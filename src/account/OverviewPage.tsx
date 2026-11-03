import { Link } from 'react-router';
import { usePushDevice, type PushDevice } from '../components/notifications/usePushDevice';
import { Badge, ButtonLink, LoadError, Loading, Panel, when } from '../components/ui';
import { JOURNEY } from '../config/programme';
import { useAccount } from '../lib/account';
import { useAsync } from '../lib/useAsync';
import { AccountFrame } from './AccountApp';
import { accountApi } from './api';
import { ApplicationProgress } from './ApplicationProgress';
import { checklist, type ChecklistItem, type NotificationReadiness } from './dashboard';

const PREVIEW_COUNT = 3;
const link = 'font-bold text-brand underline underline-offset-4';

/** What this device can do, or undefined while it's still being checked. A block is not nagged about. */
function readiness(device: PushDevice): NotificationReadiness | undefined {
  if (!device.configLoaded) return undefined;
  if (!device.serverEnabled || device.support.kind === 'unsupported') return 'unavailable';
  if (device.support.kind === 'install-required') return 'install-required';
  if (!device.status) return undefined;
  if (device.status.kind === 'enabled') return 'on';
  return device.status.kind === 'denied' ? 'unavailable' : 'off';
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className={
          item.done
            ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-white'
            : 'mt-0.5 size-5 shrink-0 rounded-full border-2 border-gold bg-white'
        }
      >
        {item.done && (
          <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="font-sans text-[15px] leading-[1.5] text-ink">
        <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
        {item.to && !item.done ? (
          <Link to={item.to} className={link}>
            {item.label}
          </Link>
        ) : (
          <span className={item.done ? 'text-muted' : undefined}>{item.label}</span>
        )}
      </span>
    </li>
  );
}

/** /account: the applicant dashboard. Shows only published statuses and confirmed programme copy. */
export default function AccountOverviewPage() {
  const account = useAccount();
  const email = account.status === 'signed-in' ? account.account.email : '';
  const applications = useAsync((signal) => accountApi.applications(signal), []);
  const inbox = useAsync((signal) => accountApi.inbox(signal), []);
  const updates = useAsync((signal) => accountApi.announcements(signal), []);
  const device = usePushDevice({ signedIn: true });

  const todo = checklist({
    claimed: applications.data?.claimed.length,
    claimable: applications.data?.claimable.length,
    unread: inbox.data?.unread,
    notifications: readiness(device),
  });
  const allDone = todo.length > 0 && todo.every((item) => item.done);

  return (
    <AccountFrame title="Dashboard" documentTitle="Your account">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Your application" className="md:col-span-2" actions={<ButtonLink to="/account/application">Details</ButtonLink>}>
          {applications.error ? (
            <LoadError error={applications.error} onRetry={applications.reload} />
          ) : !applications.data ? (
            <Loading />
          ) : applications.data.claimed.length ? (
            <div className="flex flex-col gap-8">
              {applications.data.claimed.map((item) => (
                <ApplicationProgress key={item.id} item={item} />
              ))}
            </div>
          ) : applications.data.claimable.length ? (
            <p className="font-sans text-[15px] leading-[1.6] text-ink">
              We found an application sent with {email}.{' '}
              <Link to="/account/application" className={link}>
                Link it to your account
              </Link>{' '}
              to follow its progress here.
            </p>
          ) : (
            <p className="font-sans text-[15px] leading-[1.6] text-ink">
              There’s no application sent with {email}.{' '}
              <Link to="/apply" className={link}>
                Apply now
              </Link>
              , or sign in with the email address you applied with.
            </p>
          )}
        </Panel>

        <Panel title="To do" description={allDone ? 'You’re all set.' : undefined}>
          {todo.length ? (
            <ul className="flex flex-col gap-3">
              {todo.map((item) => (
                <ChecklistRow key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <Loading />
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
              {inbox.data.items.slice(0, PREVIEW_COUNT).map((item) => (
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

        <Panel title="Programme updates" actions={<ButtonLink to="/updates">All updates</ButtonLink>}>
          {updates.error ? (
            <LoadError error={updates.error} onRetry={updates.reload} />
          ) : !updates.data ? (
            <Loading />
          ) : updates.data.items.length ? (
            <ul className="flex flex-col gap-3">
              {updates.data.items.slice(0, PREVIEW_COUNT).map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5">
                  <span className="font-sans text-[15px] font-bold text-ink">{item.title}</span>
                  <span className="font-sans text-[13px] text-muted">{when(item.publishedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="font-sans text-[15px] text-muted">There are no announcements yet.</p>
          )}
        </Panel>

        <Panel title="The programme" description="Six stages, from applying to community." actions={<ButtonLink to="/journey">The journey</ButtonLink>}>
          <ol className="flex flex-col gap-2.5">
            {JOURNEY.map((stage) => (
              <li key={stage.num} className="flex items-baseline gap-3 font-sans text-[14px]">
                <span className="w-6 shrink-0 font-bold tabular-nums text-gold">{stage.num}</span>
                <span className="text-ink">
                  <span className="font-bold">{stage.name}</span>
                  <span className="text-muted"> · {stage.meta[0]}</span>
                  {stage.condition && <span className="text-muted"> · {stage.condition}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </AccountFrame>
  );
}
