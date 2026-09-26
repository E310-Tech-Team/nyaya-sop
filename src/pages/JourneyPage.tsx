import { JourneySection } from '../components/landing/JourneySection';
import { ApplyBand, PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';

/** /journey: the six stages in order, with applying and being selected told apart up front. */
export default function JourneyPage() {
  usePageTitle('Journey');
  return (
    <>
      <PageIntro eyebrow="Cohort formation pathway" title="The Participant Journey">
        <p>A three-year formation pathway in six stages, from application to community.</p>
        <dl className="mt-[10px] grid gap-[14px] border-t border-white/15 pt-[18px] sm:grid-cols-2 sm:gap-[28px] xl:mt-[14px] xl:pt-[22px]">
          <div className="flex flex-col gap-[6px]">
            <dt className="font-sans text-[11px] font-bold uppercase tracking-[1.6px] text-gold-light xl:text-[12px]">Applying</dt>
            <dd className="text-[14px] leading-[1.55] text-rose xl:text-[16px]">
              Open to RCCG members aged 18–30. The Programme team reviews every application.
            </dd>
          </div>
          <div className="flex flex-col gap-[6px]">
            <dt className="font-sans text-[11px] font-bold uppercase tracking-[1.6px] text-gold-light xl:text-[12px]">Being selected</dt>
            <dd className="text-[14px] leading-[1.55] text-rose xl:text-[16px]">
              Selection for the physical boot camp is merit-based, and sponsorship applies to selected participants only.
              Applying does not guarantee a place.
            </dd>
          </div>
        </dl>
      </PageIntro>
      <JourneySection />
      <ApplyBand secondary={{ to: '/faq', label: 'Read the FAQ' }} />
    </>
  );
}
