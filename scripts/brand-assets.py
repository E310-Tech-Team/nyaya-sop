#!/usr/bin/env python3
"""Builds the web-ready logo files and app icons from the brand masters in design/brand/.

    python3 scripts/brand-assets.py        (needs Pillow: python3 -m pip install pillow)

The outputs are committed, so this only needs running when the artwork changes. Nothing is
redrawn: every file is the supplied artwork, resized (and, for icons, placed on a background).

  src/assets/brand/brand-lockup-colour.webp   lockup for light backgrounds (bundled by Vite)
  src/assets/brand/brand-lockup-cream.webp    lockup for burgundy and dark backgrounds
  public/favicon.ico, public/favicon-32.png   browser tabs (the mark)
  public/apple-touch-icon.png                 iOS home screen: the mark on burgundy, opaque
  public/icons/icon-{192,512}.png             manifest "any" icons: the mark, transparent corners
  public/icons/icon-maskable-{192,512}.png    manifest "maskable": the mark inside the safe zone
  public/icons/badge-96.png                   Android status-bar badge (only its alpha is used)
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / 'design' / 'brand'
BURGUNDY = (0x84, 0x1D, 0x26)  # brand palette (docs/04 §2)
CREAM = (0xF3, 0xF0, 0xE6)

LOCKUP_WIDTH = 960  # about 2x the largest display width (200 px on the desktop header, zoomed)
MASKABLE_SCALE = 0.76  # the mark's diameter; the maskable safe zone is the central 80% circle
APPLE_SCALE = 0.80  # iOS only rounds the corners, so the mark can sit a little larger


def load(name: str) -> Image.Image:
    return Image.open(MASTERS / name).convert('RGBA')


def resize(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Lanczos on premultiplied alpha, so transparent edges don't pick up a dark fringe."""
    return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def palette(image: Image.Image, colours: int) -> Image.Image:
    """The artwork is three flat colours and their edges: a small palette looks identical (mean
    difference under 1/255 per channel) and makes the files three to five times smaller."""
    return image.quantize(colors=colours, method=Image.Quantize.FASTOCTREE)


def square(image: Image.Image, size: int) -> Image.Image:
    return resize(image, (size, size))


def on_background(mark: Image.Image, size: int, scale: float, colour: tuple[int, int, int]) -> Image.Image:
    canvas = Image.new('RGBA', (size, size), (*colour, 255))
    inner = round(size * scale)
    offset = (size - inner) // 2
    canvas.alpha_composite(square(mark, inner), (offset, offset))
    return canvas.convert('RGB')


def badge(mark: Image.Image, size: int) -> Image.Image:
    """White glyph whose alpha is the mark's ink (burgundy and gold); the cream areas drop out."""
    distance = ImageChops.difference(mark.convert('RGB'), Image.new('RGB', mark.size, CREAM))
    # The summed channel differences, scaled so the palest ink (the gold, 277) is fully opaque.
    ink = ImageChops.multiply(distance.convert('L', (0.92, 0.92, 0.92, 0)), mark.getchannel('A'))
    # Leave out the disc's hairline outline: in a status bar it would only read as a smudge.
    inside = Image.new('L', mark.size, 0)
    margin = mark.width * 0.03
    ImageDraw.Draw(inside).ellipse((margin, margin, mark.width - margin, mark.height - margin), fill=255)
    ink = ImageChops.multiply(ink, inside)
    glyph = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    glyph.putalpha(ink.resize((size, size), Image.Resampling.LANCZOS))
    return glyph


def save(image: Image.Image, relative: str, **options) -> None:
    target = ROOT / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, **options)
    print(f'{relative:44} {image.width}×{image.height}  {target.stat().st_size / 1024:6.1f} KB')


def main() -> None:
    for variant in ('colour', 'cream'):
        lockup = load(f'logo-{variant}.png')
        height = round(LOCKUP_WIDTH * lockup.height / lockup.width)
        webp = palette(resize(lockup, (LOCKUP_WIDTH, height)), 128).convert('RGBA')
        save(webp, f'src/assets/brand/brand-lockup-{variant}.webp', lossless=True, method=6)

    mark = load('mark.png')
    save(badge(square(mark, 960), 96), 'public/icons/badge-96.png', optimize=True)  # 10x is plenty

    for size in (192, 512):
        save(palette(square(mark, size), 256), f'public/icons/icon-{size}.png', optimize=True)
        maskable = on_background(mark, size, MASKABLE_SCALE, BURGUNDY)
        save(palette(maskable, 256), f'public/icons/icon-maskable-{size}.png', optimize=True)
    save(palette(on_background(mark, 180, APPLE_SCALE, BURGUNDY), 256), 'public/apple-touch-icon.png', optimize=True)

    save(square(mark, 32), 'public/favicon-32.png', optimize=True)
    frames = [square(mark, size) for size in (16, 32)]
    save(square(mark, 48), 'public/favicon.ico', format='ICO', sizes=[(16, 16), (32, 32), (48, 48)], append_images=frames)


if __name__ == '__main__':
    main()
