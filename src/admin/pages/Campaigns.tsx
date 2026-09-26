import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, ButtonLink, LoadError, Loading, Notice, PageHeader, Panel, TableScroll, td, th, when, type BadgeTone } from '../../components/ui';
import { usePublicConfig } from '../../lib/config';
import { pushSupport, serviceWorkerReady, urlBase64ToBytes } from '../../lib/push';
import { useAsync } from '../../lib/useAsync';
import { TOPIC_DETAILS } from '../../shared/platform';
import { adminApi, type CampaignStatus } from '../api';
import { useAction } from '../parts';

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  scheduled: { label: 'Scheduled', tone: 'warning' },
  sending: { label: 'Sending', tone: 'brand' },
  sent: { label: 'Sent', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** Staff test devices: test sends go only here, never to applicants. */
function TestDevices() {
  const config = usePublicConfig();
  const { data, error, reload } = useAsync((signal) => adminApi.testDevices(signal), []);
  const { busy, run, notice, setMessage } = useAction();
  const support = pushSupport();
  // Fetched ahead, so subscribe() runs directly in the click (Safari requires that).
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    if (support.kind === 'supported') void serviceWorkerReady().then(setRegistration);
  }, [support.kind]);

  const addThisBrowser = () => {
    const key = config?.push.publicKey;
    if (!registration || !key) {
      setMessage({ tone: 'error', text: 'This browser can’t receive notifications from this site right now (no service worker, or push isn’t configured).' });
      return;
    }
    void run(
      'add',
      async () => {
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
        await adminApi.addTestDevice(subscription.toJSON());
      },
      'This browser is now one of your test devices.',
    ).then(reload);
  };

  return (
    <Panel title="Your test devices" description="“Send a test” delivers only to these, so you can check a notification before anyone else sees it.">
      {notice}
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.devices.length ? (
        <ul className="flex flex-col gap-2">
          {data.devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line px-4 py-2 font-sans text-[14px]">
              <span>
                <strong>{device.label}</strong> · added {when(device.createdAt)}
              </span>
              <Button tone="ghost" busy={busy === device.id} onClick={() => void run(device.id, () => adminApi.removeTestDevice(device.id)).then(reload)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-sans text-[14px] text-muted">No test devices yet.</p>
      )}
      {support.kind === 'supported' ? (
        <div>
          <Button tone="secondary" busy={busy === 'add'} onClick={addThisBrowser}>
            Use this browser as a test device
          </Button>
        </div>
      ) : (
        <Notice>This browser can’t receive notifications. Open the admin area in Chrome, Edge, Firefox or Safari (on iPhone: from the Home Screen app).</Notice>
      )}
    </Panel>
  );
}

export default function CampaignsPage() {
  const { data, error, reload } = useAsync((signal) => adminApi.campaigns(signal), []);
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Notifications"
        documentTitle="Notifications · Admin"
        description="Push notifications to people who chose a topic, with an optional copy in applicants’ inboxes."
        actions={<ButtonLink to="/admin/campaigns/new" tone="primary">New notification</ButtonLink>}
      />
      {error ? (
        <LoadError error={error} onRetry={reload} />
      ) : !data ? (
        <Loading />
      ) : data.items.length === 0 ? (
        <Panel>
          <p className="font-sans text-[15px] text-muted">No notifications yet.</p>
        </Panel>
      ) : (
        <TableScroll label="Notifications">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th scope="col" className={th}>Title</th>
                <th scope="col" className={th}>Topic</th>
                <th scope="col" className={th}>Status</th>
                <th scope="col" className={th}>When</th>
                <th scope="col" className={`${th} text-right`}>Devices</th>
                <th scope="col" className={`${th} text-right`}>Accepted by push service</th>
                <th scope="col" className={`${th} text-right`}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((campaign) => (
                <tr key={campaign.id}>
                  <td className={td}>
                    <Link to={`/admin/campaigns/${campaign.id}`} className="font-bold text-brand underline-offset-4 hover:underline">
                      {campaign.title}
                    </Link>
                    <div className="text-[13px] text-muted">by {campaign.createdBy ?? 'former staff'}</div>
                  </td>
                  <td className={td}>{TOPIC_DETAILS[campaign.topic].label}</td>
                  <td className={td}>
                    <Badge tone={CAMPAIGN_STATUS[campaign.status].tone}>{CAMPAIGN_STATUS[campaign.status].label}</Badge>
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{when(campaign.completedAt ?? campaign.scheduledFor ?? campaign.createdAt, campaign.timeZone)}</td>
                  <td className={`${td} text-right tabular-nums`}>{campaign.stats.devices}</td>
                  <td className={`${td} text-right tabular-nums`}>{campaign.stats.acceptedByPushService}</td>
                  <td className={`${td} text-right tabular-nums`}>{campaign.stats.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <TestDevices />
    </>
  );
}
