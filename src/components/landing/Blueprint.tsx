import imgDeborahPhoto from '../../assets/landing/blueprint-deborah.webp';
import imgCardPhoto from '../../assets/landing/blueprint-joseph.webp';
import imgCardPhoto1 from '../../assets/landing/blueprint-nehemiah.webp';
import imgCardPhoto2 from '../../assets/landing/blueprint-paul.webp';
import imgCardPhoto3 from '../../assets/landing/blueprint-daniel.webp';
import imgBiblicalDaniel from '../../assets/landing/blueprint-daniel-mobile.webp';

/** The Biblical Blueprint: five leadership models (stacked cards on phones, the deck on desktop). */
export function Blueprint({ id = 'blueprint' }: { id?: string }) {
  return (
    <section id={id} aria-label="The Biblical Blueprint" className="w-full">
    {/* ── MOBILE BIBLICAL BLUEPRINT ── */}
    <div className="landing-gutter bg-[#f3f0e6] flex flex-col gap-[34px] items-start py-[72px] w-full xl:hidden">
      <div data-reveal="up" className="flex flex-col gap-[14px] items-start w-full">
        <div className="flex gap-[10px] items-center">
          <div data-reveal="rule-x" className="bg-[#841d26] h-[1.5px] w-[32px]" />
          <p className="font-sans font-bold text-[#841d26] text-[11px] tracking-[1.8px] uppercase whitespace-nowrap">COVENANT DOCTRINE</p>
        </div>
        <h2 className="font-display leading-[1.05] text-[#202124] text-[38px] w-full">The Biblical Blueprint</h2>
        <p className="font-sans font-normal leading-[1.55] text-[#665d60] text-[14px] w-full">
          Five scriptural models anchor every hour of formation. A dynamic framework engineered to build spiritual depth, character, and professional competence.
        </p>
      </div>
      <div className="flex flex-col gap-[16px] items-start w-full">
        {/* Daniel — large dark card */}
        <div data-reveal="up" className="bg-[#1a0810] flex flex-col items-start overflow-hidden relative rounded-[16px] shadow-[0px_12px_28px_0px_rgba(35,7,17,0.14)] w-full">
          <div className="h-[280px] relative w-full">
            <img alt="Painting of Daniel reading the writing on the wall before King Belshazzar" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgBiblicalDaniel} />
          </div>
          <div className="flex flex-col gap-[8px] items-start p-[20px] w-full">
            <div className="flex items-center justify-between w-full">
              <h3 className="font-display text-[#f3f0e6] text-[27px]">Daniel</h3>
              <p aria-hidden="true" className="font-sans font-bold text-[#dcc28a] text-[12px] tracking-[1px]">01</p>
            </div>
            <p className="font-sans font-bold leading-[1.4] text-[#dcc28a] text-[12px] tracking-[0.7px] uppercase w-full">Government &amp; Public Excellence</p>
            <p className="font-sans font-normal leading-[1.45] text-[rgba(243,240,230,0.8)] text-[13px] w-full">Conviction within secular systems.</p>
          </div>
        </div>
        {/* Joseph */}
        <div data-reveal="up" className="bg-white flex h-[148px] items-start overflow-hidden relative rounded-[16px] shadow-[0px_12px_28px_0px_rgba(35,7,17,0.14)] w-full">
          <div className="h-full relative shrink-0 w-[120px]">
            <img alt="Painting of Joseph in royal robes overseeing the grain stores" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto} />
          </div>
          <div className="flex flex-col flex-1 gap-[7px] h-full items-start p-[16px]">
            <p aria-hidden="true" className="font-sans font-bold text-[#841d26] text-[11px] tracking-[1px] whitespace-nowrap">02</p>
            <h3 className="font-display text-[#202124] text-[22px] w-full">Joseph</h3>
            <p className="font-sans font-bold leading-[1.35] text-[#841d26] text-[11px] tracking-[0.5px] uppercase w-full">Marketplace &amp; Stewardship</p>
          </div>
        </div>
        {/* Nehemiah */}
        <div data-reveal="up" className="bg-white flex h-[148px] items-start overflow-hidden relative rounded-[16px] shadow-[0px_12px_28px_0px_rgba(35,7,17,0.14)] w-full">
          <div className="h-full relative shrink-0 w-[120px]">
            <img alt="Painting of Nehemiah directing the rebuilding of Jerusalem's walls" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto1} />
          </div>
          <div className="flex flex-col flex-1 gap-[7px] h-full items-start p-[16px]">
            <p aria-hidden="true" className="font-sans font-bold text-[#841d26] text-[11px] tracking-[1px] whitespace-nowrap">03</p>
            <h3 className="font-display text-[#202124] text-[22px] w-full">Nehemiah</h3>
            <p className="font-sans font-bold leading-[1.35] text-[#841d26] text-[11px] tracking-[0.5px] uppercase w-full">Nation-Building &amp; Reform</p>
          </div>
        </div>
        {/* Paul */}
        <div data-reveal="up" className="bg-white flex h-[148px] items-start overflow-hidden relative rounded-[16px] shadow-[0px_12px_28px_0px_rgba(35,7,17,0.14)] w-full">
          <div className="h-full relative shrink-0 w-[120px]">
            <img alt="Painting of Paul writing a letter by candlelight" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto2} />
          </div>
          <div className="flex flex-col flex-1 gap-[7px] h-full items-start p-[16px]">
            <p aria-hidden="true" className="font-sans font-bold text-[#841d26] text-[11px] tracking-[1px] whitespace-nowrap">04</p>
            <h3 className="font-display text-[#202124] text-[22px] w-full">Paul</h3>
            <p className="font-sans font-bold leading-[1.35] text-[#841d26] text-[11px] tracking-[0.5px] uppercase w-full">Scholarship &amp; Mission</p>
          </div>
        </div>
        {/* Deborah */}
        <div data-reveal="up" className="bg-white flex h-[148px] items-start overflow-hidden relative rounded-[16px] shadow-[0px_12px_28px_0px_rgba(35,7,17,0.14)] w-full">
          <div className="h-full relative shrink-0 w-[120px]">
            <img alt="Painting of Deborah judging the people beneath a palm tree" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgDeborahPhoto} />
          </div>
          <div className="flex flex-col flex-1 gap-[7px] h-full items-start p-[16px]">
            <p aria-hidden="true" className="font-sans font-bold text-[#841d26] text-[11px] tracking-[1px] whitespace-nowrap">05</p>
            <h3 className="font-display text-[#202124] text-[22px] w-full">Deborah</h3>
            <p className="font-sans font-bold leading-[1.35] text-[#841d26] text-[11px] tracking-[0.5px] uppercase w-full">Courageous Leadership</p>
          </div>
        </div>
      </div>
    </div>

    {/* ── BIBLICAL BLUEPRINT (desktop) ── */}
    <div className="landing-desktop bg-[#f3f0e6] w-full shrink-0 hidden xl:block">
      <div className="h-[950px] overflow-clip relative max-w-[1440px] mx-auto">
        {/* Header */}
        <div data-reveal="up" className="absolute flex flex-col gap-[12px] items-start left-[80px] top-[80px] right-[80px]">
          <div className="flex gap-[8px] items-center">
            <div data-reveal="rule-x" className="bg-[#6b1d2a] h-[1.5px] relative shrink-0 w-[40px]" />
            <p className="font-sans font-extrabold leading-normal not-italic text-[#6b1d2a] text-[12px] tracking-[4px] uppercase whitespace-nowrap">COVENANT DOCTRINE</p>
          </div>
          <div className="flex items-end justify-between not-italic w-full">
            <h2 className="font-display leading-normal text-[#6b1d2a] text-[48px] tracking-[2.4px] w-[650px]">The Biblical Blueprint</h2>
            <p className="font-sans font-normal leading-[1.5] text-[#202124] text-[16px] w-[450px]">
              Five scriptural models anchor every hour of formation. A dynamic framework engineered to build spiritual depth, character, and professional competence.
            </p>
          </div>
        </div>

        {/* Stacked deck: the cards deal into their collage positions in visual order (left → right),
            each starting a little toward the centre of the deck. Motion runs on the inner card, so
            every rotation, overlap, shadow and stacking order stays on the untouched wrapper. */}
        <div data-reveal-group="" className="absolute h-[600px] left-[80px] top-[280px] right-[80px] [--reveal-duration:600ms]">
          {/* Daniel */}
          <div className="absolute left-[10px] top-[17px]" style={{ transform: 'rotate(-4deg)' }}>
            <div data-reveal="up" data-reveal-at="0" className="[--reveal-x:28px] [--reveal-y:22px] bg-[#202124] border-[#b69b63] border-[1.742px] flex flex-col h-[453px] items-start overflow-clip rounded-[18px] shadow-[0px_18px_37px_2px_rgba(0,0,0,0.5)] w-[325px]">
              <div className="h-[279px] relative shrink-0 w-full">
                <img alt="Painting of Daniel standing calmly among lions" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto3} />
              </div>
              <div className="bg-gradient-to-b flex flex-col flex-1 from-[#202124] gap-[9px] items-start min-h-px p-[23px] to-[#161719] w-full">
                <div className="flex items-center justify-between leading-normal text-[#b69b63] w-full">
                  <h3 className="font-serif font-bold text-[25px]">Daniel</h3>
                  <p className="font-sans font-extrabold not-italic text-[11px] tracking-[1px]">01</p>
                </div>
                <p className="font-sans font-bold leading-normal not-italic text-[#f3f0e6] text-[14px] tracking-[0.6px] uppercase w-full">Government &amp; Public Excellence</p>
                <p className="font-sans font-normal leading-[1.4] not-italic text-[12px] text-[rgba(243,240,230,0.8)] w-full">Conviction within secular systems.</p>
              </div>
            </div>
          </div>
          {/* Nehemiah */}
          <div className="absolute left-[240px] top-[105px]" style={{ transform: 'rotate(-1deg)' }}>
            <div data-reveal="up" data-reveal-at="50" className="[--reveal-x:14px] [--reveal-y:22px] bg-[#202124] border-[#b69b63] border-[1.5px] flex flex-col h-[390px] items-start overflow-clip rounded-[16px] shadow-[0px_16px_32px_2px_rgba(0,0,0,0.5)] w-[280px]">
              <div className="h-[240px] relative shrink-0 w-full">
                <img alt="Painting of Nehemiah directing the rebuilding of Jerusalem's walls" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto1} />
              </div>
              <div className="bg-gradient-to-b flex flex-col flex-1 from-[#202124] gap-[8px] items-start min-h-px p-[20px] to-[#161719] w-full">
                <div className="flex items-center justify-between leading-normal text-[#b69b63] w-full">
                  <h3 className="font-serif font-bold text-[22px]">Nehemiah</h3>
                  <p className="font-sans font-extrabold not-italic text-[10px] tracking-[1px]">03</p>
                </div>
                <p className="font-sans font-bold leading-normal not-italic text-[#f3f0e6] text-[12px] tracking-[0.5px] uppercase w-full">Nation-Building &amp; Reform</p>
                <p className="font-sans font-normal leading-[1.4] not-italic text-[11px] text-[rgba(243,240,230,0.8)] w-full">Burden-led, prayerful rebuilding.</p>
              </div>
            </div>
          </div>
          {/* Deborah – front focus */}
          <div className="absolute left-[480px] top-[10px]">
            <div data-reveal="up" data-reveal-at="100" className="[--reveal-x:0px] [--reveal-y:26px] bg-[#202124] border-3 border-[#b69b63] flex flex-col h-[460px] items-start overflow-clip rounded-[24px] shadow-[0px_24px_48px_4px_rgba(107,29,42,0.3)] w-[320px]">
              <div className="h-[290px] relative shrink-0 w-full">
                <img alt="Painting of Deborah judging the people beneath a palm tree" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgDeborahPhoto} />
              </div>
              <div className="bg-gradient-to-b flex flex-col flex-1 from-[#202124] gap-[10px] items-start min-h-px p-[24px] to-[#120207] w-full">
                <h3 className="font-serif font-bold leading-normal text-[#b69b63] text-[28px]">Deborah</h3>
                <p className="font-sans font-bold leading-normal not-italic text-[#f3f0e6] text-[13px] tracking-[1px] uppercase w-full">Courageous Leadership</p>
                <p className="font-sans font-normal leading-[1.5] not-italic text-[12px] text-[rgba(243,240,230,0.8)] w-full">Wisdom that restores order.</p>
              </div>
            </div>
          </div>
          {/* Paul */}
          <div className="absolute left-[729px] top-[80px]" style={{ transform: 'rotate(3deg)' }}>
            <div data-reveal="up" data-reveal-at="150" className="[--reveal-x:-14px] [--reveal-y:22px] bg-[#202124] border-[#b69b63] border-[1.5px] flex flex-col h-[390px] items-start overflow-clip rounded-[16px] shadow-[0px_16px_32px_2px_rgba(0,0,0,0.5)] w-[280px]">
              <div className="h-[240px] relative shrink-0 w-full">
                <img alt="Painting of Paul writing a letter by candlelight" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto2} />
              </div>
              <div className="bg-gradient-to-b flex flex-col flex-1 from-[#202124] gap-[8px] items-start min-h-px p-[20px] to-[#161719] w-full">
                <div className="flex items-center justify-between leading-normal text-[#b69b63] w-full">
                  <h3 className="font-serif font-bold text-[22px]">Paul</h3>
                  <p className="font-sans font-extrabold not-italic text-[10px] tracking-[1px]">04</p>
                </div>
                <p className="font-sans font-bold leading-normal not-italic text-[#f3f0e6] text-[12px] tracking-[0.5px] uppercase w-full">Scholarship &amp; Mission</p>
                <p className="font-sans font-normal leading-[1.4] not-italic text-[11px] text-[rgba(243,240,230,0.8)] w-full">Rigorous intellect surrendered to Christ.</p>
              </div>
            </div>
          </div>
          {/* Joseph */}
          <div className="absolute left-[956px] top-[60px]" style={{ transform: 'rotate(5deg)' }}>
            <div data-reveal="up" data-reveal-at="200" className="[--reveal-x:-28px] [--reveal-y:22px] bg-[#202124] border-[#b69b63] border-[1.5px] flex flex-col h-[390px] items-start overflow-clip rounded-[16px] shadow-[0px_16px_32px_2px_rgba(0,0,0,0.5)] w-[280px]">
              <div className="h-[240px] relative shrink-0 w-full">
                <img alt="Painting of Joseph in royal robes overseeing the grain stores" loading="lazy" decoding="async" className="absolute inset-0 max-w-none object-cover size-full" src={imgCardPhoto} />
              </div>
              <div className="bg-gradient-to-b flex flex-col flex-1 from-[#202124] gap-[8px] items-start min-h-px p-[20px] to-[#161719] w-full">
                <div className="flex items-center justify-between leading-normal text-[#b69b63] w-full">
                  <h3 className="font-serif font-bold text-[22px]">Joseph</h3>
                  <p className="font-sans font-extrabold not-italic text-[10px] tracking-[1px]">02</p>
                </div>
                <p className="font-sans font-bold leading-normal not-italic text-[#f3f0e6] text-[12px] tracking-[0.5px] uppercase w-full">Marketplace &amp; Stewardship</p>
                <p className="font-sans font-normal leading-[1.4] not-italic text-[11px] text-[rgba(243,240,230,0.8)] w-full">Integrity with strategic foresight.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    </section>
  );
}
