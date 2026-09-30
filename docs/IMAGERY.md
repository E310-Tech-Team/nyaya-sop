# Imagery: policy, records and sources

**Last updated:** 2026-09-30
**Status:** The supporting photographs are **AI-generated** (the owner's decision of 2026-09-29, which replaces the earlier rule that only permission-cleared RCCG NYAYA photos could be used). Fifteen are in the site, one per placement: the original nine, and six added on 2026-09-30 so that no photo appears in two places (§6). The homepage hero, the brand artwork and the Biblical Blueprint paintings are unchanged.

Related: [04 §7 Imagery](04-UI-UX-Design-Brief.md#7-imagery) · [06 Phase 10](06-Implementation-Plan.md#phase-10-supporting-imagery-done-2026-09-29) · [`scripts/imagery-assets.py`](../scripts/imagery-assets.py) · [`design/imagery/2026-09-29/prompts.json`](../design/imagery/2026-09-29/prompts.json)

---

## 1. Policy

- **Never change the homepage hero** (`hero-participants.webp` and the hero artwork): its files, crops, positioning, references or animation.
- **Never generate or redraw brand artwork** (the logo and its usage rules: [design/brand](../design/brand/README.md)).
- **The Biblical Blueprint paintings stay** (`/about`). They show named biblical figures (Deborah, Joseph, Nehemiah, Paul, Daniel) in period settings, and modern programme photographs would lose that meaning. Reviewed 2026-09-29. A future replacement must keep the named figure, a historically appropriate setting and modest period clothing, and be labelled as an AI-generated artistic interpretation.
- **Supporting photographs may be AI-generated**, photorealistic images:
  - fictional, clearly adult Nigerian young adults (about 18–30), with the natural diversity of Nigerian faces and a range of brown and dark skin tones, never one uniform look; no real or recognisable people and no public figures;
  - modest, well-fitted professional or smart-casual clothing (opaque fabrics, comfortable coverage), varied rather than uniforms; brand colours as accents, never as a skin grade;
  - contemporary Nigerian learning, professional and community settings; soft believable light; visible skin texture;
  - no readable text, logos, signage, invented RCCG branding, certificates or grades; screens face away.
- **Never present a generated image as real.** Alt text describes the visible scene only. No captions such as "Our previous cohort" or "RCCG participants at the boot camp".
- **Disclosure:** the site footer ("About our images") names the sections whose photographs are AI-generated, and the success page has its own line. Keep that wording accurate when placements change. The hero is deliberately not covered by the note (its origin is not recorded).
- **Review before adopting** (§5): hands and limbs, duplicate or cloned faces, eyes, teeth and skin, lighting and perspective, text and logos, clothing, crops at every breakpoint, fit with the section.
- Authentic, permission-cleared NYAYA photos may still replace generated ones later (research: Appendix). Update the disclosure when they do.
- Record every image in §4 before it ships.

## 2. Current supporting photographs

| File (`src/assets/…`) | Used on | Shows | Source |
|---|---|---|---|
| `landing/vision-portrait.webp` | `/about` Vision & Mission | Three young professionals planning around a laptop and notebook | AI-generated, 2026-09-29 |
| `landing/doctrine-study-group.webp` | `/programme` Doctrine | Three young adults discussing open books in a library | AI-generated, 2026-09-29 |
| `landing/journey-01-apply.webp` | `/journey` stage 01 | A young woman at a laptop at home (screen away) | AI-generated, 2026-09-29 |
| `landing/journey-02-virtual-training.webp` | `/journey` stage 02 | A young man in headphones taking notes during an online session | AI-generated, 2026-09-29 |
| `landing/journey-03-merit-selection.webp` | `/journey` stage 03 | Two young professionals writing in notebooks | AI-generated, 2026-09-29 |
| `landing/journey-04-boot-camp.webp` | `/journey` stage 04 | Five young adults in a planning exercise at a workshop table | AI-generated, 2026-09-29 |
| `landing/journey-05-mentorship.webp` | `/journey` stage 05 | A mentor with two young professionals taking notes | AI-generated, 2026-09-29 |
| `landing/journey-06-community.webp` | `/journey` stage 06 | Young professionals talking in small groups in a courtyard | AI-generated, 2026-09-29 |
| `success/student-portrait.webp` | `/apply/success` | A smiling young man in a suit holding a laptop (circular cut-out) | AI-generated, 2026-09-29 |
| `landing/home-about.webp` | Homepage About preview (from 1280 px) | Two young professionals talking as they walk through a courtyard | AI-generated, 2026-09-30 |
| `landing/home-programme.webp` | Homepage Programme preview (from 1280 px) | A young woman reading at a sunlit library desk | AI-generated, 2026-09-30 |
| `landing/programme-virtual.webp` | `/programme` Virtual training card | A young woman in headphones at a laptop at her home desk | AI-generated, 2026-09-30 |
| `landing/programme-merit.webp` | `/programme` Merit-based selection card | A young man with glasses writing in a notebook | AI-generated, 2026-09-30 |
| `landing/programme-bootcamp.webp` | `/programme` Physical boot camp card | Three young professionals in a training-room discussion | AI-generated, 2026-09-30 |
| `landing/programme-community.webp` | `/programme` Mentorship and community card | A mentor talking with two young professionals on a terrace | AI-generated, 2026-09-30 |

They replaced the Figma Make prototype's photos, which were generic stock-style or AI images with problems of their own: invented "Redemption City" and summit banners, invented name tags on a video call, a fake certificate and scorecard, and an Apple logo.

## 3. Workflow, crops and optimisation

- **Masters:** `design/imagery/<date>/masters/*.webp` (2026-09-29: the original nine; 2026-09-30: the homepage previews and `/programme` cards), full resolution, WebP quality 92, committed. Each batch's `prompts.json` sits beside them. The generator's original PNGs are in `design/imagery/<date>/originals/` (gitignored) and in the tool's own output folder.
- **Site files:** `python3 scripts/imagery-assets.py` resizes each master to at most 1200 px on the long edge (the success portrait to 872 px, keeping its transparent circle) and writes WebP quality 80, method 6, under the existing file names, so no imports change.
- **Crops happen in the browser** (`object-fit: cover`), with a focus (`object-position`) per slot so faces survive every crop:

  | Slot | Displayed at | Focus |
  |---|---|---|
  | `vision-portrait` | `/about`: column width × 430 px on phones and tablets (0.63:1 to 1.77:1); 500 × 600 on desktop | `50% 15%` |
  | `doctrine-study-group` | `/programme` Doctrine: column × 360 px on phones and tablets (0.76:1 to 2.1:1, radius 24); 480 × 648 on desktop | `50% 25%` |
  | `home-about` | Homepage About preview, 440 × 520 (from 1280 px) | `50% 15%` |
  | `home-programme` | Homepage Programme preview, 420 × 480 (from 1280 px) | `50% 25%` |
  | `journey-01` to `journey-06` | Journey cascade cards, 380 × 196 (desktop only); `journey-04` carries the "Selected participants only" badge top-left | `50% 10%` (01, 06), `50% 15%` (02, 03, 05), `50% 50%` (04) |
  | `programme-virtual`, `-merit`, `-bootcamp`, `-community` | `/programme` cards, 168 / 200 / 240 px tall × card width: 1.7:1 to about 3.6:1 on large phones. The boot camp card carries the badge top-left | `50% 22%`, `50% 28%`, `50% 30%`, `50% 30%` |
  | `student-portrait` | 284 px circle on phones; up to 443 px square on desktop | (whole image) |

  The focus lives in `JOURNEY_ART` (`JourneySection.tsx`), `PHASE_ART` (`programmePhotos.ts`) and the classes in `VisionMission.tsx`, `Previews.tsx` and `Doctrine.tsx`. `src/components/landing/imagery.test.ts` checks that no photo is used in two placements and that the card photos' alt text never claims real participants or events.
- **Adding or replacing an image:** generate it within §1, review it (§5), save the master, add it to `IMAGES` in the script and run it, set the alt text and focus, record it in §4, run `pnpm check`, then review the slot at 320, 390, 768, 1280, 1440 and 1920 px.

## 4. Asset records

All nine were generated on 2026-09-29 with the same tool, supplied by the owner with `prompts.json`, then reviewed, cropped and optimised here. The recorded prompts for 02, 03 and 04 begin with a stray `undefined` line (probably an unfilled template field in the generating workflow); they are reproduced as recorded. No prompt was recorded for the Vision, Doctrine and Apply (01) images.

### 4.1 `landing/vision-portrait.webp`

| | |
|---|---|
| Placement | `/about` Vision & Mission |
| Alt text | "Three young professionals discussing plans around a laptop and notebook" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/vision.webp` (original: `exec-e2b18210-6f1e-4a39-9381-731863d8cec1.png`) |
| Crop and optimisation | Focus `object-position: 50% 15%`. Master 1122×1402 (4:5, 157 KB). Site file 960×1200, 61 KB. Displayed as tall crops on phones and on desktop, and wide on tablets (up to 1.77:1): the focus keeps all three heads with some headroom. |

**Prompt:** not recorded by the generating tool (`prompts.json` has none for this image). The scene is described by the alt text above.

### 4.2 `landing/doctrine-study-group.webp`

| | |
|---|---|
| Placement | `/programme` Doctrine of Purpose |
| Alt text | "Three young adults talking through open books at a library table" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/doctrine.webp` (original: `exec-88aa37dc-06dd-44c0-b712-808f16480c7e.png`) |
| Crop and optimisation | Focus `object-position: 50% 25%`. Master 1086×1448 (3:4, 167 KB). Site file 900×1200, 65 KB. The tablet crop (up to 2.1:1) keeps the three faces and the explaining gesture. |

**Prompt:** not recorded by the generating tool (`prompts.json` has none for this image). The scene is described by the alt text above.

### 4.3 `landing/journey-01-apply.webp`

| | |
|---|---|
| Placement | `/journey` stage 01 (desktop cards) |
| Alt text | "A young woman working on a laptop at a desk at home" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/journey-01-apply.webp` (original: `exec-c4e50b18-c836-4a56-b0a1-d4c244f334a5.png`) |
| Crop and optimisation | Focus `object-position: 50% 10%`. Master 1536×1024 (3:2, 129 KB). Site file 1200×800, 48 KB. Screen faces away; plain laptop lid. |

**Prompt:** not recorded by the generating tool (`prompts.json` has none for this image). The scene is described by the alt text above.

### 4.4 `landing/journey-02-virtual-training.webp`

| | |
|---|---|
| Placement | `/journey` stage 02 card |
| Alt text | "A young man in headphones taking notes during an online session" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/journey-02-virtual-training.webp` (original: `exec-26765e5e-13cf-4359-b007-c62c20fc509b.png`) |
| Crop and optimisation | Focus `object-position: 50% 15%`. Master 1536×1024 (3:2, 160 KB). Site file 1200×800, 59 KB. The widest card crop (about 4.3:1 on large phones) keeps his face. |

<details><summary>Generation prompt (as recorded)</summary>

```text
undefined
Landscape 3:2 photograph. A Nigerian man aged 26 with neatly groomed short curls, wearing a cream collared shirt and understated burgundy tie, participating in an online learning session at a simple tidy Lagos home-study desk. He wears discreet headphones and listens thoughtfully to a laptop angled away from camera, a notebook beside it. Mid-torso three-quarter portrait at eye level, the face, headset and laptop all contained in the central horizontal band with ample headroom for a wide card crop. Soft side window light, textured neutral wall and unfussy shelves, not a luxury office. No readable screen.
```

</details>

### 4.5 `landing/journey-03-merit-selection.webp`

| | |
|---|---|
| Placement | `/journey` stage 03 card |
| Alt text | "Two young professionals writing in notebooks at a library table" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/journey-03-merit-selection.webp` (original: `exec-706f25c8-a568-4f8e-8300-ba5c0eee54d6.png`) |
| Crop and optimisation | Focus `object-position: 50% 15%`. Master 1536×1024 (3:2, 203 KB). Site file 1200×800, 70 KB. No certificates, scores or results. |

<details><summary>Generation prompt (as recorded)</summary>

```text
undefined
Landscape 3:2 photograph. Two young Nigerian professionals aged 24–28, a dark-skinned woman with neat braids in a tailored navy blazer and modest cream blouse and a brown-skinned man in a charcoal blazer and collared shirt, seated side by side at a learning-space table concentrating independently on an assessment exercise in open notebooks. Natural thoughtful faces, relaxed posture, no results and no suggestion of winning. Eye-level wide medium shot with faces and notebooks in central 70% height, ample breathing room for a 2:1 crop. Paper content indistinct, no certificates, no scorecards, no readable text.
```

</details>

### 4.6 `landing/journey-04-boot-camp.webp`

| | |
|---|---|
| Placement | `/journey` stage 04 card (it carries the "Selected participants only" badge top-left) |
| Alt text | "Five young adults working through a planning exercise at a workshop table" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/journey-04-boot-camp.webp` (original: `exec-83de5a20-daee-4b7a-bfb4-c7d665f5860e.png`) |
| Crop and optimisation | Focus `object-position: 50% 50%`. Master 1774×887 (2:1, 226 KB), an edit of an earlier version (`exec-c27d562c…`, not used) pulled back for wide cards. Site file 1200×600, 71 KB. The top-left is plain wall for the badge. |

<details><summary>Generation prompt (as recorded)</summary>

```text
undefined
Landscape 3:2 photograph. Five Nigerian young adults, three women and two men aged 23–29, actively collaborating around a table during a structured leadership workshop in a contemporary Nigerian community learning centre. Varied brown and dark skin, distinct faces, natural twists and braids, neat short hair. Modest tailored corporate clothing: navy suit, burgundy blazer over high-neck blouse, cream long-sleeve midi dress, charcoal jacket, light blue collared shirt. One woman explains an idea while others listen with subtle warm expressions. Unmarked paper planning cards on table, soft daylight. Eye-level candid medium-wide composition, faces clustered centrally with generous safe margins, heads and hands retained in wide crop. No matching T-shirts, no cheering, no banners, no readable text.
```

Revision prompt (an edit of the earlier version):

```text
Use case: precise-object-edit. Edit this fictional photorealistic Nigerian leadership workshop image for a wide website card. Keep the same five people, their natural skin tones, modest corporate outfits and the collaborative planning scene. Reframe as a much wider, pulled-back 2:1 landscape photograph: all five must be seated at similar head height, with generous clear room above every head (at least 20% of image height), all faces and hands fitting in the middle 65% height. The existing upper heads are too close to the edge; fix this. Preserve believable anatomy, natural daylight, contemporary Nigerian learning centre context, varied expressions and paper cards. No readable text, logos or banners. The top-left corner must be quiet clear wall, suitable for an existing UI badge without covering faces. Output one finished photograph, not a collage.
```

</details>

### 4.7 `landing/journey-05-mentorship.webp`

| | |
|---|---|
| Placement | `/journey` stage 05 card |
| Alt text | "An experienced mentor talking with two young professionals who are taking notes" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/journey-05-mentorship.webp` (original: `exec-6649ce75-3143-4eb7-b4f1-cb2146fc20af.png`) |
| Crop and optimisation | Focus `object-position: 50% 15%`. Master 1536×1024 (3:2, 171 KB). Site file 1200×800, 59 KB. |

<details><summary>Generation prompt (as recorded)</summary>

```text
Use case: photorealistic-natural. Create one premium editorial photograph for a Nigerian youth leadership and Christian formation programme website. Fictional clearly adult Nigerian subjects aged 22–29 unless specified, distinct believable faces and varied natural brown/dark skin tones. Modest contemporary corporate clothing, opaque fabrics, covered chest and shoulders, refined Gen Z tailoring. Natural expressions and skin texture, realistic hands and anatomy. Soft believable daylight, true skin colour, warm neutral environment with restrained burgundy/cream/navy accents. Real photographic optics and candid energy, not illustration, cartoon, CGI, glamour or plastic skin. No readable text, signage, logos, watermarks, certificates, brand names or pretend real event documentation. No public figures. Respect the exact framing requested; one photograph only, not a collage.
Landscape 3:2 photograph. A Nigerian female mentor aged around 45 in a modest muted burgundy blazer and cream blouse, with short natural hair, in a respectful conversation with two clearly adult Nigerian young professionals aged 25–28: a dark-skinned man in navy jacket and pale collared shirt and a brown-skinned woman with neat braids in a charcoal tailored jacket. Three seated close together around a small table, all faces clearly visible, mentor speaking gently while mentees listen and take notes. Warm contemporary Nigerian meeting room, daylight. Eye-level medium-wide view, all heads clustered across central half of frame, generous headroom; preserve faces when cropped to a wide website card. No readable paper, no logos.
```

</details>

### 4.8 `landing/journey-06-community.webp`

| | |
|---|---|
| Placement | `/journey` stage 06 (desktop cards) |
| Alt text | "Young professionals talking in small groups in a courtyard" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/journey-06-community.webp` (original: `exec-f53b2171-0340-4178-9b6b-eba59bba6f4a.png`) |
| Crop and optimisation | Focus `object-position: 50% 10%`. Master 1536×1024 (3:2, 234 KB). Site file 1200×800, 86 KB. |

<details><summary>Generation prompt (as recorded)</summary>

```text
Use case: photorealistic-natural. Create one premium editorial photograph for a Nigerian youth leadership and Christian formation programme website. Fictional clearly adult Nigerian subjects aged 22–29 unless specified, distinct believable faces and varied natural brown/dark skin tones. Modest contemporary corporate clothing, opaque fabrics, covered chest and shoulders, refined Gen Z tailoring. Natural expressions and skin texture, realistic hands and anatomy. Soft believable daylight, true skin colour, warm neutral environment with restrained burgundy/cream/navy accents. Real photographic optics and candid energy, not illustration, cartoon, CGI, glamour or plastic skin. No readable text, signage, logos, watermarks, certificates, brand names or pretend real event documentation. No public figures. Respect the exact framing requested; one photograph only, not a collage.
Landscape 3:2 photograph. Six distinct Nigerian young adult professionals aged 23–29 networking in two natural conversational clusters at a bright modest community learning centre courtyard. Three women and three men with varied brown and deep dark skin tones, natural hairstyles, neat braids and short hair. Tailored navy trousers and blazers, cream modest midi dress with sleeves, charcoal jacket, muted burgundy long-sleeve blouse, light blue collared shirt. Candid mid-conversation, one person holding a plain notebook, quiet confident smiles, no looking at camera. Eye-level wide environmental photograph framed from waist up, faces in central vertical band for a wide crop, soft greenery and cream building behind. No banners, crowd of clones, matching uniforms, signage or event branding.
```

</details>

### 4.9 `success/student-portrait.webp`

| | |
|---|---|
| Placement | `/apply/success` portrait |
| Alt text | "A smiling young man in a suit holding a laptop" |
| Status | **AI-generated.** Fictional people; not RCCG participants, applicants or events |
| Tool / model | Codex built-in image generator (`image_gen`); the tool does not name the model |
| Created | 2026-09-29 |
| Master | `design/imagery/2026-09-29/masters/success-portrait.webp` (original: `exec-d6325841-b95c-4dcf-8613-0517050dd821.png`) |
| Crop and optimisation | Focus `object-position: (none: shown whole)`. Master 1254×1254 with a transparent circle outside the photo (164 KB). Site file 872×872, 58 KB, alpha kept (resized on premultiplied alpha). An almost identical alternate (`exec-60d6a3c4…`) was not used. |

<details><summary>Generation prompt (as recorded)</summary>

```text
Use case: photorealistic-natural. Create one premium editorial photograph for a Nigerian youth leadership and Christian formation programme website. Fictional clearly adult Nigerian subjects aged 22–29 unless specified, distinct believable faces and varied natural brown/dark skin tones. Modest contemporary corporate clothing, opaque fabrics, covered chest and shoulders, refined Gen Z tailoring. Natural expressions and skin texture, realistic hands and anatomy. Soft believable daylight, true skin colour, warm neutral environment with restrained burgundy/cream/navy accents. Real photographic optics and candid energy, not illustration, cartoon, CGI, glamour or plastic skin. No readable text, signage, logos, watermarks, certificates, brand names or pretend real event documentation. No public figures. Respect the exact framing requested; one photograph only, not a collage.
Square photographic portrait with a precise large circular photo boundary and genuinely transparent corners outside the circle, designed to sit over an existing circular halo. Inside the circle: a Nigerian man aged 26 with deep brown skin, close-cropped natural hair, clean grooming, tailored navy blazer over a cream collared shirt, holding a closed unbranded laptop against his torso. Natural warm confident smile looking slightly off-camera, quiet satisfaction. Chest-up portrait, whole head and shoulders safely inside circle with generous headroom. Soft neutral cream studio/office background INSIDE the circle. Photorealistic skin and hands, eye-level premium editorial photography. No brand logo on laptop. No extra border, no checkmark, no decorative graphics. Outside the circular photo must be transparent alpha.
```

</details>

## 5. Review (2026-09-29)

Each image was checked at full size, and then in its real containers at 320, 390, 768, 1280, 1440 and 1920 px (headless Chrome, normal and reduced motion).

- **Passed, all nine:** natural hands and gestures (no extra or malformed fingers), distinct faces with no clones, natural eyes, teeth and skin texture, consistent light and perspective. No readable text, logos, signage or certificates (laptop lids are plain, screens face away, book and page text is indistinct). Modest, varied professional clothing. Every crop keeps the faces; the boot-camp badge sits on plain wall.
- **Variety note:** braids appear in most images and locs in none; natural short hair, twists, relaxed hair and an older mentor are represented. Worth widening in future additions.
- **Not used:** two alternates kept with the originals (the boot-camp image before its reframing edit, and a second success portrait).
- **Site checks:** every photo loads, at full opacity; lazy loading as before (the success portrait, above the fold, loads straight away); no horizontal overflow and no layout shift on the marketing pages. The homepage hero is pixel-identical to `main` at 390, 768, 1440 and 1920 px. Results: [06 Phase 10](06-Implementation-Plan.md#phase-10-supporting-imagery-done-2026-09-29).

## 6. Unique placements (2026-09-30)

Each supporting photograph now belongs to one editorial placement. Responsive mobile/desktop renditions of that same placement may use the same file; unrelated sections and pages must not. The hero, logo and decorative artwork are unchanged.

Six additional fictional Nigerian professional scenes were generated with the built-in image_gen tool (model not exposed), with modest corporate outfits and natural skin tones. Full prompts, generation date, placements and master paths are recorded in [the generation manifest](../design/imagery/2026-09-30/prompts.json). Masters are stored beside it; `scripts/imagery-assets.py` exports WebP quality 80 at at most 1200 px.

| Asset | Exclusive placement | Scene / alt text | Focus |
|---|---|---|---|
| home-about.webp | Homepage About preview | Two young professionals talking as they walk through a courtyard | 50% 15% |
| home-programme.webp | Homepage Programme preview | A young woman reading a book at a sunlit library desk | 50% 25% |
| programme-virtual.webp | Programme virtual training | A young woman wearing headphones beside a laptop at her home desk | 50% 22% |
| programme-merit.webp | Programme merit selection | A young man with glasses writing in a notebook at a quiet desk | 50% 28% |
| programme-bootcamp.webp | Programme physical boot camp | Three young professionals seated together in a training-room discussion | 50% 30% |
| programme-community.webp | Programme mentorship/community | A mentor talking with two young professionals on a garden terrace | 50% 30% |

Existing Journey photos now appear only on Journey. Vision and Doctrine photos appear only on their dedicated pages. The existing AI disclosures continue to cover all placements. A regression check verifies that the 15 supporting-photo references are unique.

**Review and browser check (2026-09-30):** all six passed the §1 review (natural hands and faces, modest varied tailoring, no readable text, logos or certificates; locs, twists, glasses and an older mentor widen the variety). In headless Chrome on a local production build at 320, 390, 600, 639, 700, 767, 768, 1280, 1440 and 1920 px, every photo appears on exactly one page, loads at full opacity, keeps every face in view and causes no overflow or layout shift. The `/programme` focus values were raised (22 to 30%) so heads keep their headroom in the widest card crops (about 3.6:1) and the boot camp badge clears the heads; at those widths the writing hands are trimmed instead. The boot camp photo is a calm seated discussion, a looser fit for a physical camp than the brief's "structured leadership workshop": a candidate for regeneration.

---

## Appendix: authentic-photo research (2026-09-26)

Kept for the day NYAYA grants permission for its own photographs. Nothing below is in the site.

### A1. Sources checked (2026-09-26)

**Verified as RCCG NYAYA:**

| Source | Evidence | Photos | Terms |
|---|---|---|---|
| [rccgyouths.org](https://web.archive.org/web/20250221023325/https://rccgyouths.org/) | Titled "Official Website of RCCG National Youth and Young Adults Affairs"; its footer links the YAYA Global accounts below. **Offline:** the domain (registered to 2028) has no DNS record; last archived February 2025 | None found (no gallery) | © 2024 … All rights reserved |
| [rccgyayaglobal.org](https://rccgyayaglobal.org/about) | Lists the RCCG Nigeria National Youth Pastor and Assistant National Youth Pastor in its leadership; hosts NYAYA's RISE flyer | Gallery empty ("No images yet"); events show flyers only | © 2026 … All rights reserved; privacy page silent on images |
| [rccgnyayarise.org](https://rccgnyayarise.org/) (RISE) | States it is "an Initiative of the RCCG National Young Adult & Youth Affairs (NYAYA)"; NYAYA's RISE 29 flyer names this site | **Yes:** RISE 30 training and group photos (§4), all watermarked "RISE 30" | No notice or terms published; no photographer credit |
| [Instagram @rccgyayaglobal](https://www.instagram.com/rccgyayaglobal/) | Verified badge; bio "Official Instagram Page for RCCG Young Adults and Youths Affairs"; linked from both sites above | Public posts are convention flyers; the rest needs an Instagram login | Platform terms only; no reuse permission |
| [Instagram @rccgnyaya_rise](https://www.instagram.com/rccgnyaya_rise/) | Named on NYAYA's RISE flyer and the RISE site | A RISE 31 practical-skills carousel (24 Sept 2026, "Youth Place, Redemption Camp", 2735×1827): behind a login wall | Platform terms only |
| [Facebook RCCGYAYAGlobal](https://www.facebook.com/RCCGYAYAGlobal/) | Linked from both sites above | Public photos: convention flyers and a humanitarian airport reception (not suitable) | Platform terms only |
| [rccgnyaya.org](https://rccgnyaya.org/) | "RCCG NYAYA" | None: a monthly reporting-form portal | © 2026 RCCG NYAYA. All Rights Reserved |

**Parent church:** [rccg.org](https://web.archive.org/web/20260915140057/https://www.rccg.org/) (archived; the live site blocked automated access) links no youth-affairs site. Its "Media Resources" folder holds Convention 2026 print artwork, not photographs. Footer: © RCCG 2026, all rights reserved.

**Not verified, not used:** Instagram `@rccgnyaya` and `@theyouthplace_rccg_` (no link from an official NYAYA site found). YouTube `@rccgyayaglobal` is linked officially but holds video, not photos.

**No openly licensed alternative:** no Creative Commons RCCG youth photography found (Wikimedia Commons, Flickr).

### A2. Candidates (still without permission)

All: **credit** "RCCG NYAYA RISE" (photographer not named); **context** RISE 30, NYAYA's Redeemed Initiative for Skills and Empowerment (a skills programme, not the Purpose Boot Camp); **issue** a "RISE 30" watermark in the lower centre, which may not be cropped out. **Usage permission: unknown, so none of these is in the site.** Ask NYAYA/RISE for written approval and the unwatermarked originals.

| # | Source file | Shows | Suggested slot |
|---|---|---|---|
| P1 | [MG_7750-scaled.jpg](https://rccgnyayarise.org/wp-content/uploads/2026/03/MG_7750-scaled.jpg) (2560×1978, [home page](https://rccgnyayarise.org/)) | Young adults at laptops, an instructor standing | Virtual training (`/programme`, Journey stage 02) |
| P2 | [MG_7013-980x757.jpg](https://rccgnyayarise.org/wp-content/uploads/2026/03/MG_7013-980x757.jpg) (980×757; ask for the original) | An attentive seated audience in a training hall | Doctrine of Purpose |
| P3 | [MG_7418-scaled.jpg](https://rccgnyayarise.org/wp-content/uploads/2026/03/MG_7418-scaled.jpg) (2560×1829) | A facilitator guiding a small group | Mentorship. Busy sponsor-poster backdrop; a tight crop would be needed |
| P4 | [MG_7400-scaled.jpg](https://rccgnyayarise.org/wp-content/uploads/2026/03/MG_7400-scaled.jpg) (2560×1707) | A small group working at laptops | Vision & Mission (workshop). Same poster-wall issue |
| P5 | [0G7A7002-scaled.jpg](https://rccgnyayarise.org/wp-content/uploads/2026/03/0G7A7002-scaled.jpg) (2560×1707, [gallery](https://rccgnyayarise.org/gallery-2/)) | Seven participants in a huddle, hands joined, outdoors | Community (Journey stage 06) |
| P6 | [0G7A6990-scaled.jpg](https://rccgnyayarise.org/wp-content/uploads/2026/03/0G7A6990-scaled.jpg) (2560×1707, gallery) | Outdoor group photo of about 20 participants | Community (wide) |
| P7 | [Instagram RISE 31 post](https://www.instagram.com/rccgnyaya_rise/p/DdrfK-AGdRr/) (24 Sept 2026) | Practical-skills training at the Youth Place, Redemption Camp | Workshop slots, once viewable and approved |

Seen and rejected: other RISE gallery photos (recreation and a baking practical: off-topic), every flyer and speaker card, and the airport-reception photos.

### A3. Gaps found then

| Slot | Note |
|---|---|
| Physical boot camp (`journey-04`) | **Highest priority.** No photo of a Purpose Boot Camp exists yet (first edition), and RISE photos would misrepresent it. Options: a permitted NYAYA photo from a Redemption City youth event, captioned as such, or a neutral image without invented signage |
| Mentorship (`journey-05`) | Only P3 (branded backdrop) |
| Apply (`journey-01`), Merit selection (`journey-03`) | No authentic equivalents; consider a real assessment or graduation photo when available |
| Success page portrait | Not searched (application flow) |
