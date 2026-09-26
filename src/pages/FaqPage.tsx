import { FaqContact, FaqList } from '../components/landing/Faq';
import { MoreLink } from '../components/marketing/Chrome';
import { ApplyBand, PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';
import { FAQ, FAQ_TOPICS } from '../config/programme';

/** /faq: every approved question, grouped by topic, each group linking to the page that says more. */
export default function FaqPage() {
  usePageTitle('FAQ');
  return (
    <>
      <PageIntro eyebrow="Before you apply" title="Frequently asked questions">
        <p>Short answers about applying, the programme and selection.</p>
      </PageIntro>
      <div className="w-full bg-cream">
        <div className="landing-scale mx-auto w-full max-w-[1440px]">
          <div className="landing-gutter flex flex-col gap-[48px] py-[56px] xl:gap-[64px] xl:px-[80px] xl:py-[88px]">
            {FAQ_TOPICS.map((group) => (
              <section
                key={group.topic}
                aria-labelledby={`faq-${group.topic}`}
                data-reveal="up"
                className="flex flex-col gap-[16px] xl:flex-row xl:gap-[80px]"
              >
                <h2
                  id={`faq-${group.topic}`}
                  className="text-balance font-display text-[28px] leading-[1.1] text-ink xl:w-[340px] xl:shrink-0 xl:pt-[12px] xl:text-[36px]"
                >
                  {group.title}
                </h2>
                <div className="flex min-w-0 flex-1 flex-col items-start gap-[8px]">
                  <FaqList entries={FAQ.filter((entry) => entry.topic === group.topic)} />
                  <MoreLink to={group.link.to}>{group.link.label}</MoreLink>
                </div>
              </section>
            ))}
            <FaqContact />
          </div>
        </div>
      </div>
      <ApplyBand secondary={{ to: '/journey', label: 'See the full journey' }} />
    </>
  );
}
