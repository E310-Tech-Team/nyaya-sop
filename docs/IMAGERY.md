# Imagery: sources, permissions and candidates

**Last updated:** 2026-09-26
**Status:** Audit and source search done. **No photograph has been replaced yet:** none of the authentic RCCG NYAYA photos found has usage permission, and every suitable one carries a burned-in programme watermark. The candidates below wait for written permission (and ideally the original, unwatermarked files) from NYAYA.

Related: [04 §7 Imagery](04-UI-UX-Design-Brief.md#7-imagery) · [06 Phase 10](06-Implementation-Plan.md#phase-10-authentic-photography-blocked-on-permission)

---

## 1. Rules

- **Never change the homepage hero images** (`hero-participants.webp` and the hero artwork), their files, references or behaviour.
- The Biblical Blueprint paintings, icons, decorative SVGs, logos and backgrounds are out of scope.
- A supporting photo is only replaced by an **authentic photo from a verified RCCG NYAYA source** with **permission to reuse** (written approval, or published terms that allow it). Public availability is not permission.
- Never crop out, cover or remove watermarks or credits. Never hotlink: approved files are downloaded into `src/assets/`.
- Match the photo to its real context. A photo from another NYAYA programme (for example RISE) must not be presented as the Purpose Boot Camp; its alt text describes the visible scene only and doesn't name people.
- Record every adopted photo in §6 before it ships.

## 2. Current supporting photographs

All came with the Figma Make prototype. They are generic stock-style or AI-generated images, not RCCG photography. Several show invented signage, which the site should not present as real events.

| File (`src/assets/…`) | Used on | Shows | Problem |
|---|---|---|---|
| `landing/vision-portrait.webp` (1200×675) | `/about` Vision & Mission; homepage About preview (≥ 1280 px) | A woman arranging sticky notes on a planning wall | Generic stock-style; not RCCG |
| `landing/doctrine-study-group.webp` (896×1200) | `/programme` Doctrine; homepage Programme preview (≥ 1280 px) | Young adults studying round a library table | Generic; not RCCG |
| `landing/journey-01-apply.webp` (1200×805) | `/journey` stage 01 (desktop) | A woman filling in a form on a tablet in a café | Generic |
| `landing/journey-02-virtual-training.webp` (1200×805) | `/journey` stage 02; `/programme` Virtual training | A woman in a video call; the other tiles carry invented name tags | Generated; invented people |
| `landing/journey-03-merit-selection.webp` (1200×805) | `/journey` stage 03; `/programme` Merit-based selection | A "Certificate of Achievement" and scorecard dated 2024 | Generated document; not a real NYAYA certificate |
| `landing/journey-04-boot-camp.webp` (1200×805) | `/journey` stage 04; `/programme` Physical boot camp | Young people cheering under a "Redemption City Team Building Seminar" banner, in matching T-shirts | **Priority.** Invented Redemption City signage (with generative spelling errors) next to the words "Redemption City": reads as a real RCCG event |
| `landing/journey-05-mentorship.webp` (1200×805) | `/journey` stage 05; `/programme` Mentorship and community | An older man mentoring two young professionals | Generic |
| `landing/journey-06-community.webp` (1200×805) | `/journey` stage 06 | A crowd under "African Leadership Forum" and "Unity in Innovation 2024 Summit" banners | Unrelated, invented event branding |
| `success/student-portrait.webp` (872×872) | `/apply/success` | A young man holding a laptop | Generic (application flow; not part of this search) |

## 3. Sources checked (2026-09-26)

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

## 4. Candidates awaiting permission

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

## 5. Gaps (no suitable authentic image found)

| Slot | Note |
|---|---|
| Physical boot camp (`journey-04`) | **Highest priority.** No photo of a Purpose Boot Camp exists yet (first edition), and RISE photos would misrepresent it. Options: a permitted NYAYA photo from a Redemption City youth event, captioned as such, or a neutral image without invented signage |
| Mentorship (`journey-05`) | Only P3 (branded backdrop) |
| Apply (`journey-01`), Merit selection (`journey-03`) | No authentic equivalents; consider a real assessment or graduation photo when available |
| Success page portrait | Not searched (application flow) |

## 6. Adopting an approved photo

1. Get written permission (who approved it, when, and the credit line required) and the original file. Add a row to the record below.
2. Crop for the slot and export WebP as the existing assets were: at most 1200 px on the long edge, quality 80, method 6, under the same filename, so no code changes are needed. Check faces at every breakpoint; use `object-position` if the subject is off-centre.

   | Slot | Displayed at |
   |---|---|
   | `vision-portrait` | Phones: column width × 430 px; desktop 500 × 600 px; homepage preview 440 × 520 px (portrait crops of the file) |
   | `doctrine-study-group` | Phones: column × 360 px (radius 24); desktop 480 × 648 px; homepage preview 420 × 480 px |
   | `journey-0N` | Journey cascade cards 380 × 196 px (desktop only); `/programme` cards 168 / 200 / 240 px tall × card width (up to ≈ 630 px) |

3. Update the alt text where the image is used (`VisionMission.tsx`, `Previews.tsx`, `Doctrine.tsx`, `JourneySection.tsx` via `JOURNEY_ART`). Describe the scene only, for example "Young adults working at laptops during a skills workshop".
4. Run `pnpm check`, review the slot at 390, 768 and 1440 px, and confirm the hero files are untouched.

**Record of adopted photos**

| Local file | Original source URL | Credit | Event / context | Permission | Page and section |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
