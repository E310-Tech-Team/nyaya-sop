import { Link } from 'react-router';
import imgArrowRight2 from '../../assets/landing/arrow-right-cream-sm.svg';

/** The homepage's closing invitation: Isaiah 58:12, then the application. */
export function ClosingInvitation() {
  return (
    <>
      {/* ── FINAL CTA ── */}
      <section aria-label="Apply" className="on-dark bg-[#8b1e3f] min-h-[480px] xl:h-[667px] overflow-clip relative shrink-0 w-full">
        {/* REPAIRER background text — anchored relative to centre */}
        <p
          aria-hidden="true"
          className="absolute font-serif font-bold text-[220px] text-[rgba(244,239,230,0.04)] tracking-[-8.8px] whitespace-nowrap"
          style={{ lineHeight: '220px', bottom: -40, left: '50%', transform: 'translateX(-50%)' }}
        >REPAIRER</p>

        {/* The quotation arrives as one, then its citation, then the invitation. */}
        <div data-reveal-group="" className="relative max-w-[1440px] mx-auto px-6 sm:px-10 xl:px-[80px] pb-[72px] xl:pb-0">
          <figure>
          <blockquote data-reveal="up" data-reveal-at="0" data-reveal-tempo="feature" className="flex flex-col items-start max-w-[900px] pt-[60px] xl:pt-[85px]">
            <p
              className="font-serif font-light italic text-[#f4efe6] text-[48px] xl:text-[96px] tracking-[-1px] xl:tracking-[-1.92px]"
              style={{ lineHeight: '1.1' }}
            >{`"Thou shalt be called,`}</p>
            <p
              className="font-serif font-bold text-[#f4efe6] text-[48px] xl:text-[96px] tracking-[-1px] xl:tracking-[-1.92px] w-full xl:w-[900px]"
              style={{ lineHeight: '1.1' }}
            >{`the repairer of the breach."`}</p>
          </blockquote>
          <figcaption data-reveal="up" data-reveal-at="220" className="flex gap-[16px] items-center py-[32px]">
            <span aria-hidden="true" className="bg-[#b8962e] h-px w-[40px]" />
            <span className="font-sans font-normal text-[#f4efe6] text-[13px] tracking-[1.3px] uppercase">Isaiah 58:12, KJV</span>
          </figcaption>
          </figure>
          <div data-reveal="up" data-reveal-at="360">
            <Link
              to="/apply"
              className="motion-button bg-[#f7f3eb] cursor-pointer inline-flex gap-[12px] items-center px-[36px] py-[16px] rounded-[32px] hover:bg-white"
            >
              <span className="font-sans font-bold leading-normal not-italic text-[#8b1e3f] text-[15px] whitespace-nowrap">Start my application</span>
              <span aria-hidden="true" className="motion-arrow bg-[#8b1e3f] flex flex-col items-center justify-center rounded-[999px] size-[24px]">
                <img alt="" className="block max-w-none size-[12px]" src={imgArrowRight2} />
              </span>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
