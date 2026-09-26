import { NotificationSettings } from '../components/notifications/NotificationSettings';
import { PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';
import { useAccount } from '../lib/account';

/** /notifications: this device's notification settings, for anyone (no account needed for announcements). */
export default function NotificationsPage() {
  usePageTitle('Notifications');
  const account = useAccount();
  return (
    <>
      <PageIntro eyebrow="This device" title="Notifications">
        <p>Choose what School of Purpose may notify you about on this device, or turn notifications off. It’s optional and separate from your application.</p>
      </PageIntro>
      <div className="w-full bg-cream">
        <div className="landing-scale mx-auto w-full max-w-[1440px]">
          <div className="landing-gutter max-w-[820px] py-[48px] xl:px-[80px] xl:py-[72px]">
            <div className="rounded-[16px] border border-line bg-white p-6 xl:p-8">
              <NotificationSettings signedIn={account.status === 'signed-in'} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
