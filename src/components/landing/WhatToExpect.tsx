import { Link } from 'react-router';
import { WHAT_TO_EXPECT } from '../../config/programme';

/**
 * Practical summary between the hero and the editorial sections. One responsive tree for
 * every width (no hidden duplicate); from 1280px it is laid out on the 1440px frame and
 * scaled with the rest of the desktop composition (.landing-scale).
 */
export function WhatToExpect() {
  return (
    <section id="what-to-expect" aria-labelledby="what-to-expect-heading" className="w-full bg-white">
      <div className="landing-scale mx-auto w-full max-w-[1440px]">
        {/* From 1280px the section plays as one group: heading and description together, then
            the cards in a short stagger. Narrower screens reveal each card as it arrives. */}
        <div
          data-reveal-group="(min-width: 1280px)"
          className="landing-gutter flex flex-col gap-[28px] py-[64px] xl:gap-[40px] xl:px-[80px] xl:py-[96px]"
        >
          <div data-reveal="up" data-reveal-at="0" className="flex flex-col gap-[12px] xl:flex-row xl:items-end xl:justify-between xl:gap-[48px]">
            <div className="flex flex-col gap-[12px]">
              <div className="flex items-center gap-[10px] xl:gap-[16px]">
                <div data-reveal="rule-x" data-reveal-at="140" className="h-[1.5px] w-[32px] shrink-0 bg-brand xl:w-[40px]" />
                <p className="font-sans text-[11px] font-bold uppercase tracking-[1.8px] text-brand xl:text-[12px] xl:tracking-[3px]">
                  The programme at a glance
                </p>
              </div>
              <h2 id="what-to-expect-heading" className="font-display text-[38px] leading-[1.05] text-ink xl:text-[48px]">
                What to expect
              </h2>
            </div>
            <p className="font-sans text-[14px] leading-[1.55] text-muted xl:max-w-[450px] xl:text-[16px]">
              A three-year formation pathway. Here is how it unfolds, and which parts depend on selection.
            </p>
          </div>

          <ol className="grid w-full grid-cols-1 gap-[12px] sm:grid-cols-2 xl:grid-cols-4 xl:gap-[16px]">
            {WHAT_TO_EXPECT.map((item, index) => (
              <li
                key={item.title}
                data-reveal="up"
                data-reveal-at={140 + index * 60}
                className={`flex flex-col gap-[10px] rounded-[16px] p-[20px] xl:p-[26px] ${
                  item.conditional ? 'bg-[#5c1329]' : 'border border-line bg-cream'
                }`}
              >
                <p
                  className={`self-start rounded-full px-[10px] py-[4px] font-sans text-[11px] font-extrabold uppercase tracking-[1px] ${
                    item.conditional ? 'bg-gold-light text-[#3b081a]' : 'bg-rose text-brand'
                  }`}
                >
                  {item.when}
                </p>
                <h3 className={`font-display text-[24px] leading-[1.1] ${item.conditional ? 'text-white' : 'text-ink'}`}>
                  {item.title}
                </h3>
                <p className={`font-sans text-[13px] font-bold leading-[1.4] ${item.conditional ? 'text-gold-light' : 'text-brand'}`}>
                  {item.facts}
                </p>
                <p className={`font-sans text-[14px] leading-[1.55] ${item.conditional ? 'text-[rgba(247,243,235,0.85)]' : 'text-muted'}`}>
                  {item.body}
                </p>
              </li>
            ))}
          </ol>

          <div data-reveal="up" data-reveal-at="420" className="flex flex-col gap-[16px] md:flex-row md:items-center md:justify-between md:gap-[32px]">
            <p className="flex items-start gap-[10px] font-sans text-[14px] leading-[1.5] text-ink xl:text-[15px]">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-[1px] size-[18px] shrink-0 fill-brand">
                <path d="M10 1a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-.9 4.5h1.8v1.8H9.1V5.5Zm0 3.6h1.8v5.4H9.1V9.1Z" />
              </svg>
              <span>
                <strong className="font-bold">Applying doesn’t guarantee a place at the boot camp.</strong> Selection is merit-based,
                and sponsorship covers selected participants only.
              </span>
            </p>
            <Link
              to="/journey"
              className="inline-flex min-h-[44px] shrink-0 items-center gap-[8px] self-start font-sans text-[14px] font-bold text-brand underline decoration-brand/30 underline-offset-4 transition-colors hover:decoration-brand md:self-auto"
            >
              See the full journey <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
