#!/usr/bin/env python3
"""Builds the transparent RCCG Young Adults & Youths emblem from the logo as supplied.

    python3 scripts/partner-logo.py        (needs Pillow and numpy: python3 -m pip install pillow numpy)

The outputs are committed, so this only needs running when the supplied logo changes. Nothing is
redrawn or recoloured: only the white page around the emblem becomes transparent.

  design/brand/partners/rccg-yaya-supplied.webp     the logo as supplied (the master; never edited)
  design/brand/partners/rccg-yaya-transparent.png   full resolution, transparent, trimmed (for reuse)
  src/assets/brand/rccg-yaya-emblem.webp            the footer credit (bundled by Vite)

The emblem has its own whites (the ring behind "YOUNG ADULTS & YOUTHS", the R.C.C.G ribbon and its
curled ends, the dove, the book, the letters' counters), so white can't simply be keyed out: only
the white connected to the image's edges is background, plus the listed pockets the artwork
encloses. Along the edge, each pixel takes the most solid colour of the same hue near it (the
gold of a leaf, even on thin stems) and an alpha for how much of it it holds: outlines keep their
full colour, no pale halo is left on dark backgrounds, and no colour is borrowed from a neighbour.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
PARTNERS = ROOT / 'design' / 'brand' / 'partners'
SUPPLIED = PARTNERS / 'rccg-yaya-supplied.webp'

# Background the emblem encloses, as points in the supplied 1080×1080 image: the gap between the
# ribbon's lower edge and the wreath's knot. (The ribbon's curled ends are ribbon: they stay.)
ENCLOSED_BACKGROUND = [(550, 946)]

NEAR_WHITE_MIN = 230  # every channel at least this…
NEAR_WHITE_SPREAD = 30  # …and this close to each other (no tint)
EDGE_BAND = 4  # pixels along the background that get a soft alpha (the supplied edges blur over ~5 px)
INK_RADIUS = EDGE_BAND + 2  # how far to look for an edge pixel's solid colour
SAME_HUE = 0.9  # cosine between colour directions from white: about 25°
DISPLAY_HEIGHT = 64  # CSS px in the footer (MarketingFooter)
WEB_SCALE = 3  # sharp on 3x phone screens


def near_white(rgb: np.ndarray) -> np.ndarray:
    low, high = rgb.min(axis=2), rgb.max(axis=2)
    return (low >= NEAR_WHITE_MIN) & (high - low <= NEAR_WHITE_SPREAD)


def background(rgb: np.ndarray) -> np.ndarray:
    """White connected to the image's edges (flood fill from a corner), plus the listed pockets."""
    # .copy(): an image made by fromarray can share numpy's buffer, and flood fill wouldn't write to it.
    mask = Image.fromarray(np.where(near_white(rgb), 255, 0).astype(np.uint8), 'L').copy()
    height, width = rgb.shape[:2]
    seeds = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1), *ENCLOSED_BACKGROUND]
    for x, y in seeds:
        value = mask.getpixel((x, y))
        if value == 128:
            continue  # already reached from another seed
        if value != 255:
            raise SystemExit(f'Seed {(x, y)} is not white in {SUPPLIED.name}: check ENCLOSED_BACKGROUND')
        ImageDraw.floodfill(mask, (x, y), 128, thresh=0)
    # Pillow fills across edges only; white touching the background at a corner is background too.
    bg, white = np.asarray(mask) == 128, near_white(rgb)
    while True:
        grown = bg | (dilate(bg, 1) & white)
        if grown.sum() == bg.sum():
            return bg
        bg = grown


def shifted(array: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """`array` moved by (dy, dx), zero-filled (no wrap-around)."""
    out = np.zeros_like(array)
    h, w = array.shape[:2]
    ys, yd = (slice(0, h - dy), slice(dy, h)) if dy >= 0 else (slice(-dy, h), slice(0, h + dy))
    xs, xd = (slice(0, w - dx), slice(dx, w)) if dx >= 0 else (slice(-dx, w), slice(0, w + dx))
    out[yd, xd] = array[ys, xs]
    return out


NEIGHBOURS = [(dy, dx) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dy, dx) != (0, 0)]


def dilate(mask: np.ndarray, steps: int) -> np.ndarray:
    out = mask.copy()
    for _ in range(steps):
        grown = out.copy()
        for dy, dx in NEIGHBOURS:
            grown |= shifted(out, dy, dx)
        out = grown
    return out


def transparent(supplied: Image.Image) -> Image.Image:
    rgb = np.asarray(supplied.convert('RGB')).astype(np.float32)
    bg = background(rgb)
    band = dilate(bg, EDGE_BAND) & ~bg

    # Each edge pixel's solid colour: the most inked pixel within INK_RADIUS that has the same hue
    # (points the same way from white), so a pale gold edge finds the gold core and never the
    # crown's red velvet a few pixels away.
    towards = rgb - 255.0
    ink = np.sqrt((towards * towards).sum(axis=2))
    direction = towards / np.maximum(ink, 1e-6)[..., None]
    best_ink, colour = np.where(bg, 0.0, ink), rgb.copy()
    for dy in range(-INK_RADIUS, INK_RADIUS + 1):
        for dx in range(-INK_RADIUS, INK_RADIUS + 1):
            if (dy, dx) == (0, 0) or dy * dy + dx * dx > INK_RADIUS * INK_RADIUS:
                continue
            candidate = shifted(ink, dy, dx)
            same_hue = (direction * shifted(direction, dy, dx)).sum(axis=2) >= SAME_HUE
            better = same_hue & (candidate > best_ink) & ~shifted(bg, dy, dx)
            best_ink = np.where(better, candidate, best_ink)
            colour = np.where(better[..., None], shifted(rgb, dy, dx), colour)

    # Alpha of an edge pixel: how much of that colour it holds (the rest is the white page).
    alpha = np.where(bg, 0.0, np.where(band, np.clip(ink / np.maximum(best_ink, 1.0), 0.0, 1.0), 1.0))

    pixels = np.where(band[..., None], colour, rgb)
    rgba = np.dstack([pixels, alpha * 255.0]).round().clip(0, 255).astype(np.uint8)
    image = Image.fromarray(rgba, 'RGBA')
    return image.crop(image.getchannel('A').point(lambda a: 255 if a > 4 else 0).getbbox())


def resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Lanczos on premultiplied alpha, so transparent edges don't pick up a dark fringe."""
    return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def save(image: Image.Image, target: Path, **options) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, **options)
    print(f'{str(target.relative_to(ROOT)):52} {image.width}×{image.height}  {target.stat().st_size / 1024:6.1f} KB')


def main() -> None:
    emblem = transparent(Image.open(SUPPLIED))
    save(emblem, PARTNERS / 'rccg-yaya-transparent.png', optimize=True)
    height = DISPLAY_HEIGHT * WEB_SCALE
    width = round(emblem.width * height / emblem.height)
    web = resize(emblem, (width, height))
    save(web, ROOT / 'src' / 'assets' / 'brand' / 'rccg-yaya-emblem.webp', quality=90, alpha_quality=100, method=6)


if __name__ == '__main__':
    main()
