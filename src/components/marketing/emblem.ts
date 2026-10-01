import src from '../../assets/brand/rccg-yaya-emblem.webp';

/**
 * The RCCG Young Adults & Youths emblem in the footer credit: the logo as supplied, its white page
 * made transparent (design/brand/partners/, `python3 scripts/partner-logo.py`). `width` and
 * `height` are the display size in CSS px; the file is three times that, for 3x screens
 * (emblem.test.ts checks), so the page never shifts while it loads.
 */
export const RCCG_YAYA_EMBLEM = { src, width: 46, height: 64 } as const;
