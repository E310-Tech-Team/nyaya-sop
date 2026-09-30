#!/usr/bin/env python3
"""Builds the website's supporting photographs from the AI-generated masters in design/imagery/<date>/masters/.

    python3 scripts/imagery-assets.py        (needs Pillow: python3 -m pip install pillow)

The outputs are committed, so this only needs running when a master changes. docs/IMAGERY.md
records each image's prompt, tool, date and placement; every photo has one placement only. The homepage hero, the brand artwork and
the Biblical Blueprint paintings are not generated here and must never be overwritten by it.

Each output keeps its existing file name, so no import changes. Crops happen in the browser
(object-fit: cover, with an object-position per slot: docs/IMAGERY.md §3), so the masters keep
their full framing and are only resized: at most 1200 px on the long edge, WebP quality 80.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FIRST = ROOT / 'design' / 'imagery' / '2026-09-29' / 'masters'  # the original nine
SECOND = ROOT / 'design' / 'imagery' / '2026-09-30' / 'masters'  # homepage previews and /programme cards
ASSETS = ROOT / 'src' / 'assets'
QUALITY = 80

# master -> (output under src/assets, longest edge in px)
IMAGES = {
    FIRST / 'vision.webp': ('landing/vision-portrait.webp', 1200),
    FIRST / 'doctrine.webp': ('landing/doctrine-study-group.webp', 1200),
    FIRST / 'journey-01-apply.webp': ('landing/journey-01-apply.webp', 1200),
    FIRST / 'journey-02-virtual-training.webp': ('landing/journey-02-virtual-training.webp', 1200),
    FIRST / 'journey-03-merit-selection.webp': ('landing/journey-03-merit-selection.webp', 1200),
    FIRST / 'journey-04-boot-camp.webp': ('landing/journey-04-boot-camp.webp', 1200),
    FIRST / 'journey-05-mentorship.webp': ('landing/journey-05-mentorship.webp', 1200),
    FIRST / 'journey-06-community.webp': ('landing/journey-06-community.webp', 1200),
    # A circular cut-out with transparent corners, as the success page expects (up to 443 px wide).
    FIRST / 'success-portrait.webp': ('success/student-portrait.webp', 872),
    SECOND / 'home-about.webp': ('landing/home-about.webp', 1200),
    SECOND / 'home-programme.webp': ('landing/home-programme.webp', 1200),
    SECOND / 'programme-virtual.webp': ('landing/programme-virtual.webp', 1200),
    SECOND / 'programme-merit.webp': ('landing/programme-merit.webp', 1200),
    SECOND / 'programme-bootcamp.webp': ('landing/programme-bootcamp.webp', 1200),
    SECOND / 'programme-community.webp': ('landing/programme-community.webp', 1200),
}
PROTECTED = ('landing/hero-', 'landing/blueprint-', 'brand/')


def resize(image: Image.Image, longest: int) -> Image.Image:
    """Lanczos; transparent images on premultiplied alpha, so edges don't pick up a dark fringe."""
    scale = longest / max(image.size)
    if scale >= 1:
        return image
    size = (round(image.width * scale), round(image.height * scale))
    if image.mode == 'RGBA':
        return image.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')
    return image.resize(size, Image.Resampling.LANCZOS)


def main() -> None:
    for master, (output, longest) in IMAGES.items():
        assert not output.startswith(PROTECTED), f'{output} is not a generated image'
        image = Image.open(master)
        image = resize(image.convert('RGBA' if image.mode in ('RGBA', 'LA', 'P') else 'RGB'), longest)
        target = ASSETS / output
        image.save(target, 'WEBP', quality=QUALITY, method=6)
        print(f'{output:<40} {image.width}x{image.height}  {target.stat().st_size / 1024:.0f} KB')


if __name__ == '__main__':
    main()
