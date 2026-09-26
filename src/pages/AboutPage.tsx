import { Blueprint } from '../components/landing/Blueprint';
import { VisionMission } from '../components/landing/VisionMission';
import { Eyebrow } from '../components/marketing/Chrome';
import { ApplyBand, PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';
import { ABOUT_COPY } from '../config/programme';

/** /about: who the School of Purpose is, its vision and mission, who it serves, the Blueprint. */
export default function AboutPage() {
  usePageTitle('About');
  return (
    <>
      <PageIntro eyebrow={ABOUT_COPY.organisation} title="About the School of Purpose">
        <p>{ABOUT_COPY.calling}</p>
      </PageIntro>
      <VisionMission />
      <WhoItServes />
      <Blueprint />
      <ApplyBand secondary={{ to: '/programme', label: 'Explore the programme' }} />
    </>
  );
}

/** Eligibility and the three spheres the programme prepares people for. */
function WhoItServes() {
  return (
    <section aria-labelledby="who-heading" className="w-full bg-white">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div
          data-reveal-group="(min-width: 1280px)"
          className="landing-gutter flex flex-col gap-[28px] py-[64px] xl:gap-[40px] xl:px-[80px] xl:py-[96px]"
        >
          <div data-reveal="up" data-reveal-at="0" className="flex flex-col gap-[12px] xl:flex-row xl:items-end xl:justify-between xl:gap-[48px]">
            <div className="flex flex-col items-start gap-[12px]">
              <Eyebrow>Who it’s for</Eyebrow>
              <h2 id="who-heading" className="font-display text-[34px] leading-[1.05] text-ink xl:text-[48px]">
                Who the programme serves
              </h2>
            </div>
            <div className="flex flex-col gap-[10px] font-sans text-[15px] leading-[1.55] xl:max-w-[520px] xl:text-[17px]">
              <p className="font-semibold text-ink">RCCG members aged 18–30: young adults and youth.</p>
              <p className="text-muted">
                Purpose Boot Camp prepares them to lead with Kingdom impact in three spheres. You confirm your eligibility at
                the start of the application.
              </p>
            </div>
          </div>
          <ul className="grid w-full grid-cols-1 gap-[12px] sm:grid-cols-3 xl:gap-[16px]">
            {ABOUT_COPY.spheres.map((sphere, index) => (
              <li
                key={sphere}
                data-reveal="up"
                data-reveal-at={140 + index * 60}
                className="flex flex-col gap-[14px] rounded-[16px] border border-line bg-cream p-[20px] xl:gap-[18px] xl:p-[28px]"
              >
                <span aria-hidden="true" className="h-[1.5px] w-[32px] bg-brand" />
                <span className="font-display text-[26px] leading-[1.08] text-brand xl:text-[34px]">{sphere}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
