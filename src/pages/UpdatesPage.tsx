import { Link } from 'react-router';
import { PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';
import { LoadError, Loading, when } from '../components/ui';
import { apiRequest } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import type { Announcement } from '../shared/platform';

/** /updates: public announcements published by the Programme team (newest first). */
export default function UpdatesPage() {
  usePageTitle('Programme updates');
  const { data, error, reload } = useAsync((signal) => apiRequest<{ items: Announcement[] }>('/announcements', { signal }), []);
  return (
    <>
      <PageIntro eyebrow="News" title="Programme updates">
        <p>Announcements from the School of Purpose team.</p>
      </PageIntro>
      <div className="w-full bg-cream">
        <div className="landing-scale mx-auto w-full max-w-[1440px]">
          <div className="landing-gutter flex max-w-[820px] flex-col gap-5 py-[48px] xl:px-[80px] xl:py-[72px]">
            {error ? (
              <LoadError error={error} onRetry={reload} />
            ) : !data ? (
              <Loading />
            ) : data.items.length === 0 ? (
              <p className="font-sans text-[16px] text-muted">There are no announcements yet.</p>
            ) : (
              data.items.map((item) => (
                <article key={item.id} className="flex flex-col gap-2 rounded-[16px] border border-line bg-white p-6">
                  <h2 className="font-sans text-[20px] font-bold leading-[1.3] text-ink">{item.title}</h2>
                  <p className="font-sans text-[13px] text-muted">{when(item.publishedAt)}</p>
                  <p className="whitespace-pre-line font-sans text-[15px] leading-[1.65] text-ink">{item.body}</p>
                </article>
              ))
            )}
            <p className="font-sans text-[15px] text-muted">
              Want these on your phone?{' '}
              <Link to="/notifications" className="font-bold text-brand underline underline-offset-4">
                Turn on notifications
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
