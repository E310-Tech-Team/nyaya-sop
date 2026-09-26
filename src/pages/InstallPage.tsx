import { useMemo, useState, type ReactNode } from 'react';
import { GUIDE_GROUPS, GUIDES, GuideSteps, InAppBrowserNotice } from '../components/InstallGuide';
import { PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';
import { currentPlatform, guideFor, promptInstall, useInstallState } from '../lib/install';

function Card({ title, children, labelledBy }: { title: string; children: ReactNode; labelledBy: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="flex flex-col gap-4 rounded-[16px] border border-line bg-white p-6 shadow-[0px_12px_30px_0px_rgba(45,9,20,0.05)] xl:p-8"
    >
      <h2 id={labelledBy} className="font-display text-[26px] leading-[1.1] text-ink xl:text-[30px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** What this device can do right now: already installed, a one-tap install, or the steps. */
function ThisDevice() {
  const install = useInstallState();
  const guide = useMemo(() => guideFor(currentPlatform()), []);
  const [outcome, setOutcome] = useState<'accepted' | 'dismissed' | null>(null);

  if (install.standalone) {
    return (
      <Card title="You’re using the app" labelledBy="device-heading">
        <p className="font-sans text-[15px] leading-[1.6] text-ink">
          School of Purpose is open in its own app window on this device. There’s nothing more to install.
        </p>
      </Card>
    );
  }
  if (install.installedHere || outcome === 'accepted') {
    return (
      <Card title="Installing" labelledBy="device-heading">
        <p role="status" className="font-sans text-[15px] leading-[1.6] text-ink">
          Your browser is adding School of Purpose. When it’s done, open it from your home screen or app list.
        </p>
      </Card>
    );
  }
  if (guide === 'in-app') {
    return (
      <Card title="Open this page in your browser first" labelledBy="device-heading">
        <InAppBrowserNotice />
      </Card>
    );
  }
  if (install.canPrompt) {
    return (
      <Card title="Install on this device" labelledBy="device-heading">
        <p className="font-sans text-[15px] leading-[1.6] text-ink">Your browser can add School of Purpose to this device in one step.</p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const result = await promptInstall();
              setOutcome(result === 'unavailable' ? null : result);
            }}
            className="motion-button min-h-[48px] cursor-pointer rounded-full bg-brand px-6 font-sans text-[15px] font-bold text-white hover:bg-brand-hover"
          >
            Install app
          </button>
        </div>
      </Card>
    );
  }
  return (
    <Card title="Install on this device" labelledBy="device-heading">
      <p className="-mt-2 font-sans text-[13px] font-extrabold uppercase tracking-[1.2px] text-brand">{GUIDES[guide].title}</p>
      {outcome === 'dismissed' && (
        <p role="status" className="font-sans text-[15px] text-muted">
          No problem. You can install it later from this page, or with the steps below.
        </p>
      )}
      <GuideSteps guide={guide} />
      <p className="font-sans text-[14px] leading-[1.6] text-muted">
        We suggest these steps from your browser’s name, which isn’t always right. If they don’t match your screen, choose your
        device below.
      </p>
    </Card>
  );
}

/** /install: optional installation, with honest benefits and steps for every major browser. */
export default function InstallPage() {
  usePageTitle('Install the app');
  const current = useMemo(() => guideFor(currentPlatform()), []);
  return (
    <>
      <PageIntro eyebrow="Optional" title="Install School of Purpose">
        <p>
          Keep School of Purpose on your home screen or with your apps, and open it like an app. Installing is optional: you can read
          about the programme, apply and follow your application in any browser.
        </p>
      </PageIntro>
      <div className="w-full bg-cream">
        <div className="landing-scale mx-auto w-full max-w-[1440px]">
          <div className="landing-gutter flex max-w-[920px] flex-col gap-[28px] py-[48px] xl:px-[80px] xl:py-[72px]">
            <ThisDevice />

            <Card title="What installing gives you" labelledBy="benefits-heading">
              <ul className="flex list-disc flex-col gap-2 pl-6 font-sans text-[15px] leading-[1.6] text-ink">
                <li>Its own icon on your home screen or with your apps, so it’s easy to find again.</li>
                <li>It opens in its own window, without the browser’s address bar.</li>
                <li>Pages you’ve opened before still load when your connection is weak or gone.</li>
                <li>On iPhone and iPad, it’s the only way to get School of Purpose notifications (iOS or iPadOS 16.4 or later).</li>
              </ul>
              <p className="font-sans text-[15px] leading-[1.6] text-muted">
                It’s the same website, with the same information and application form. Sending an application, signing in and seeing
                your application status still need a connection. It uses very little storage, and you can remove it at any time.
              </p>
            </Card>

            <section aria-labelledby="devices-heading" className="flex flex-col gap-4">
              <h2 id="devices-heading" className="font-display text-[26px] leading-[1.1] text-ink xl:text-[30px]">
                Steps for other devices
              </h2>
              {GUIDE_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-2">
                  <h3 className="font-sans text-[13px] font-extrabold uppercase tracking-[1.4px] text-brand">{group.label}</h3>
                  {group.guides
                    .filter((guide) => guide !== current)
                    .map((guide) => (
                      <details key={guide} className="group rounded-[12px] border border-line bg-white px-5 py-3 open:pb-5">
                        <summary className="min-h-[36px] cursor-pointer py-1 font-sans text-[15px] font-bold text-ink marker:text-brand">
                          {GUIDES[guide].title}
                        </summary>
                        <div className="pt-3">
                          <GuideSteps guide={guide} />
                        </div>
                      </details>
                    ))}
                </div>
              ))}
            </section>

            <Card title="Good to know" labelledBy="notes-heading">
              <ul className="flex list-disc flex-col gap-2 pl-6 font-sans text-[15px] leading-[1.6] text-ink">
                <li>
                  We can’t always tell whether School of Purpose is already installed on this device. If you’ve installed it, open it from
                  your home screen or app list.
                </li>
                <li>
                  To remove it from a phone or tablet, press and hold its icon and choose Remove or Uninstall. On a computer, open the app
                  and use its menu to uninstall it.
                </li>
                <li>Installing doesn’t turn on notifications. You choose those separately, and can turn them off at any time.</li>
              </ul>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
