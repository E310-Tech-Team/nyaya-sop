import { Link } from 'react-router';
import imgArrowRight2 from '../../assets/landing/arrow-right-cream-sm.svg';
import imgVisualSide from '../../assets/landing/doctrine-study-group.webp';
import { DOCTRINE } from '../../config/programme';

/** The Doctrine of Purpose and its three questions (phone/tablet and desktop trees). */
export function Doctrine({ id = 'doctrine' }: { id?: string }) {
  return (
    <section id={id} aria-label="The Doctrine of Purpose" className="w-full">
    {/* ── MOBILE DOCTRINE ── */}
    <div className="on-dark landing-gutter bg-[#841d26] flex flex-col gap-[30px] items-start py-[72px] w-full xl:hidden">
      <div data-reveal="fade" className="h-[360px] relative rounded-[24px] w-full overflow-hidden">
        <img data-depth alt="Three young adults talking through open books at a library table" loading="lazy" decoding="async" className="absolute max-w-none object-cover object-[50%_25%] rounded-[24px] size-full" src={imgVisualSide} />
        <div className="absolute bg-[rgba(132,29,38,0.2)] inset-0 rounded-[24px]" />
      </div>
      <div className="flex flex-col gap-[26px] items-start w-full">
        <div data-reveal="up" className="flex flex-col gap-[12px] items-start w-full">
          <div className="flex gap-[10px] items-center">
            <div data-reveal="rule-x" className="bg-[#b69b63] h-[1.5px] w-[32px]" />
            <p className="font-sans font-bold text-[#dcc28a] text-[11px] tracking-[2.2px] uppercase whitespace-nowrap">COVENANT DOCTRINE</p>
          </div>
          <h2 className="font-display leading-[1.08] text-[38px] text-white w-full">The Doctrine of Purpose</h2>
          <p className="font-sans font-normal leading-[1.5] text-[rgba(243,240,230,0.72)] text-[14px] w-full">Three questions shape everything taught in the curriculum.</p>
        </div>
        <div className="flex flex-col gap-[12px] items-start w-full">
          {DOCTRINE.questions.map(({ n, q, a }) => (
            <div key={n} data-reveal="up" className="bg-[rgba(255,255,255,0.95)] flex gap-[14px] items-start p-[16px] relative rounded-[16px] w-full">
              <div className="bg-[#841d26] flex flex-col items-center justify-center rounded-[10px] shrink-0 size-[44px]">
                <p aria-hidden="true" className="font-serif font-bold text-[#dcc28a] text-[16px]">{n}</p>
              </div>
              <div className="flex flex-col flex-1 gap-[6px] items-start">
                <h3 className="font-display text-[#202124] text-[19px] tracking-[0.3px] w-full">{q}</h3>
                <p className="font-sans font-normal leading-[1.5] text-[#665d60] text-[14px] w-full">{a}</p>
              </div>
            </div>
          ))}
        </div>
        <div data-reveal="up">
          <Link
            to="/apply"
            className="motion-button bg-[#f3f0e6] cursor-pointer flex gap-[16px] h-[54px] items-center overflow-clip pl-[24px] pr-[10px] rounded-[999px] hover:bg-white"
          >
            <span className="font-sans font-bold text-[#841d26] text-[14px] whitespace-nowrap">Start my application</span>
            <span aria-hidden="true" className="motion-arrow bg-[#841d26] flex flex-col items-center justify-center rounded-[999px] shrink-0 size-[30px]">
              <span className="font-sans font-bold text-[16px] text-white">→</span>
            </span>
          </Link>
        </div>
      </div>
    </div>

    {/* ── DOCTRINE (desktop) ── */}
    <div className="landing-desktop on-dark bg-[#841d26] w-full shrink-0 hidden xl:block">
      {/* Calmer than the hero: photograph, heading, then the questions in reading order. */}
      <div data-reveal-group="" className="flex gap-[48px] items-center justify-center min-h-[840px] px-[80px] max-w-[1440px] mx-auto [--reveal-shift:12px]">
        {/* Visual side */}
        {/* One restrained entrance for the whole frame (photo and tint together, no extra clip). */}
        <div data-reveal="settle" data-reveal-at="0" className="h-[648px] relative rounded-[24px] shrink-0 w-[480px]">
          <img alt="Three young adults talking through open books at a library table" loading="lazy" decoding="async" className="absolute max-w-none object-cover object-[50%_25%] rounded-[24px] size-full" src={imgVisualSide} />
          <div className="absolute bg-[rgba(132,29,38,0.2)] inset-0 rounded-[24px]" />
        </div>
        {/* Content */}
        <div className="flex flex-col gap-[48px] flex-1 items-start py-[96px] pl-[40px]">
          <div data-reveal="up" data-reveal-at="100" className="flex flex-col gap-[16px] items-start w-full">
            <div className="flex gap-[16px] items-center">
              <div data-reveal="rule-x" data-reveal-at="220" className="bg-[#b69b63] h-[1.5px] relative shrink-0 w-[40px]" />
              <p className="font-sans font-bold leading-normal not-italic text-[#dcc28a] text-[12px] tracking-[3px] uppercase whitespace-nowrap">COVENANT DOCTRINE</p>
            </div>
            <h2 className="font-display leading-normal not-italic text-[48px] text-white">The Doctrine of Purpose</h2>
            <p className="font-sans font-normal leading-normal not-italic opacity-80 text-[#f1f2f3] text-[16px]">
              Three questions shape everything taught in the curriculum.
            </p>
          </div>
          <div className="flex flex-col gap-[16px] items-start w-full">
            {DOCTRINE.questions.map(({ n, q, a }, i) => (
              <div key={n} data-reveal="up" data-reveal-at={200 + i * 60} className="bg-[rgba(255,255,255,0.93)] flex gap-[20px] items-center p-[24px] relative rounded-[16px] shrink-0 w-full">
                <div className="bg-[#841d26] flex flex-col items-center justify-center relative rounded-[12px] shrink-0 size-[48px]">
                  <p aria-hidden="true" className="font-serif font-bold leading-normal text-[#dcc28a] text-[22px]">{n}</p>
                </div>
                <div className="flex flex-col flex-1 gap-[6px] items-start not-italic text-[#202124]">
                  <h3 className="font-display leading-normal text-[20px] tracking-[0.4px] w-full">{q}</h3>
                  <p className="font-sans font-normal leading-[1.5] opacity-80 text-[14px] w-full">{a}</p>
                </div>
              </div>
            ))}
          </div>
          <div data-reveal="up" data-reveal-at="400">
            <Link
              to="/apply"
              className="motion-button bg-[#f3f0e6] cursor-pointer flex gap-[12px] items-center px-[36px] py-[16px] rounded-[32px] hover:bg-white"
            >
              <span className="font-sans font-bold leading-normal not-italic text-[#841d26] text-[15px] whitespace-nowrap">Start my application</span>
              <span aria-hidden="true" className="motion-arrow bg-[#841d26] flex flex-col items-center justify-center rounded-[999px] size-[24px]">
                <img alt="" className="block max-w-none size-[12px]" src={imgArrowRight2} />
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
    </section>
  );
}
