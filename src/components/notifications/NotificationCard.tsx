import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { isPushCardSnoozed, snoozePushCard } from '../../lib/push';
import { Button } from '../ui/basic';
import { usePushDevice } from './usePushDevice';

/**
 * Offered after a meaningful moment (a submitted application). Separate from installing and from
 * the application's contact consent. Permission is requested only after "Enable notifications".
 * Nothing shows where notifications can't work, where they're already on or blocked (no nagging),
 * or for 30 days after "Not now".
 */
export function NotificationCard() {
  const device = usePushDevice();
  const [hidden, setHidden] = useState(isPushCardSnoozed);
  const [justEnabled, setJustEnabled] = useState(false);

  if (hidden || !device.serverEnabled || device.support.kind === 'unsupported') return null;
  const notNow = () => {
    snoozePushCard();
    setHidden(true);
  };

  const shell = (children: ReactNode) => (
    <section aria-labelledby="updates-card-heading" className="flex w-full max-w-[560px] flex-col gap-3 rounded-[14px] border border-line bg-white p-5">
      <h2 id="updates-card-heading" className="font-sans text-[17px] font-extrabold text-ink">
        Get programme updates
      </h2>
      {children}
    </section>
  );

  if (device.support.kind === 'install-required') {
    return shell(
      <>
        <p className="font-sans text-[14px] leading-[1.55] text-muted">
          On iPhone and iPad, notifications work in the School of Purpose app on your Home Screen (iOS or iPadOS 16.4 or later). Add it
          first, then turn on notifications there.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/install" className="inline-flex min-h-[44px] items-center rounded-full bg-brand px-5 font-sans text-[14px] font-bold text-white hover:bg-brand-hover">
            How to add it
          </Link>
          <Button tone="ghost" onClick={notNow}>
            Not now
          </Button>
        </div>
      </>,
    );
  }

  const { status } = device;
  if (justEnabled && status?.kind === 'enabled') {
    return shell(
      <p role="status" className="font-sans text-[14px] leading-[1.55] text-ink">
        Notifications are on for this device. You can change or turn them off in{' '}
        <Link to="/notifications" className="font-bold text-brand underline underline-offset-4">
          notification settings
        </Link>
        .
      </p>,
    );
  }
  if (!status || status.kind === 'enabled' || status.kind === 'denied') return null;

  return shell(
    <>
      <p className="font-sans text-[14px] leading-[1.55] text-muted">
        Receive important application and programme announcements. You can turn these off at any time.
      </p>
      {status.kind === 'failed' && (
        <p role="alert" className="font-sans text-[14px] font-semibold text-brand">
          Notifications couldn’t be turned on. Check your connection and try again.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          busy={device.busy}
          onClick={async () => {
            await device.enable(['general']);
            setJustEnabled(true);
          }}
        >
          Enable notifications
        </Button>
        <Button tone="ghost" onClick={notNow}>
          Not now
        </Button>
      </div>
    </>,
  );
}
