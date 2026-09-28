import imgVisualSide from '../../assets/landing/doctrine-study-group.webp';
import imgUnityPortrait from '../../assets/landing/vision-portrait.webp';
import { ABOUT_COPY, DOCTRINE, FAQ, FAQ_PREVIEW, JOURNEY } from '../../config/programme';
import { Eyebrow, MoreLink } from '../marketing/Chrome';
import { FaqContact, FaqList } from './Faq';

/*
 * Homepage previews: short versions of the dedicated pages. Each keeps the section id the old
 * in-page navigation used (#about, #programme, #journey, #faq), so existing links still land on
 * something useful. One responsive tree each; from 1280px laid out on the 1440px frame and
 * scaled with the desktop composition (.landing-scale).
 */

/** Large headings shouldn't break "purpose-driven" at its hyphen. */
function keepHyphenatedWords(text: string) {
  return text.split(/(\S+-\S+)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** #about: the purpose statement, Vision and Mission in brief. */
export function AboutPreview() {
  return (
    <section id="about" aria-labelledby="about-preview-heading" className="w-full bg-cream">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div
          data-reveal-group="(min-width: 1280px)"
          className="landing-gutter flex flex-col gap-[36px] py-[64px] xl:flex-row xl:items-center xl:gap-[80px] xl:px-[80px] xl:py-[96px]"
        >
          <div className="flex min-w-0 flex-1 flex-col items-start gap-[28px] xl:gap-[36px]">
            <div data-reveal="up" data-reveal-at="0" className="flex flex-col items-start gap-[14px]">
              <Eyebrow>School of Purpose · Vision &amp; Mission</Eyebrow>
              <h2 id="about-preview-heading" className="font-display text-[30px] leading-[1.08] text-brand xl:text-[40px] xl:tracking-[0.5px]">
                {keepHyphenatedWords(ABOUT_COPY.statement)}
              </h2>
            </div>
            <div data-reveal="up" data-reveal-at="140" className="grid w-full gap-[24px] md:grid-cols-2 md:gap-[32px]">
              {[
                ['Vision', ABOUT_COPY.vision],
                ['Mission', ABOUT_COPY.mission],
              ].map(([title, text]) => (
                <div key={title} className="flex flex-col items-start gap-[10px]">
                  <h3 className="font-display text-[24px] leading-[1.1] text-brand">{title}</h3>
                  <div aria-hidden="true" className="h-px w-[56px] bg-brand" />
                  <p className="font-sans text-[16px] font-medium leading-[1.55] text-ink xl:text-[17px]">{text}</p>
                </div>
              ))}
            </div>
            <div data-reveal="up" data-reveal-at="240">
              <MoreLink to="/about">About the School of Purpose</MoreLink>
            </div>
          </div>
          <div data-reveal="fade" data-reveal-at="80" className="relative hidden h-[520px] w-[440px] shrink-0 overflow-clip xl:block">
            <div className="absolute inset-0 bg-brand" />
            <img
              data-depth
              alt="A young woman arranging sticky notes on a planning wall"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
              src={imgUnityPortrait}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

/** #programme: the Doctrine of Purpose's three questions. */
export function ProgrammePreview() {
  return (
    <section id="programme" aria-labelledby="programme-preview-heading" className="on-dark w-full bg-brand">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div
          data-reveal-group="(min-width: 1280px)"
          className="landing-gutter flex flex-col gap-[32px] py-[64px] xl:flex-row xl:items-center xl:gap-[88px] xl:px-[80px] xl:py-[96px]"
        >
          <div data-reveal="settle" data-reveal-at="0" className="relative hidden h-[480px] w-[420px] shrink-0 rounded-[24px] xl:block">
            <img
              alt="Young adults studying together around a library table"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full rounded-[24px] object-cover"
              src={imgVisualSide}
            />
            <div className="absolute inset-0 rounded-[24px] bg-[rgba(132,29,38,0.2)]" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-start gap-[26px] xl:gap-[32px]">
            <div data-reveal="up" data-reveal-at="100" className="flex flex-col items-start gap-[14px]">
              <Eyebrow tone="dark">Covenant doctrine</Eyebrow>
              <h2 id="programme-preview-heading" className="font-display text-[34px] leading-[1.05] text-white xl:text-[48px]">
                The Doctrine of Purpose
              </h2>
              <p className="font-sans text-[15px] leading-[1.55] text-[rgba(243,240,230,0.8)] xl:text-[16px]">{DOCTRINE.intro}</p>
            </div>
            <ol className="flex w-full flex-col gap-[10px]">
              {DOCTRINE.questions.map((item, i) => (
                <li
                  key={item.n}
                  data-reveal="up"
                  data-reveal-at={200 + i * 60}
                  className="flex items-center gap-[14px] rounded-[14px] border border-white/10 bg-white/[0.06] px-[14px] py-[12px] xl:px-[18px] xl:py-[14px]"
                >
                  <span aria-hidden="true" className="flex size-[40px] shrink-0 items-center justify-center rounded-[10px] bg-[#5c1329] font-serif text-[16px] font-bold text-gold-light">
                    {item.n}
                  </span>
                  <span className="font-display text-[19px] leading-[1.15] tracking-[0.3px] text-white xl:text-[21px]">{item.q}</span>
                </li>
              ))}
            </ol>
            <div data-reveal="up" data-reveal-at="420">
              <MoreLink to="/programme" tone="dark">
                Explore the programme
              </MoreLink>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** #journey: the six stages at a glance; the full journey is its own page. */
export function JourneyPreview() {
  return (
    <section id="journey" aria-labelledby="journey-preview-heading" className="w-full bg-white">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div data-reveal-group="(min-width: 1280px)" className="landing-gutter flex flex-col gap-[28px] py-[64px] xl:gap-[40px] xl:px-[80px] xl:py-[96px]">
          <div data-reveal="up" data-reveal-at="0" className="flex flex-col gap-[12px] xl:flex-row xl:items-end xl:justify-between xl:gap-[48px]">
            <div className="flex flex-col gap-[12px]">
              <Eyebrow>Cohort formation pathway</Eyebrow>
              <h2 id="journey-preview-heading" className="font-display text-[34px] leading-[1.05] text-ink xl:text-[48px]">
                The Participant Journey
              </h2>
            </div>
            <p className="font-sans text-[14px] leading-[1.55] text-muted xl:max-w-[450px] xl:text-[16px]">
              A three-year formation pathway, from application to community.
            </p>
          </div>
          <ol className="grid w-full grid-cols-1 gap-[10px] sm:grid-cols-2 xl:grid-cols-6 xl:gap-[12px]">
            {JOURNEY.map((stage, i) => {
              const selected = Boolean(stage.condition);
              return (
                <li
                  key={stage.num}
                  data-reveal="up"
                  data-reveal-at={120 + i * 50}
                  className={`flex items-start gap-[12px] rounded-[14px] p-[14px] xl:flex-col xl:gap-[14px] xl:p-[18px] ${
                    selected ? 'bg-[#5c1329]' : 'border border-line bg-cream'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-[36px] shrink-0 items-center justify-center rounded-full font-serif text-[16px] font-bold lining-nums ${
                      selected ? 'bg-gold-light text-[#3b081a]' : 'bg-[#5c1329] text-gold-light'
                    }`}
                  >
                    {stage.num}
                  </span>
                  <span className="flex min-w-0 flex-col gap-[4px]">
                    <span className={`font-display text-[19px] leading-[1.1] ${selected ? 'text-white' : 'text-ink'}`}>
                      <span className="sr-only">Stage {stage.num}: </span>
                      {stage.name}
                    </span>
                    <span className={`font-sans text-[11px] font-bold uppercase leading-[1.4] tracking-[0.8px] ${selected ? 'text-gold-light' : 'text-brand'}`}>
                      {stage.meta[0]}
                    </span>
                    {stage.condition && <span className="font-sans text-[12px] font-semibold leading-[1.4] text-rose">{stage.condition}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          <div data-reveal="up" data-reveal-at="480">
            <MoreLink to="/journey">See the full journey</MoreLink>
          </div>
        </div>
      </div>
    </section>
  );
}

/** #faq: the three questions people ask first; every question is on the FAQ page. */
export function FaqPreview() {
  const entries = FAQ_PREVIEW.map((question) => FAQ.find((entry) => entry.question === question)!);
  return (
    <section id="faq" aria-labelledby="faq-preview-heading" className="w-full bg-cream">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        <div className="landing-gutter flex flex-col gap-[28px] py-[64px] xl:flex-row xl:gap-[80px] xl:px-[80px] xl:py-[96px]">
          <div data-reveal="up" className="flex flex-col items-start gap-[12px] xl:w-[380px] xl:shrink-0">
            <Eyebrow>Before you apply</Eyebrow>
            <h2 id="faq-preview-heading" className="font-display text-[34px] leading-[1.05] text-ink xl:text-[48px]">
              Frequently asked questions
            </h2>
            <p className="font-sans text-[14px] leading-[1.55] text-muted xl:text-[16px]">
              Short answers about eligibility, selection and what happens after you apply.
            </p>
            <FaqContact />
          </div>
          <div data-reveal="up" className="flex w-full min-w-0 flex-1 flex-col items-start gap-[12px]">
            <FaqList entries={entries} />
            <MoreLink to="/faq">See all questions</MoreLink>
          </div>
        </div>
      </div>
    </section>
  );
}
