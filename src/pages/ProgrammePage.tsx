import { Doctrine } from '../components/landing/Doctrine';
import { JOURNEY_ART, StageMeta } from '../components/landing/JourneySection';
import { Eyebrow, MoreLink } from '../components/marketing/Chrome';
import { ApplyBand, PageIntro } from '../components/marketing/PageParts';
import { usePageTitle } from '../components/RouteEffects';
import { EDITION, HERO_COPY, PROGRAMME_PHASES, SELECTED_ONLY, type ProgrammePhase } from '../config/programme';
import { site } from '../config/site';

/** /programme: Purpose Boot Camp, the Doctrine of Purpose, and how the programme runs. */
export default function ProgrammePage() {
  usePageTitle('Programme');
  return (
    <>
      <PageIntro eyebrow={`${EDITION.label} · ${EDITION.name}`} title={site.programme}>
        <p>{HERO_COPY.summary}</p>
        <p>{EDITION.tagline}</p>
      </PageIntro>
      <Doctrine />
      <ProgrammeStructure />
      <ApplyBand secondary={{ to: '/journey', label: 'See the full journey' }} />
    </>
  );
}

/** Which journey photograph illustrates each part of the programme. */
const PHASE_ART: Record<ProgrammePhase['key'], number> = { training: 1, selection: 2, bootcamp: 3, community: 4 };

/** Virtual training, merit selection, the boot camp (selected participants only), then mentorship and community. */
function ProgrammeStructure() {
  return (
    <section aria-labelledby="structure-heading" className="w-full bg-white">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div
          data-reveal-group="(min-width: 1280px)"
          className="landing-gutter flex flex-col gap-[28px] py-[64px] xl:gap-[40px] xl:px-[80px] xl:py-[96px]"
        >
          <div data-reveal="up" data-reveal-at="0" className="flex flex-col gap-[12px] xl:flex-row xl:items-end xl:justify-between xl:gap-[48px]">
            <div className="flex flex-col items-start gap-[12px]">
              <Eyebrow>Format and commitments</Eyebrow>
              <h2 id="structure-heading" className="font-display text-[34px] leading-[1.05] text-ink xl:text-[48px]">
                How the programme runs
              </h2>
            </div>
            <p className="font-sans text-[15px] leading-[1.55] text-muted xl:max-w-[450px] xl:text-[16px]">
              A three-year formation pathway. Here is how it unfolds, and which parts depend on selection.
            </p>
          </div>

          <ol className="grid w-full grid-cols-1 gap-[14px] md:grid-cols-2 xl:gap-[20px]">
            {PROGRAMME_PHASES.map((phase, index) => {
              const art = JOURNEY_ART[PHASE_ART[phase.key]];
              const dark = Boolean(phase.conditional);
              return (
                <li
                  key={phase.key}
                  data-reveal="up"
                  data-reveal-at={140 + index * 60}
                  className={`flex flex-col overflow-clip rounded-[20px] ${dark ? 'on-dark bg-[#5c1329]' : 'border border-line bg-cream'}`}
                >
                  <div className="relative h-[168px] shrink-0 overflow-clip sm:h-[200px] xl:h-[240px]">
                    <img data-depth alt={art.alt} loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" src={art.img} />
                    {dark && (
                      <p className="absolute left-[16px] top-[16px] rounded-full bg-gold-light px-[12px] py-[5px] font-sans text-[11px] font-extrabold uppercase tracking-[0.8px] text-[#3b081a]">
                        {SELECTED_ONLY}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col items-start gap-[10px] p-[20px] xl:p-[28px]">
                    <p
                      className={`rounded-full px-[10px] py-[4px] font-sans text-[11px] font-extrabold uppercase tracking-[1px] ${
                        dark ? 'bg-gold-light text-[#3b081a]' : 'bg-rose text-brand'
                      }`}
                    >
                      {phase.when}
                    </p>
                    <h3 className={`font-display text-[26px] leading-[1.08] xl:text-[30px] ${dark ? 'text-white' : 'text-ink'}`}>{phase.title}</h3>
                    <StageMeta
                      items={phase.facts}
                      className={`font-sans text-[11px] font-bold uppercase leading-[1.45] tracking-[0.9px] xl:text-[12px] ${dark ? 'text-gold-light' : 'text-brand'}`}
                    />
                    <p className={`font-sans text-[15px] leading-[1.6] ${dark ? 'text-[rgba(247,243,235,0.88)]' : 'text-ink'}`}>{phase.body}</p>
                    {phase.next && (
                      <p className={`mt-auto flex items-start gap-[6px] pt-[4px] font-sans text-[13px] font-semibold leading-[1.45] ${dark ? 'text-rose' : 'text-muted'}`}>
                        <span aria-hidden="true" className={dark ? '' : 'text-brand'}>
                          →
                        </span>
                        {phase.next}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          <div data-reveal="up" data-reveal-at="420">
            <MoreLink to="/journey">See the full journey, stage by stage</MoreLink>
          </div>
        </div>
      </div>
    </section>
  );
}
