# School of Purpose brand masters

The official logo artwork (4× PNG exports, transparent backgrounds) and the brand palette, from the brand guideline **"School of Purpose 4.pdf"** (8 pages; the 12 MB PDF is kept outside the repository). Everything the site ships is resized from these files by [`scripts/brand-assets.py`](../../scripts/brand-assets.py); nothing is redrawn. How the site uses them: [docs/04 §2](../../docs/04-UI-UX-Design-Brief.md#brand-identity).

## Files

| File | Supplied as | Size | What it is |
|---|---|---|---|
| `logo-colour.png` | `Full Logo.png` | 6076×1698 | Lockup, burgundy lettering: **white and light backgrounds** (guideline p. 1) |
| `logo-cream.png` | `Logo for Dark BG.png` | 6077×1698 | Lockup, cream lettering: **burgundy and dark backgrounds** (p. 7) |
| `logo-mono.png` | `Monochrome Logo.png` (identical copy: `Logo Black.png`) | 6077×1699 | One-colour black lockup, for single-colour print (p. 8) |
| `mark.png` | `Logo Alone.png` (identical copy: `Asset 2.png`) | 4819×4819 | The mark alone: favicons and app icons |
| `wordmark-colour.png` | `Text Alone.png` | 4069×1421 | "RCCG NYAYA / School of / Purpose" without the mark, burgundy |
| `wordmark-cream.png` | `Text White.png` | 4070×1421 | The same in cream |
| `wordmark-black.png` | `Text Black.png` | 4069×1422 | The same in black |

The lockup reads **RCCG NYAYA / SCHOOL OF / PURPOSE**; use "RCCG NYAYA School of Purpose" as its text alternative.

## Palette (guideline p. 6)

| Colour | Hex | Site token |
|---|---|---|
| Burgundy | `#841D26` | `brand` |
| Cream | `#F3F0E6` | `cream` |
| Gold | `#B69B63` | `gold` |

These are exactly the colours in the artwork. The site's other colours derive from them (`brand-hover`, `gold-light` for small gold text on burgundy, …): see [docs/04 §2](../../docs/04-UI-UX-Design-Brief.md#2-colour).

## Rationale (guideline pp. 2–5)

The mark is an archery target seen as a journey:

- **Outer ring:** the target, the goal: focus and direction.
- **Bullseye** (the gold sunburst): the fulfilment of purpose.
- **Path** (the rays rising from the base): the journey towards fulfilling that purpose.

## Rules

- Use the supplied artwork only: don't redraw, re-type, recolour, stretch, crop or add effects to it.
- Colour lockup on white, paper and cream; cream lockup on burgundy and the near-black footer; monochrome only where a single ink is required.
- Give it clear space and keep it legible. On the site the lockup is never shorter than 40 px, and the mark alone never smaller than 16 px (favicon).

## Partner mark: RCCG Young Adults & Youths

The footer credits the programme's parent ministry: "An initiative of RCCG National Young Adults and Youth Affairs", beside the RCCG Young Adults & Youths emblem. The owner supplied the emblem on 2026-09-30.

- `partners/rccg-yaya-supplied.webp`: the logo as supplied (1080×1080, on white). Never edit it.
- `partners/rccg-yaya-transparent.png`: the same logo with its white page made transparent (672×935), for use on any background.
- `src/assets/brand/rccg-yaya-emblem.webp`: the footer's copy (138×192, three times its 64 px display height).

Rules:
- As with the lockup, use it as supplied: don't redraw, recolour, re-type or crop it, the crown included.
- Its own whites (the ring behind the lettering, the ribbon and its curled ends) are part of the emblem and stay white.
- On the site keep it at least 48 px tall, with clear space around it.
- It is RCCG's mark: use it only to credit RCCG National Young Adults and Youth Affairs.

To rebuild after the supplied file changes, run `python3 scripts/partner-logo.py` (Python 3 with Pillow and numpy). Only white connected to the image's edges becomes transparent, plus the enclosed pockets listed in the script. Check the result on the dark footer and on white before committing.

## Regenerating the web files

```bash
python3 scripts/brand-assets.py
```

It needs Python 3 with Pillow (`python3 -m pip install pillow`). The outputs are committed and listed at the top of the script. Run it only when these masters change, then run `pnpm check`.
