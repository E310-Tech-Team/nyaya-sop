import imgPhoto from '../../assets/landing/journey-01-apply.webp';
import imgPhoto2 from '../../assets/landing/journey-02-virtual-training.webp';
import imgPhoto1 from '../../assets/landing/journey-03-merit-selection.webp';
import imgPhoto3 from '../../assets/landing/journey-04-boot-camp.webp';
import imgPhoto4 from '../../assets/landing/journey-05-mentorship.webp';
import imgPhoto5 from '../../assets/landing/journey-06-community.webp';
import img0102 from '../../assets/landing/route-01-02.svg';
import img0102ep from '../../assets/landing/route-endpoint-a.svg';
import img0203a from '../../assets/landing/route-02-03-a.svg';
import img0203b from '../../assets/landing/route-02-03-b.svg';
import img0203ep from '../../assets/landing/route-endpoint-b.svg';
import img0304a from '../../assets/landing/route-03-04-a.svg';
import img0304b from '../../assets/landing/route-03-04-b.svg';
import img0304ep from '../../assets/landing/route-endpoint-c.svg';
import img0405 from '../../assets/landing/route-04-05.svg';
import img0506a from '../../assets/landing/route-05-06-a.svg';
import img0506b from '../../assets/landing/route-05-06-b.svg';
import { JOURNEY } from '../../config/programme';

/**
 * Artwork and positions for the desktop journey cascade; the words come from JOURNEY. The photos
 * are AI-generated (docs/IMAGERY.md); `focus` keeps faces in view in the wide card crops.
 */
export const JOURNEY_ART = [
  { img: imgPhoto, alt: 'A young woman working on a laptop at a desk at home', focus: '50% 10%', left: 10, top: 40 },
  { img: imgPhoto2, alt: 'A young man in headphones taking notes during an online session', focus: '50% 15%', left: 450, top: 0 },
  { img: imgPhoto1, alt: 'Two young professionals writing in notebooks at a library table', focus: '50% 15%', left: 890, top: 51 },
  { img: imgPhoto3, alt: 'Five young adults working through a planning exercise at a workshop table', focus: '50% 50%', left: 890, top: 490 },
  { img: imgPhoto4, alt: 'An experienced mentor talking with two young professionals who are taking notes', focus: '50% 15%', left: 450, top: 450 },
  { img: imgPhoto5, alt: 'Young professionals talking in small groups in a courtyard', focus: '50% 10%', left: 10, top: 500 },
];

/** A journey stage's duration/format facts; lines only wrap between facts. */
export function StageMeta({ items, className }: { items: readonly string[]; className: string }) {
  return (
    <p className={className}>
      {items.map((item, i) => {
        const more = i < items.length - 1;
        return (
          <span key={item}>
            <span className="whitespace-nowrap">
              {item}
              {more && ' ·'}
            </span>
            {more && ' '}
          </span>
        );
      })}
    </p>
  );
}

/**
 * The six stages on the Journey page: a vertical timeline below 1280px, the illustrated cascade
 * (1440px composition, route lines drawn per stage) from 1280px. The page intro carries the
 * page heading, so each stage is a second-level heading.
 */
export function JourneySection({ id = 'stages' }: { id?: string }) {
  return (
    <section id={id} aria-label="The six stages" className="w-full">
    {/* ── MOBILE JOURNEY ── */}
    <div className="landing-gutter bg-[#f3f0e6] flex flex-col gap-[34px] items-start pb-[64px] pt-[44px] w-full xl:hidden">
      {/* Compact vertical timeline: number + name, duration/format, what happens, how people move on. */}
      <ol className="flex flex-col items-start w-full">
        {JOURNEY.map((stage, idx) => {
          const last = idx === JOURNEY.length - 1;
          return (
            <li data-reveal="up" key={stage.num} className="flex gap-[14px] items-stretch w-full">
              <div aria-hidden="true" className="flex flex-col items-center shrink-0 w-[36px]">
                <span className="bg-[#5c1329] flex items-center justify-center rounded-full shrink-0 size-[36px] font-serif font-bold lining-nums text-[#dcc28a] text-[16px]">
                  {stage.num}
                </span>
                {!last && <span className="bg-[#841d26] flex-1 my-[6px] opacity-25 w-px" />}
              </div>
              <div className={`flex flex-col flex-1 gap-[6px] items-start min-w-0 pt-[5px] ${last ? '' : 'pb-[26px]'}`}>
                <h2 className="font-display leading-[1.1] text-[#202124] text-[22px]">
                  <span className="sr-only">Stage {stage.num}: </span>
                  {stage.name}
                </h2>
                <StageMeta items={stage.meta} className="font-sans font-bold leading-[1.45] text-[#841d26] text-[11px] tracking-[0.9px] uppercase" />
                {stage.condition && (
                  <p className="bg-[#5c1329] font-sans font-extrabold leading-[1.3] px-[10px] py-[4px] rounded-full text-[#dcc28a] text-[11px] tracking-[0.6px] uppercase">
                    {stage.condition}
                  </p>
                )}
                <p className="font-sans font-normal leading-[1.5] text-[#202124] text-[14px] w-full">{stage.body}</p>
                {stage.next && (
                  <p className="flex gap-[6px] items-start font-sans font-semibold leading-[1.45] text-[#665d60] text-[13px]">
                    <span aria-hidden="true" className="text-[#841d26]">→</span>
                    {stage.next}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>

    {/* ── JOURNEY CASCADE (desktop) ── */}
    <div className="landing-desktop bg-[#f3f0e6] w-full shrink-0 hidden xl:block">
      {/* The cascade was drawn under a 160px section header; the page intro replaces that
          header, so the drawing is lifted by 160px inside a shorter frame. */}
      <div className="h-[1108px] overflow-clip relative max-w-[1440px] mx-auto">
      <div className="absolute inset-x-0 top-[-160px] h-[1268px]">
        {/* Route lines: each draws in the direction of travel just after its stage appears
            (they are <img> artwork, so a clip wipe rather than stroke drawing). */}
        <div className="absolute h-[1220px] left-0 top-0 w-full">
          <div data-reveal="wipe-right" data-reveal-with="journey-02" data-reveal-at="160" className="absolute h-[44px] left-[470px] top-[350px] w-[60px]">
            <div className="absolute" style={{ inset: '-2.25% -1.67%' }}>
              <img alt="" className="block max-w-none size-full" src={img0102} />
            </div>
          </div>
          <div data-reveal="fade" data-reveal-with="journey-02" data-reveal-at="640" className="absolute left-[525px] size-[9px] top-[355px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={img0102ep} />
          </div>
          <div data-reveal="wipe-right" data-reveal-with="journey-03" data-reveal-at="160" className="absolute h-[164px] left-[910px] top-[197px] w-[314px]">
            <div className="absolute" style={{ inset: '-0.56% -0.32% -0.61% -0.32%' }}>
              <img alt="" className="block max-w-none size-full" src={img0203a} />
            </div>
          </div>
          <div data-reveal="wipe-right" data-reveal-with="journey-02" data-reveal-at="160" className="absolute h-[143px] left-[332px] top-[200px] w-[303px]">
            <div className="absolute" style={{ inset: '-0.68% -0.33% -0.7% -0.33%' }}>
              <img alt="" className="block max-w-none size-full" src={img0203b} />
            </div>
          </div>
          <div data-reveal="wipe-left" data-reveal-with="journey-06" data-reveal-at="160" className="absolute flex h-[143px] items-center justify-center left-[406px] top-[1065px] w-[303px]">
            <div className="flex-none" style={{ transform: 'scaleY(-1)' }}>
              <div className="h-[143px] relative w-[303px]">
                <div className="absolute" style={{ inset: '-0.68% -0.33% -0.7% -0.33%' }}>
                  <img alt="" className="block max-w-none size-full" src={img0203b} />
                </div>
              </div>
            </div>
          </div>
          <div data-reveal="wipe-left" data-reveal-with="journey-05" data-reveal-at="160" className="absolute flex h-[143px] items-center justify-center left-[844px] top-[1050px] w-[303px]">
            <div className="flex-none" style={{ transform: 'scaleY(-1)' }}>
              <div className="h-[143px] relative w-[303px]">
                <div className="absolute" style={{ inset: '-0.68% -0.33% -0.7% -0.33%' }}>
                  <img alt="" className="block max-w-none size-full" src={img0203b} />
                </div>
              </div>
            </div>
          </div>
          <div data-reveal="fade" data-reveal-with="journey-03" data-reveal-at="640" className="absolute left-[965px] size-[10px] top-[395px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={img0203ep} />
          </div>
          <div data-reveal="wipe-down" data-reveal-with="journey-04" data-reveal-at="160" className="absolute h-[600px] left-[1185px] top-[482px] w-[205px]">
            <div className="absolute" style={{ inset: '-0.17% -0.49%' }}>
              <img alt="" className="block max-w-none size-full" src={img0304a} />
            </div>
          </div>
          <div data-reveal="wipe-down" data-reveal-with="journey-04" data-reveal-at="160" className="absolute flex h-[295px] items-center justify-center left-[1185px] top-[395px] w-[205px]">
            <div className="flex-none" style={{ transform: 'scaleY(-1)' }}>
              <div className="h-[295px] relative w-[205px]">
                <div className="absolute" style={{ inset: '-0.34% -0.49%' }}>
                  <img alt="" className="block max-w-none size-full" src={img0304b} />
                </div>
              </div>
            </div>
          </div>
          <div data-reveal="fade" data-reveal-with="journey-06" data-reveal-at="640" className="absolute left-[84px] size-[11px] top-[814px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={img0304ep} />
          </div>
          <div data-reveal="wipe-right" data-reveal-with="journey-03" data-reveal-at="160" className="absolute h-[44px] left-[906px] top-[388px] w-[60px]">
            <div className="absolute" style={{ inset: '-2.26% -1.67%' }}>
              <img alt="" className="block max-w-none size-full" src={img0405} />
            </div>
          </div>
          <div data-reveal="fade" data-reveal-with="journey-06" data-reveal-at="640" className="absolute left-[524px] size-[9px] top-[844px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={img0102ep} />
          </div>
          <div data-reveal="wipe-left" data-reveal-with="journey-05" data-reveal-at="160" className="absolute h-[78px] left-[910px] top-[820px] w-[60px]">
            <div className="absolute" style={{ inset: '-1.28% -1.67% -1.21% -1.67%' }}>
              <img alt="" className="block max-w-none size-full" src={img0506a} />
            </div>
          </div>
          <div data-reveal="wipe-left" data-reveal-with="journey-06" data-reveal-at="160" className="absolute h-[78px] left-[455px] top-[789px] w-[80px]">
            <div className="absolute" style={{ inset: '-1.28% -1.25%' }}>
              <img alt="" className="block max-w-none size-full" src={img0506b} />
            </div>
          </div>
          <div data-reveal="fade" data-reveal-with="journey-05" data-reveal-at="640" className="absolute left-[965px] size-[10px] top-[875px]">
            <img alt="" className="absolute block inset-0 max-w-none size-full" src={img0203ep} />
          </div>
        </div>


        {/* Same card positions and sizes as the design (the route lines join their edges); the
            photo is shorter so each card can carry number + name, duration/format, what happens
            and how people move on. DOM order is the reading order 01 → 06. */}
        <ol className="absolute h-[960px] left-[80px] top-[228px] right-[80px]">
          {JOURNEY.map((stage, idx) => {
            const { img, alt, focus, left, top } = JOURNEY_ART[idx];
            return (
              <li
                key={stage.num}
                data-reveal="up"
                data-reveal-tempo="feature"
                data-reveal-id={`journey-${stage.num}`}
                className="absolute bg-[#5c1329] flex flex-col h-[430px] items-start overflow-clip rounded-[20px] shadow-[0px_12px_24px_0px_rgba(0,0,0,0.15)] w-[380px]"
                style={{ left, top }}
              >
                <div className="h-[196px] overflow-clip relative shrink-0 w-full">
                  <img data-depth alt={alt} loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" style={{ objectPosition: focus }} src={img} />
                  {stage.condition && (
                    <p className="absolute bg-[#dcc28a] font-sans font-extrabold left-[16px] px-[12px] py-[5px] rounded-full text-[#3b081a] text-[11px] top-[16px] tracking-[0.8px] uppercase">
                      {stage.condition}
                    </p>
                  )}
                </div>
                <div className="flex flex-col flex-1 gap-[8px] items-start min-h-px px-[24px] pb-[20px] pt-[16px] w-full">
                  <div className="flex items-center justify-between w-full">
                    <p aria-hidden="true" className="font-serif font-bold leading-none text-[#dcc28a] text-[30px]">{stage.num}</p>
                    <h2 className="font-sans font-bold leading-normal not-italic text-[#f3f0e6] text-[18px]">
                      <span className="sr-only">Stage {stage.num}: </span>
                      {stage.name}
                    </h2>
                  </div>
                  <StageMeta items={stage.meta} className="font-sans font-bold leading-[1.45] text-[#dcc28a] text-[11px] tracking-[0.9px] uppercase" />
                  <p className="font-sans font-normal leading-[1.5] not-italic text-[14px] text-[rgba(243,240,230,0.85)] w-full">{stage.body}</p>
                  {stage.next && (
                    <p className="flex gap-[6px] items-start mt-auto font-sans font-semibold leading-[1.45] text-[#f3dce3] text-[13px]">
                      <span aria-hidden="true">→</span>
                      {stage.next}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      </div>
    </div>
    </section>
  );
}
