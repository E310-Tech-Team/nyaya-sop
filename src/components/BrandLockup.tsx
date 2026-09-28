import lockupColour from '../assets/brand/brand-lockup-colour.webp';
import lockupCream from '../assets/brand/brand-lockup-cream.webp';

/**
 * The School of Purpose lockup: the target mark with "RCCG NYAYA / School of / Purpose"
 * (docs/04 §2). Both files are 960×268 (scripts/brand-assets.py builds them from design/brand/),
 * so the width and height attributes reserve the space before they load.
 *
 * - `on="dark"`: cream lettering, for the burgundy and near-black surfaces.
 * - `on="light"`: burgundy lettering, for white, paper and cream.
 *
 * Size it by height (`h-[48px]`); the width follows. Pass `alt=""` when the surrounding link
 * already has a name.
 */
export function BrandLockup({
  on,
  alt = 'RCCG NYAYA School of Purpose',
  className = '',
}: {
  on: 'light' | 'dark';
  alt?: string;
  className?: string;
}) {
  return (
    <img
      src={on === 'dark' ? lockupCream : lockupColour}
      width={960}
      height={268}
      alt={alt}
      decoding="async"
      className={`block w-auto max-w-none shrink-0 ${className}`}
    />
  );
}
