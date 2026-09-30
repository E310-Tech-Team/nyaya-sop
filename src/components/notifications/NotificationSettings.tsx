import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { guideFor, currentPlatform } from '../../lib/install';
import { unblockInstructions } from '../../lib/push';
import { NOTIFICATION_CONSENT_STATEMENT, NOTIFICATION_TOPICS, TOPIC_DETAILS, type NotificationTopic } from '../../shared/platform';
import { GuideSteps, InAppBrowserNotice } from '../InstallGuide';
import { Button, Checkbox, Loading, Notice } from '../ui/basic';
import { usePushDevice } from './usePushDevice';

const UNSUPPORTED: Record<'in-app-browser' | 'old-apple-os' | 'not-secure' | 'no-push', string> = {
  'in-app-browser': 'This page is open inside another app, whose built-in browser can’t show notifications.',
  'old-apple-os': 'Notifications need iOS or iPadOS 16.4 or later. You can still sign in to check your application.',
  'not-secure': 'Notifications only work on the secure (https) version of this site.',
  'no-push': 'This browser doesn’t support notifications. Chrome, Edge, Firefox and Safari do.',
};

/**
 * Notification settings for this device: every state the brief lists (unsupported, install
 * required, not requested, on, blocked, expired, failed), topic choices, and turning off.
 * Account topics are only offered to a signed-in applicant.
 */
export function NotificationSettings({ signedIn = false }: { signedIn?: boolean }) {
  const device = usePushDevice({ signedIn });
  const { status } = device;
  const serverTopics = status?.kind === 'enabled' ? status.server.topics : null;
  const [topics, setTopics] = useState<NotificationTopic[]>(['general']);
  useEffect(() => {
    if (serverTopics) setTopics(serverTopics);
  }, [serverTopics]);

  if (!device.configLoaded) return <Loading label="Checking notifications…" />;
  if (!device.serverEnabled) {
    return <Notice title="Notifications aren’t available yet.">The School of Purpose team hasn’t switched notifications on for this site.</Notice>;
  }
  if (device.support.kind === 'install-required') {
    const guide = guideFor(currentPlatform());
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="warning" title="Add School of Purpose to your Home Screen first">
          On iPhone and iPad, notifications only work in the School of Purpose app opened from your Home Screen (iOS or iPadOS 16.4 or
          later). After adding it, open the app and come back to this page.
        </Notice>
        {guide !== 'in-app' && <GuideSteps guide={guide} />}
      </div>
    );
  }
  if (device.support.kind === 'unsupported') {
    return (
      <div className="flex flex-col gap-4">
        <Notice title="Notifications aren’t available here">{UNSUPPORTED[device.support.reason]}</Notice>
        {device.support.reason === 'in-app-browser' && <InAppBrowserNotice path="/notifications" />}
      </div>
    );
  }
  if (!status) return <Loading label="Checking this device…" />;
  if (status.kind === 'denied') {
    return (
      <Notice tone="warning" title="Notifications are blocked for this site">
        <p>{unblockInstructions()}</p>
      </Notice>
    );
  }

  const enabled = status.kind === 'enabled';
  const toggle = (topic: NotificationTopic, on: boolean) =>
    setTopics((current) => (on ? [...new Set([...current, topic])] : current.filter((item) => item !== topic)));
  const unchanged = enabled && serverTopics !== null && [...topics].sort().join() === [...serverTopics].sort().join();

  return (
    <div className="flex flex-col gap-5">
      {status.kind === 'enabled' && <Notice tone="success">Notifications are on for this device.</Notice>}
      {status.kind === 'expired' && (
        <Notice tone="warning" title="Notifications on this device stopped working">
          This can happen after a browser update or a long time without use. Turn them on again to keep getting updates.
        </Notice>
      )}
      {status.kind === 'failed' && (
        <Notice tone="error" title="Notifications couldn’t be turned on">
          <p>{status.message || 'Something went wrong.'}</p>
          <p className="mt-1">Check your connection and try again.</p>
        </Notice>
      )}
      {device.error && <Notice tone="error">{device.error}</Notice>}

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 font-sans text-[15px] font-bold text-ink">What to be notified about</legend>
        {NOTIFICATION_TOPICS.map((topic) => {
          const details = TOPIC_DETAILS[topic];
          const locked = details.requiresAccount && !signedIn;
          return (
            <Checkbox
              key={topic}
              label={details.label}
              hint={locked ? `${details.description} Sign in to your account to choose this.` : details.description}
              checked={topics.includes(topic)}
              disabled={locked || device.busy}
              onChange={(event) => toggle(topic, event.currentTarget.checked)}
            />
          );
        })}
      </fieldset>
      {!signedIn && (
        <p className="font-sans text-[14px] text-muted">
          Application updates and training reminders need an account.{' '}
          <Link to="/account" className="font-bold text-brand underline underline-offset-4">
            Sign in or create one
          </Link>
          .
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        {enabled ? (
          <>
            <Button busy={device.busy} disabled={unchanged || topics.length === 0} onClick={() => void device.save(topics)}>
              Save changes
            </Button>
            <Button tone="secondary" disabled={device.busy} onClick={() => void device.disable()}>
              Turn off on this device
            </Button>
          </>
        ) : (
          <Button busy={device.busy} disabled={topics.length === 0} onClick={() => void device.enable(topics)}>
            {status.kind === 'expired' ? 'Turn notifications on again' : 'Enable notifications'}
          </Button>
        )}
      </div>
      {enabled && topics.length === 0 && <p className="font-sans text-[13px] text-muted">To stop all notifications, use “Turn off on this device”.</p>}
      <p className="font-sans text-[13px] leading-[1.5] text-muted">{NOTIFICATION_CONSENT_STATEMENT}</p>
    </div>
  );
}
