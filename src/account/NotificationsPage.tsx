import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { NotificationSettings } from '../components/notifications/NotificationSettings';
import { Badge, Button, LoadError, Loading, Notice, Panel, errorMessage, when } from '../components/ui';
import { thisDeviceId } from '../lib/push';
import { useAsync } from '../lib/useAsync';
import { TOPIC_DETAILS } from '../shared/platform';
import { AccountFrame } from './AccountApp';
import { accountApi } from './api';

function Inbox() {
  const { data, error, reload } = useAsync((signal) => accountApi.inbox(signal), []);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.items.length) return <p className="font-sans text-[15px] text-muted">No messages yet. Updates about your application will appear here.</p>;
  const markRead = async (id: string) => {
    await accountApi.markRead(id).catch(() => undefined);
    setReadIds((current) => new Set([...current, id]));
  };
  return (
    <ul className="flex flex-col gap-3">
      {data.items.map((item) => {
        const unread = !item.read && !readIds.has(item.id);
        return (
          <li key={item.id} className={`flex flex-col gap-1.5 rounded-[12px] border px-4 py-3 ${unread ? 'border-brand/40 bg-rose/20' : 'border-line bg-white'}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-sans text-[16px] font-bold text-ink">{item.title}</h3>
              {unread && <Badge tone="brand">New</Badge>}
              {item.kind === 'notice' && <Badge>Notice</Badge>}
            </div>
            <p className="whitespace-pre-line font-sans text-[15px] leading-[1.6] text-ink">{item.body}</p>
            <div className="flex flex-wrap items-center gap-3 font-sans text-[13px] text-muted">
              <span>{when(item.createdAt)}</span>
              {item.linkPath && (
                <Link to={item.linkPath} className="font-bold text-brand underline underline-offset-4" onClick={() => unread && void markRead(item.id)}>
                  Open
                </Link>
              )}
              {unread && (
                <button type="button" className="min-h-[32px] cursor-pointer font-bold text-brand underline underline-offset-4" onClick={() => void markRead(item.id)}>
                  Mark as read
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Devices() {
  const { data, error, reload } = useAsync((signal) => accountApi.devices(signal), []);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void thisDeviceId().then(setCurrentId);
  }, [data]);
  if (error) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  if (!data.devices.length) return <p className="font-sans text-[15px] text-muted">No devices get notifications for this account.</p>;
  const remove = async (id: string) => {
    setProblem(null);
    try {
      await accountApi.removeDevice(id);
      reload();
    } catch (caught) {
      setProblem(errorMessage(caught));
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {problem && <Notice tone="error">{problem}</Notice>}
      <ul className="flex flex-col gap-3">
        {data.devices.map((device) => (
          <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-white px-4 py-3">
            <div className="flex flex-col gap-0.5">
              <p className="font-sans text-[15px] font-bold text-ink">
                {device.label} {device.id === currentId && <Badge tone="success">This device</Badge>}
              </p>
              <p className="font-sans text-[13px] text-muted">
                {device.topics.map((topic) => TOPIC_DETAILS[topic].label).join(', ') || 'No topics'} · last seen {when(device.lastSeenAt)}
              </p>
            </div>
            <Button tone="secondary" onClick={() => void remove(device.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AccountNotificationsPage() {
  return (
    <AccountFrame title="Messages & notifications" description="Messages from the Programme team are kept here, whether or not you turn on notifications.">
      <Panel title="Messages">
        <Inbox />
      </Panel>
      <Panel title="Notifications on this device" description="Short alerts on your lock screen. They never show the details of a decision.">
        <NotificationSettings signedIn />
      </Panel>
      <Panel title="Devices that get notifications for your account">
        <Devices />
      </Panel>
    </AccountFrame>
  );
}
