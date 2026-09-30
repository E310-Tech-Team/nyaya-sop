import imgUnityPortrait from '../../assets/landing/vision-portrait.webp';

/**
 * Vision & Mission: separate phone/tablet and desktop (≥1280px, 1440px composition) trees.
 * Used on the About page; `id` keeps in-page links working wherever it appears.
 */
export function VisionMission({ id = 'vision' }: { id?: string }) {
  return (
    <section id={id} aria-label="Vision and mission" className="w-full">
    {/* ── MOBILE VISION & MISSION ── */}
    <div className="landing-gutter bg-[#f3f0e6] flex flex-col gap-[36px] items-start py-[72px] w-full xl:hidden">
      <div data-reveal="up" className="flex flex-col gap-[14px] items-start w-full">
        {/* Wraps below ~360px instead of pushing the page sideways. */}
        <div className="flex gap-[10px] items-center max-w-full">
          <div data-reveal="rule-x" className="bg-[#841d26] h-[1.5px] w-[32px] shrink-0" />
          <p className="min-w-0 font-sans font-bold text-[#841d26] text-[11px] tracking-[1.8px] uppercase">School of Purpose · Vision &amp; Mission</p>
        </div>
        <h2 className="font-display leading-[1.08] text-[#841d26] text-[32px] tracking-[0.2px] w-full">
          We are building a generation of purpose-driven Christians who become voices transforming the Church, marketplace and nation.
        </h2>
      </div>
      <div data-reveal="up" className="flex flex-col gap-[14px] items-start w-full">
        <div className="flex flex-col gap-[7px] items-start">
          <h3 className="font-display text-[#841d26] text-[27px] whitespace-nowrap">Vision</h3>
          <div data-reveal="rule-x" className="bg-[#841d26] h-px w-[72px]" />
        </div>
        <p className="font-sans font-medium leading-[1.55] text-[#202124] text-[17px] w-full">
          To raise purpose-driven young Christians with spiritual depth, character and competence, equipped to lead with Kingdom impact.
        </p>
      </div>
      <div data-reveal="fade" className="h-[430px] relative w-full overflow-hidden">
        <div className="absolute bg-[#841d26] inset-0" />
        <img data-depth alt="Three young professionals discussing plans around a laptop and notebook" loading="lazy" decoding="async" className="absolute max-w-none object-cover object-[50%_15%] size-full" src={imgUnityPortrait} />
      </div>
      <div data-reveal="up" className="flex flex-col gap-[14px] items-start w-full">
        <div className="flex flex-col gap-[7px] items-start">
          <h3 className="font-display text-[#841d26] text-[27px] whitespace-nowrap">Mission</h3>
          <div data-reveal="rule-x" className="bg-[#841d26] h-px w-[72px]" />
        </div>
        <p className="font-sans font-medium leading-[1.55] text-[#202124] text-[17px] w-full">
          To discover, train and mentor RCCG young adults and youth into influential leaders who serve the Church, marketplace and nation.
        </p>
      </div>
    </div>

    {/* ── VISION & MISSION (desktop) ── */}
    <div className="landing-desktop bg-[#f3f0e6] w-full shrink-0 hidden xl:block">
      <div data-reveal-group="" className="flex flex-col h-[945px] items-start overflow-clip pt-[72px] px-[80px] relative max-w-[1440px] mx-auto">
        {/* No overflow clipping here: it cut the headline's last-line descenders. */}
        <div data-reveal="up" data-reveal-at="0" className="flex flex-col gap-[12px] items-start relative shrink-0 w-full">
          <div className="flex gap-[12px] items-center">
            <div data-reveal="rule-x" data-reveal-at="140" className="bg-[#6b1d2a] h-[1.5px] relative shrink-0 w-[40px]" />
            <p className="font-sans font-bold leading-normal not-italic text-[#6b1d2a] text-[11px] tracking-[2.4px] uppercase whitespace-nowrap">School of Purpose · Vision &amp; Mission</p>
          </div>
          <h2 className="font-display leading-[1.08] not-italic text-[#841d26] text-[40px] tracking-[1.2px] w-full">
            We are building a generation of purpose-driven Christians who become voices transforming the Church, marketplace and nation.
          </h2>
        </div>
        <div className="flex gap-[54px] h-[640px] items-center overflow-clip pt-[40px] relative shrink-0 w-full">
          {/* Vision */}
          <div data-reveal="up" data-reveal-at="200" className="flex flex-col gap-[20px] h-full items-start overflow-clip pt-[18px] relative shrink-0 w-[292px]">
            <div className="flex flex-col gap-[8px] items-start overflow-clip">
              <h3 className="font-display leading-normal not-italic text-[#841d26] text-[27px] whitespace-nowrap">Vision</h3>
              <div data-reveal="rule-x" data-reveal-at="320" className="bg-[#841d26] h-px relative shrink-0 w-[70px]" />
            </div>
            <p className="font-sans font-medium leading-[1.55] not-italic text-[#1a1919] text-[24px] w-full">
              To raise purpose-driven young Christians with spiritual depth, character and competence, equipped to lead with Kingdom impact.
            </p>
            <div data-reveal="rule-y" data-reveal-at="400" className="bg-[#841d26] h-[220px] opacity-70 relative shrink-0 w-px" />
          </div>
          {/* Portrait */}
          <div data-reveal="fade" data-reveal-at="120" className="h-[600px] overflow-clip relative shrink-0 w-[500px]">
            <div className="absolute inset-0">
              <div className="absolute bg-[#841d26] inset-0" />
              <img data-depth alt="Three young professionals discussing plans around a laptop and notebook" loading="lazy" decoding="async" className="absolute max-w-none object-cover object-[50%_15%] size-full" src={imgUnityPortrait} />
            </div>
          </div>
          {/* Mission */}
          <div data-reveal="up" data-reveal-at="280" className="flex flex-col gap-[20px] h-full items-start overflow-clip pt-[270px] relative shrink-0 w-[358px]">
            <div className="flex flex-col gap-[8px] items-start overflow-clip">
              <h3 className="font-display leading-normal not-italic text-[#841d26] text-[27px] whitespace-nowrap">Mission</h3>
              <div data-reveal="rule-x" data-reveal-at="400" className="bg-[#841d26] h-px relative shrink-0 w-[82px]" />
            </div>
            <p className="font-sans font-medium leading-[1.55] not-italic text-[#1a1919] text-[24px] w-full">
              To discover, train and mentor RCCG young adults and youth into influential leaders who serve the Church, marketplace and nation.
            </p>
            <div className="flex items-start justify-end overflow-clip relative shrink-0 w-full">
              <div data-reveal="rule-y" data-reveal-at="480" className="bg-[#841d26] h-[205px] opacity-70 relative shrink-0 w-px" />
            </div>
          </div>
        </div>
      </div>
    </div>
    </section>
  );
}
