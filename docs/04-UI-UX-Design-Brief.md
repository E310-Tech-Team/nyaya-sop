# 04 — UI/UX Design Brief

**Last updated:** 2026-10-01
**Brand source:** the brand guideline "School of Purpose 4.pdf" (logo lockups, rationale, palette), with the logo masters in [`design/brand/`](../design/brand/README.md) (§2).
**Design source:** Figma Make project "Prototype Design". Compressed render of the desktop landing page: [`design/landing-reference.webp`](../design/landing-reference.webp). The 15 MB original, `design/landing-reference-figma.png`, is kept locally and git-ignored.
**Implementation:** design tokens in [`src/index.css`](../src/index.css) `@theme` (colour, type) and `:root` (motion). The application screens use the shared components in `src/components/`. The homepage hero and the reused editorial sections (Vision & Mission, Doctrine, Blueprint, the Journey cascade) still use the Figma export's arbitrary values; the newer sections and the shared marketing chrome ([`src/components/marketing/`](../src/components/marketing/)) use the tokens. Programme wording shared across screens lives in [`src/config/programme.ts`](../src/config/programme.ts).

Related: [01-PRD](01-PRD.md) · [03-App-Flow](03-App-Flow.md)

---

## 1. Design direction

**Mood:** warm, editorial, reverent but energetic. It should feel like a premium leadership programme, not a generic church flyer.

- **Burgundy + cream + antique gold**, the brand palette (§2). Burgundy carries authority and brand. Cream keeps long reading comfortable. Gold marks progress, numerals and sacred accents.
- **The official lockup** (the target mark with "RCCG NYAYA / School of / Purpose") in every header, the phone menu, the footer and the admin area.
- **Poster-style condensed headlines** (Anton), a clean sans body (Inter), and a **classical serif** (Cormorant Garamond) for scripture, biblical names and numerals.
- **Pill CTAs with a white circular arrow "knob":** the single primary-action pattern.
- **Numbered structure everywhere** (01, 02 … / I, II, III): a guided, ordered journey.
- **Photography** of young Black professionals and students, plus painted biblical scenes for the doctrine content.

**Voice:** encouraging, scriptural, purposeful; British spelling ("Programme"). Scripture in KJV with citation. Key vocabulary: *purpose, formation, assignment, called, Kingdom impact, Church · marketplace · nation*.

## 2. Colour

### Brand identity

The brand guideline ("School of Purpose 4.pdf") defines the logo, its meaning and the palette. The masters, their original file names and the usage rules are in [`design/brand/README.md`](../design/brand/README.md).

- **Palette:** burgundy `#841D26`, cream `#F3F0E6`, gold `#B69B63`: the `brand`, `cream` and `gold` tokens below. The artwork uses exactly these three colours.
- **The mark** is an archery target read as a journey: the outer ring is the goal (focus, direction), the gold sunburst bullseye the fulfilment of purpose, and the path of rays the journey towards it.
- **The lockup** (mark + "RCCG NYAYA / School of / Purpose") comes from `BrandLockup` ([`src/components/BrandLockup.tsx`](../src/components/BrandLockup.tsx)): `on="dark"` gives cream lettering, `on="light"` burgundy lettering. Sized by height:

| Surface | Version | Height |
|---|---|---|
| Homepage and marketing header, phones and tablets | cream | 48 px |
| Homepage and marketing header, from 1280 px (1440 frame) | cream | 60 px |
| Phone/tablet menu | cream | 56 px |
| Footer | cream | 64 px |
| Application header: burgundy bar (phones, tablets) / paper (desktop) | cream / colour | 40 / 60 px |
| Admin sidebar, with an "Admin" label | cream | 40 px |
| Staff sign-in card, with an "Admin" pill | colour | 44 px |

- Where a link wraps the lockup, the link keeps its name ("School of Purpose: home") and the image has `alt=""`. Elsewhere its alternative text is "RCCG NYAYA School of Purpose".
- Files: two 960×268 WebP lockups (about 20 KB each), content-hashed and precached by the service worker so headers keep their logo offline. Favicons and app icons: §7. All are resized from the masters by `python3 scripts/brand-assets.py`; the logo is never redrawn or recoloured.
- **Footer credit** (below the tagline): the RCCG Young Adults & Youths emblem at 64 px, then "An initiative of RCCG National Young Adults and Youth Affairs".
  - The words "An initiative of" use the footer's gold eyebrow style (as "Navigation"); the organisation's name uses the footer link colour.
  - It's one sentence for screen readers. The emblem has `alt=""`, since the text names it.
  - The emblem is the supplied logo with only its white page made transparent (`design/brand/README.md`, "Partner mark").
- **Emails** keep a text header in burgundy ("RCCG NYAYA / SCHOOL OF PURPOSE") rather than a logo image. Remote images are often blocked, and fetching one would tell the server when someone opens a sign-in or password email.

### Tokens (implemented in `@theme`, usable as `bg-brand`, `text-muted`, `border-line-strong`, …)

| Token | Hex | Role |
|---|---|---|
| `brand` | `#841d26` | **Brand burgundy.** Primary: CTAs, headers, side panel, headings, focus rings |
| `brand-hover` | `#6a171e` | Primary button hover (the brand burgundy, about 20% darker) |
| `brand-deep` | `#4a0e1a` | Done-step tick, admin sidebar, deep accents |
| `ink` | `#202124` | Primary text |
| `muted` | `#665d60` | Secondary text, placeholders, hints |
| `gold` | `#b69b63` | **Brand gold.** Decorative: rules, done-step fill (non-text; 3.60:1 on brand is fine for shapes) |
| `gold-light` | `#dcc28a` | **Gold text on burgundy** (eyebrows, numerals): 5.55:1 |
| `cream` | `#f3f0e6` | **Brand cream.** Page background, light pills on burgundy |
| `paper` | `#fcfaf6` | Inputs, desktop header |
| `rose` | `#f3dce3` | Tints, badges, accents on burgundy |
| `line` | `#d8d0c3` | Card borders, dividers |
| `line-strong` | `#8f8577` | **Form-control borders**: 3.48:1 on paper |

Landing-only colours (arbitrary values from the Figma export; its burgundy, cream and gold are now the brand values): deep burgundies `#3b081a` `#5c1329` `#6b1d2a`, footer `#1a0810`, card darks `#161719` `#202124`. The fixed hero artwork (`src/assets/landing/hero-*.svg`) keeps the prototype's `#8B1E3F` in its thin circle and dot grid, which is indistinguishable at that size and opacity. Success-page confetti colours are decorative.

### Brand palette adopted (2026-09-28)

The prototype's burgundy `#8b1e3f`, creams `#f7f3eb`/`#f4efe6` and golds `#b89b5e`/`#b8962e` were replaced everywhere by the brand palette: tokens, the Figma-export arbitrary values and their `rgba()` tints, the manifest and theme colour, the offline page and the emails. The brand burgundy is slightly darker, so light text on it gains contrast. The brand cream is slightly darker too, so dark text on it loses a little:

| Pair | Before | After |
|---|---|---|
| White on burgundy (buttons, headers) | 8.92:1 | 9.61:1 |
| Burgundy on cream | 8.06:1 | 8.43:1 |
| Gold text (`gold-light`) on burgundy | 5.15:1 | 5.55:1 |
| Rose on burgundy | 6.86:1 | 7.40:1 |
| Gold eyebrow on the footer | 6.85:1 | 7.23:1 |
| Muted text on cream | 5.75:1 | 5.58:1 |

Checked with a text-contrast scan of the production build (about 1,200 text elements on 13 pages at 390 and 1440 px): no failures. It flagged only the disabled "Sign in" button (inactive controls are exempt) and "The Called Generation", whose white panel is a sibling layer rather than an ancestor (it is burgundy on white, 9.61:1). Text over gradients (19 items on `/about` at 1440 px) was left to the eye, as before. axe-core has not been re-run since the change.

### Contrast fixes made (2026-09-26, with the prototype palette)

| Pair | Before | After |
|---|---|---|
| Gold eyebrow/numeral text on burgundy ("STEP 1 OF 3", "COVENANT DOCTRINE", journey numbers) | `#b89b5e` 3.35:1 ✗ | `#dcc28a` 5.15:1 ✓ |
| Input and radio borders on paper | `#bfb3a3` 1.98:1 ✗ | `#8f8577` 3.48:1 ✓ |
| Footer copyright and tagline on `#1a0810` | 34–50% cream ✗ | 62–72% cream ✓ |
| Grey glyph icons on white (mobile success cards) | 1.97:1 | Replaced with the SVG icons and marked decorative |

Result then: **axe-core reported no contrast violations** on any screen.

## 3. Typography

Self-hosted with `@fontsource` (all subsets included; browsers download only what a page uses, e.g. Vietnamese/Latin Extended for Yoruba names such as "Ọláolúwa Adébáyọ̀").

| Token | Family | Role |
|---|---|---|
| `font-display` | Anton 400 | Headlines, section and step titles |
| `font-sans` (default) | Inter Variable 100–900 + italic | Body, labels, buttons, UI |
| `font-serif` | Cormorant Garamond Variable 300–700 + italic | Scripture, biblical names, numerals (landing) |

| Use | Mobile | Desktop |
|---|---|---|
| Hero headline | 34–52 px (fluid, `clamp(34px, 9.6vw, 52px)`) | 64 px |
| Success headline | 43 px | 60 px |
| Form section title (`<h1>`) | 38 px | 46 px |
| Side panel / progress title | 31 px | 33 px |
| Body | 14–15 px | 14–16 px |
| Question label | 15 px | 15 px |
| **Input text** | **16 px** (prevents iOS zoom on focus) | 16 px |
| Buttons | 14 px bold | 14–15 px |
| Eyebrows (uppercase, tracked) | 11 px | 11–12 px |
| Hints / errors | 12–13 px | 12–13 px |

The 7–9 px text from the prototype (mobile header badge, taglines, eyebrows, step labels) was raised to **9–12 px**. The smallest remaining text is the 9 px uppercase "Expression of Interest Form" pill in the mobile header.

## 4. Layout

| Aspect | Convention |
|---|---|
| Form screens | **< 1024 px (`lg`)**: 60 px header, then a one-row progress indicator (≈ 56 px: step markers + "Step 1 of 3 / Personal Information"), then the form; content max 840 px, 24–40 px gutters. Nothing is sticky, so inputs, errors and the on-screen keyboard are never covered. The first question starts ≈ 300–400 px from the top on a 390 px phone (≈ 600 px before the 2026-09-26 UX pass). **≥ 1024 px**: 356 px burgundy side panel + form column (unchanged) |
| Marketing pages (`/`, `/about`, `/programme`, `/journey`, `/faq`) | **< 1280 px (`xl`)**: single-column layout, content centred at ≤ 760 px on tablets (`.landing-gutter`); phone layouts are designed for the column (stacked cards, vertical timeline), not scaled-down desktop. **≥ 1280 px**: content laid out on a 1440 px frame with 80 px gutters. Only the homepage hero and the four reused editorial sections (Vision & Mission, Doctrine, Biblical Blueprint, the Journey cascade) are fixed 1440 px compositions (`.landing-desktop`); everything written for the new pages (page intro, previews, Who it serves, How the programme runs, FAQ groups, apply band) is a fluid grid or flex layout with **one responsive tree**. Both use CSS `zoom` = width ÷ 1440 between 1280 and 1440 px (`.landing-desktop` / `.landing-scale`, set by `useLandingZoom`), so type sizes stay consistent from section to section and page to page |
| Page intro (dedicated pages) | Burgundy band under the header: eyebrow, the page's `<h1>` (`clamp(36px, 10vw, 56px)`, 64 px from 1280 px), a lead of at most 680 px; 34/44 px padding on phones, 64/80 px on desktop; a white/10 hairline at its foot (like the header's), so a burgundy section below stays distinct |
| Reading width | Lead paragraphs ≤ 680 px; FAQ answers ≤ 68 characters per line (`max-w-[68ch]`); large statement headings keep hyphenated words whole |
| Headers | Application: mobile 60 px (burgundy; the badge is hidden below 360 px, where it would wrap to four lines); desktop 96 px (paper, bottom border); not sticky |
| Marketing header (sticky) | `StickyHeader` keeps it at the top of the viewport while scrolling in either direction (`position: sticky`, `z-40`: under the menu dialog `z-50` and the skip link `z-100`). **Phones and tablets:** the 78 px burgundy bar (1 px white/10 border on the dedicated pages). **From 1280 px:** a 96 px bar laid out on the 1440 px frame and scaled with it (≈ 85 px at 1280 px). **Homepage from 1280 px:** at the top it lies over the hero exactly as designed (transparent, lockup on burgundy, dark links and burgundy Apply pill on the white panel); it sits outside the zoomed hero and sticks 16 px up, so once scrolled its row is centred in the 96 px bar. **Scrolled** (a 1 px sentinel, one state change, never per scroll event): an opaque burgundy bar with a soft shadow (plus a white/10 hairline where there was no border); on the homepage the nav switches to the white links and cream Apply pill of the other pages, cross-fading without changing size. Height never changes |
| Scroll offsets | On marketing pages anchor targets and every focusable element in `main`/`footer` use `scroll-margin-top: var(--sticky-header-height) + 16px` (79 px phones/tablets, 96 px × zoom + 1 px desktop), so jumps, deep links and keyboard focus land below the header. Deliberately **not** `scroll-padding-top`: with it, focusing anything inside the sticky header made the page jump ≈ 450 px |
| Card | White, 1 px `line` border, radius 16, shadow `0 12px 30px rgba(45,9,20,0.07)` |
| Radii | Pills 999 · cards 16 · media 24–32 · tiles 10 · inputs/choices 8 · checkbox 4 |
| Verified widths | 320, 390, 768, 1024, 1280, 1440, 1920 on all 8 application screens and the 5 marketing pages (2026-09-26, automated): no horizontal scroll at any point of any entrance or reveal, no text cut off by a clipping container, no duplicate ids, every link, button and FAQ question reachable by pointer (hit-tested) |

### Homepage order

A concise overview; the detail lives on the dedicated pages. Each preview keeps the id the old in-page navigation used, so `/#about`, `/#programme`, `/#journey` and `/#faq` still land on the matching topic.

| # | Section (`id`) | Tree | Notes |
|---|---|---|---|
| 1 | Hero (`#top`) | mobile + desktop | Brand lockup + nav (the sticky header: rendered before `<main>`, over the hero from 1280 px), then one short hierarchy: eyebrow **SCHOOL OF PURPOSE · FIRST EDITION** → headline **"Discover your purpose. / Prepare to lead."** (two lines, white then rose; the organisation name is no longer repeated in it) → one supporting sentence → one eligibility line (**For RCCG members aged 18–30**) → **Start my application** (primary: light pill) + **Explore the programme** (outlined; → `/programme`). The participant photograph stays the anchor; "The Called Generation" appears once as a small caption beside it. Desktop: the copy sits at y≈312–700 of the 900 px frame, where the photograph leaves the most room (headline 64 px); the photograph and ring are `pointer-events: none`, since they are drawn over the header's area. Phones: fluid headline (`clamp(34px, 9.6vw, 52px)`, two lines from 360 px, three at 320 px), buttons stacked full-width below 640 px, photograph directly under the buttons (natural height, no 100vh) |
| 2 | What to expect (`#what-to-expect`) | **single** | Four cards in order (First / Then / If selected / Afterwards); the conditional boot-camp card is dark burgundy with a gold "If selected" tag; a note: "Applying doesn’t guarantee a place at the boot camp…"; See the full journey → `/journey` |
| 3 | About preview (`#about`) | **single** | Cream. Purpose statement (h2), Vision and Mission side by side from 768 px, portrait from 1280 px; **About the School of Purpose →** |
| 4 | Programme preview (`#programme`) | **single** | Burgundy. The Doctrine of Purpose and its three questions as translucent rows, study-group photograph from 1280 px; **Explore the programme →** |
| 5 | Journey preview (`#journey`) | **single** | White. The six stages as compact cards (1 / 2 / 6 columns): number, name, one fact; stage 04 is the dark card with "Selected participants only"; **See the full journey →** |
| 6 | FAQ preview (`#faq`) | **single** | Cream. Three questions (who can apply, is everyone selected, what happens after submitting); contact line if configured; **See all questions →** |
| 7 | Closing invitation | shared | Isaiah 58:12, "Start my application" |
| 8 | Footer (`#contact`) | shared | Nav (Home · About · Programme · Journey · FAQ, + Contact when configured, Apply now) + contact email when configured |

### Dedicated pages

Same sticky header on all four (burgundy, lockup links home, nav with the current page marked, cream **Apply** pill); same page intro; same apply band ("Discover your purpose. / Prepare to lead.", eligibility and time to apply, **Start my application** + one related page) and footer.

| Page | Sections after the intro |
|---|---|
| `/about` | Vision & Mission (reused composition) · **Who the programme serves** (eligibility, and the three spheres as tiles) · The Biblical Blueprint (reused) |
| `/programme` | The Doctrine of Purpose (reused) · **How the programme runs**: four photo cards (virtual training; merit-based selection; the physical boot camp, dark with a gold "Selected participants only" tag; mentorship and community), each with its when-tag, title, facts, description and how it continues |
| `/journey` | The intro sets **Applying** apart from **Being selected**; then the six stages: a vertical timeline on phones and tablets, the illustrated cascade with route lines from 1280 px (the old section header is replaced by the page intro) |
| `/faq` | All seven questions in three topic groups (Applying · The programme · Selection and the boot camp), each followed by a link to the page that says more; contact line only when configured |

## 5. Components (`src/components/`)

| Component | Notes |
|---|---|
| `BrandLockup` | The official logo lockup (`on="dark"` cream / `on="light"` burgundy lettering), sized by height; sizes per surface in §2 |
| `SiteHeader` | Brand lockup (links home, never wraps) + badge ("Expression of Interest Form", "Application received"…) |
| `ApplicationLayout`, `StepHeader`, `FormCard`, `FormActions`, `SavedNote`, `Divider` (`FormLayout.tsx`) | Step chrome: compact mobile progress row / desktop side panel, the page `<h1>` (section label shown from 1024 px, where the side panel doesn't repeat it), "* Required" note. `FormActions` always ends with the saved-answers note ("Your answers are saved while this tab stays open.") |
| `TextField`, `SelectField` | `<label>`-associated native controls, hint + error wired with `aria-describedby`, `aria-invalid`; focus ring `0 0 0 3px rgba(132,29,38,.22)` |
| `ParishPicker` | The parish question while the directory is on: an ARIA 1.2 combobox (`role="combobox"` input, `aria-activedescendant`, in-flow `listbox` below it so nothing overlaps the page, options ≥ 52 px tall with the typed words in bold and the chain in muted text), a confirmation card (`role="group"`, read-only `<dl>` of province, region and continent, pill buttons, an `aria-pressed` "Details look wrong?" toggle) and the not-listed name field. One `role="status"` region, mounted in every state, announces result counts, choices and confirmations |
| `ChoiceGroup` (`tiles` / `scale`) | `<fieldset>`/`<legend>` + **native radio inputs** (visually hidden) styled as tiles; arrow-key navigation built in; focus outline via `has-[:focus-visible]` |
| `PrimaryButton`, `PrimaryLink`, `BackLink` | Pill with arrow knob; busy spinner state; `.motion-button` feedback (see §6) |
| `MarketingLayout`, `PageIntro`, `ApplyBand` (`src/components/marketing/PageParts.tsx`) | Layout route for the dedicated pages (header stays mounted, page + footer re-arm scroll reveals per page); the compact page intro with the page's `<h1>`; the closing apply band |
| `MarketingHeader`, `DesktopNav` (`light` / `dark`), `MarketingFooter`, `LightCta`, `OutlineCta`, `CtaRow`, `MoreLink`, `Eyebrow` (`Chrome.tsx`) | Shared marketing chrome. `DesktopNav` renders the same `NavLink`s dark-on-white in the homepage hero and white-on-burgundy on the dedicated pages; the current page gets `aria-current="page"`, extra-bold weight and a resting underline. `MoreLink` is the underlined "read more" link (≥ 44 px tall) |
| `useMobileMenu`, `MenuButton`, `MobileMenu` (`MobileMenu.tsx`) | The phone/tablet menu dialog used by every marketing page: slide-in drawer, scroll lock, focus on Close, Escape and focus trap, focus back to the button, closes on any page change (including Back); the current page is gold. Links come from `nav.ts` (`MAIN_NAV`, `CONTACT_LINK`) |
| `WhatToExpect`, `Faq` parts (`FaqItem`, `FaqList`, `FaqContact`), `Previews` (`src/components/landing/`) | Single-tree sections; copy from `src/config/programme.ts` |
| `VisionMission`, `Doctrine`, `Blueprint`, `JourneySection`, `ClosingInvitation` (`src/components/landing/`) | The editorial sections, moved unchanged out of the old homepage and reused on the dedicated pages (the Journey section now has no header of its own; its stages are the page's `<h2>`s) |
| `ReferenceCard` (`SuccessPage.tsx`) | Reference number (selectable, `user-select: all`, never breaks), **Copy reference** button, result announced in a `role="status"` region; if copying fails the reference is selected for a manual copy |
| `ErrorSummary` | `role="alert"` "N answers need attention" + focus to first invalid field |
| `Honeypot` | Off-screen trap field for bots |
| `ErrorBoundary`, `RequireStep`, `RouteEffects` | Crash screen (with a calmer "This page needs a refresh" when a lazily loaded file is missing); step guards; scroll/focus/title per route |
| `ui/` kit (`src/components/ui/index.tsx`): `Input`, `TextArea`, `Select`, `Checkbox`, `Button` (primary/secondary/danger/ghost, busy), `ButtonLink`, `PageHeader`, `Panel`, `Notice` (info/success/warning/error), `Badge`, `Loading`, `LoadError`, `TableScroll`, `Pagination`, `when()` | Building blocks for the account and admin areas: visible labels, hints and errors wired with `aria-describedby`/`aria-invalid`, 44 px minimum targets, `role="alert"` only for errors. `PageHeader` renders the screen's single `<h1 data-page-heading>` and sets the title. `when()` always names the time zone ("26 Sept 2026, 12:48 WAT"). Built on the primitives below (`Panel` is a `Card`, `Badge` the `Badge` primitive); the parts public pages also use (`Button`, `Checkbox`, `Notice`, `Loading`, `LoadError`, `when`) live in `ui/basic.tsx` as plain elements with the same classes (`ui/styles.ts`), so public bundles never load the primitives' libraries |
| shadcn/ui primitives (`src/components/ui/*.tsx`, `components.json`): `Button`, `Card` (+ `CardHeader`, `CardTitle` with `as`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`), `Badge`, `Alert`, `Input`, `Select`, `Popover`, `Calendar`, `Tabs`, `Sheet`, `Skeleton`, `Table`, `Breadcrumb`, `Chart` | Copied from shadcn/ui (new-york style) and adapted: brand tokens instead of theme variables, no global base styles, the site's focus outline (fields keep the burgundy focus ring), 44 px buttons, pill shapes. Radix supplies the behaviour (Select listbox and type-ahead, Popover and Sheet focus handling and Escape, Tabs arrow keys). Added components must be adapted the same way ([AGENTS.md](../AGENTS.md)) |
| `AppStatus.tsx`: `ConnectionStatus`, `UpdatePrompt`, `ServiceWorkerMessages`, `PushReconciler` | The in-flow offline notice (never covers anything); the update offer (bottom, dismissible, never reloads by itself; warns about unsaved admin edits); in-place navigation for notification clicks |
| `InstallGuide.tsx`: `GUIDES`, `GuideSteps`, `InAppBrowserNotice` | Numbered install steps per browser (menu symbols read out by name, e.g. "three dots"), and the in-app browser advice with **Copy link** (manual-copy fallback) |
| `notifications/`: `NotificationCard`, `NotificationSettings`, `usePushDevice` | The "Get programme updates" card (brief's exact wording) and the full settings panel with every state and the topic checkboxes |

Consent uses a native checkbox styled as the original custom box; it is never pre-ticked. The review screen uses a `<dl>` summary with per-section **Edit** links.

**Guidance next to questions:** email ("The Programme team will use this to contact you about your application."), phone (country code), age range ("The programme is for ages 18–30."), parish (required; with the directory: "Type your parish's name and choose it from the list. Many parishes share a name, so you can add your province number, for example “Jesus House 12”."; without it: "Type your parish's name as you know it. The Programme team will match it to the RCCG parish list.") and the purpose scale.

## 6. Motion

**Feel:** elegant, confident and youthful, the quality bar of a flagship product launch without copying one. Choreography carries the hierarchy: overlapping entrances with precise timing, a quick start with a long soft landing, subtle depth in the existing photography, immediate interaction feedback, and generous stillness in between. The most expressive moments are the **hero**, the **Biblical Blueprint** deck and the **Participant Journey**; supporting sections are quieter, and no single fade-up is applied to everything.

**Implementation:** CSS keyframes/transitions plus one hook ([`src/lib/motion.ts`](../src/lib/motion.ts): `useScrollReveal`, `animateDisclosure`) for every screen, except the **homepage hero**, which is one GSAP timeline (`gsap` core, [`src/lib/heroMotion.ts`](../src/lib/heroMotion.ts); see *Homepage hero* below). Only `opacity`, the individual `translate`/`scale` properties (which compose with existing transforms such as the rotated Blueprint cards) and, for journey route lines and the hero's masks and dots, `clip-path` animate, plus the FAQ panel's height (the interaction itself). **One owner per element:** an element is animated by GSAP or by CSS, never both (the hero's CSS extras run on inner elements). No `transition-all`, permanent `will-change`, blur, filters, scroll hijacking, pinning, cursor effects, bouncing or typewriter text. The only loops are the submit spinner while busy and the hero glow's breathing; the only scroll-linked motion is the hero participants' drift on desktop.

**Settled UI is unchanged by motion:** every one-shot entrance ends on the element's own resting style. Verified with deterministic headless captures (8 screens × 7 widths): after the motion upgrade all 56 settled captures were **pixel-identical** to the pre-upgrade baseline (the only later changes are the intentional hero redesign; everything below it and every application screen still matches). The GSAP hero goes further: it clears its inline styles as each move lands, so its settled state equals the page *without* motion pixel for pixel (2026-09-29, 5 widths). CSS entrances that hold their last frame (`fill-mode: both`, the photos' depth settle) keep those elements on their own compositor layers, so photo edges and some text render a few levels differently from the reduced-motion page (About, Apply, Install, Journey, Programme; the old hero too: up to 214/255 on the photo's edge pixels at 1280 px). Invisible, but worth fixing if those sections are reworked.

### Tokens (`src/index.css` `:root`; stagger mirrored in `MOTION` in `src/lib/motion.ts`)

| Token | Desktop | < 768 px | Use |
|---|---|---|---|
| `--ease-enter` | `cubic-bezier(0.22, 1, 0.36, 1)` | | Entrances |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | | Interface (hover, press, state); Tailwind's default |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | | Things leaving (menu) |
| `--duration-feedback` | 160 ms | | Hover / press |
| `--duration-form` | 220 ms | | Step content, selection states |
| `MOTION.disclosureMs` | 260 ms (close 220) | | FAQ answers |
| `--duration-support` | 520 ms | 420 ms | Supporting entrances |
| `--duration-feature` | 720 ms | 600 ms | Hero, Blueprint, Journey, photography depth |
| `--duration-drawer-in` / `-out` | 300 / 220 ms | | Mobile menu |
| `--shift-support` / `--shift-feature` | 16 / 24 px | 8 / 12 px | Travel |
| `--shift-form` | 8 px | | Step content |
| `--depth-scale` | 1.025 | | Photographs settle from this scale inside their frames |
| Stagger | 50–60 ms steps, capped at 240 ms per visible group | | |

Reveal opacity resolves in about two-thirds of the travel time, so content is legible early and overlapping cards are never see-through for long.

### Choreography

| Section | Desktop (≥ 1280 px) | Phones / tablets |
|---|---|---|
| **Hero** (load; GSAP, see below) | ≈ 2.3 s: the gold glow blooms on an all-burgundy stage, the participants rise and land, the white panel and split sweep arrive from the right as one piece, the ring locks on, the headline lines rise out of masks, then sentence, eligibility (the tick draws itself), buttons, header, caption and dots. Afterwards the glow breathes; scrolling away, the participants drift and recede | ≈ 2 s of copy on load (header, eyebrow, headline lines, sentence, eligibility, buttons); the photograph's glow, rise and ring lock-on when it comes into view (0.25 s after the headline if it's already there); then the glow breathes. No drift |
| **What to expect** | One group (`data-reveal-group="(min-width: 1280px)"`): heading + description together, cards 140/200/260/320 ms, note 420 ms | Each card reveals as it approaches |
| **Vision & Mission** | Group: heading → portrait (frame fades, photo settles 1.025 → 1 inside it) → Vision column → Mission column, each column as one unit; rules extend after | Heading, blocks and portrait reveal as they arrive (portrait: in-frame depth) |
| **Doctrine** | Group, calmer (12 px travel): photograph settles as a whole → heading → questions in reading order (60 ms) → CTA | Photo in-frame depth; header, questions (stagger if they arrive together), CTA |
| **Biblical Blueprint** | Deck group: the five cards deal into their collage positions in visual order (Daniel → Nehemiah → Deborah → Paul → Joseph, 50 ms apart), each starting a little toward the centre and lower; 600 ms each, sequence ≈ 800 ms. Motion runs on the inner card; rotation, overlap, crop, shadow and stacking stay on the untouched wrapper | Clean individual reveal per card, vertical only |
| **Participant Journey** | Each stage rises (feature tempo) as it enters, its photo settling in frame; its route lines draw 160 ms later in the direction of travel (02–03 → right, 04 → down, 05–06 → left) and endpoint dots fade in at 640 ms. The lines are `<img>` artwork, so a `clip-path` wipe (keyframes with `backwards` fill, ending unclipped) rather than stroke drawing | Compact timeline; each stage reveals as it enters, short vertical travel |
| **FAQ** | Height + opacity animation on the answer panel (open 260 ms, close 220 ms), starting from wherever it is, so rapid toggles reverse instead of snapping; the + turns to × immediately. Native `<details>` semantics, keyboard and find-in-page kept | Same |
| **Closing invitation** | Group: the quotation as one unit → citation 220 ms → CTA 360 ms | Same |
| **Footer** | A single quiet fade | Same |

### Homepage hero (GSAP, 2026-09-29)

The hero read as if nothing moved (≈ 1 s, 16–24 px moves, the photograph visible from the first frame), so it became a deliberate, cinematic opening drawn from the mark's meaning: the glow is the bullseye (fulfilment), the ring the target locking on, the leap the journey. One timeline per layout in [`src/lib/heroMotion.ts`](../src/lib/heroMotion.ts); every start time and duration is in its `HERO_DESKTOP`, `HERO_PHONE_COPY` and `HERO_PHONE_PHOTO` tables (tested in `heroMotion.test.ts`), with long soft landings (`expo.out`, `power4.out`, `power3.out`; the panel `power3.inOut`).

| s | Desktop (≥ 1280 px) | Phones and tablets |
|---|---|---|
| 0 | Glow blooms from 60 %; participants fade in; white panel + split sweep start arriving from the right as one piece (1.1 s, so their seam never opens) | Header row settles down |
| 0.15–0.3 | Participants rise ≈ 100 px from 1.06× and land (1.3 s); the ring locks on from 1.25× with −8° (1.4 s) | Eyebrow; headline line 1 rises out of its mask (0.2), line 2 at +0.12 |
| 0.35–0.57 | Eyebrow; headline line 1 out of its mask, line 2 at +0.12 | Sentence (0.6), eligibility (0.72), tick draws (0.85), buttons (0.8, +0.1) |
| 0.7–1.4 | Header row; sentence (0.9); eligibility + tick (1.0/1.15); buttons (1.1, +0.1); caption rule and caption (1.2/1.3); dots wipe in left to right (1.4) | Photograph, when in view: glow blooms, participants rise ≈ 70 px, ring locks on from 1.2×, caption (0.7) |
| end | ≈ 2.3 s | ≈ 2 s (copy), ≈ 1.6 s (photograph) |

- **After the entrance:** the glow breathes (CSS `hero-breathe`: 1 → 1.045 scale, 1 → 0.82 opacity, 4 s each way), paused off-screen or in a hidden tab. On desktop, once the page leaves the top, the participants' image drifts 90 px and recedes to 94 % (from its top) over the first 900 px of scroll: a CSS scroll-driven animation, so no JavaScript and nothing in browsers without it (Firefox today). Drift alone would cut their feet off at the hero's edge (they sit 63 px above it); with the recede the feet stay ≥ 23 px inside. The drift is attached only after the page has scrolled (`:has(header[data-scrolled])`), because any attached scroll animation keeps the image on its own compositor layer.
- **Rules it keeps:** the photograph and artwork files are unchanged, only transform/opacity/clip-path move; inline styles are cleared as each move lands; buttons stay clickable; keyboard focus anywhere finishes the entrance; reduced motion shows the hero at once with no loop or drift; it never replays when the viewport crosses 1280 px. The photograph is decoded before it appears (a browser decodes a hidden image only on first paint, which froze the phone entrance for ≈ 360 ms), waiting at most 400 ms; on phones it starts 0.25 s after the copy because it's usually the largest element.

### Engine (`useScrollReveal`)

- **Items** are observed one by one (threshold 0.12, bottom inset 8%); items arriving together are staggered in reading order, and rules ride just behind the content they follow.
- **Groups** (`data-reveal-group`, optionally tied to a media query) play an authored timeline (`data-reveal-at`, ms) when their top reaches the upper two-thirds of the viewport, independent of how the observer batches elements. Crossing the group's breakpoint re-arms whatever is still pending.
- **Companions** (`data-reveal-with="id"` + `data-reveal-at`) follow the element with `data-reveal-id="id"`.
- **Never hidden by mistake:** content is only hidden once the hook has armed the page; anything above the viewport (anchor jumps, fast scrolling, returning to a scrolled page) and anything receiving keyboard focus is shown instantly with no transition; once per mount; observers and listeners are cleaned up (StrictMode-safe).
- **Reduced motion** (at load or switched on while the page is open): everything is shown at once with no displacement, delay or smooth scrolling; the FAQ and menu toggle instantly.

### Interaction

| Element | Behaviour |
|---|---|
| Buttons (`.motion-button`, `.motion-arrow`) | Colour change 160 ms; 2 px lift and 3 px arrow nudge only on `(hover: hover) and (pointer: fine)`; press scale 0.985 on every pointer; focus ring instant |
| Desktop nav (`.nav-underline`) | Underline sweeps in from the left on hover and out to the right; appears instantly on keyboard focus; rests under the current page (between the dedicated pages the header stays mounted, so it sweeps across to the new page) |
| Sticky header | Background, hairline, shadow and the homepage nav's colours change over 180 ms (the Apply pill's colours over 160 ms, its two arrows cross-faded) when the page leaves the top; no sliding, bouncing or height change. Reduced motion: instant |
| Dedicated pages | Page intro: the hero's quiet entrance (eyebrow fade, then heading, lead and actions rising at 60 ms steps). Sections below use the same reveals as the homepage (heading groups from 1280 px, card staggers, image depth, eyebrow rules drawing). The header never re-animates; each page re-arms its own reveals. Reduced motion: everything shown at once, as elsewhere |
| Mobile menu | Panel and backdrop are CSS transitions (entry via `@starting-style`): open 300 ms, close 220 ms, and reopening mid-close reverses from where they are. Focus moves to Close on open (`preventScroll`), back to the menu button on close, and to the destination section's heading after an in-page link. Escape, focus trap, scroll lock and `aria-expanded` unchanged. The panel scrolls on its own when taller than the screen (short phones, landscape), and the menu closes itself if the viewport widens past 1280 px while it is open, so no hidden drawer keeps the scroll lock. |
| Admin popovers, list boxes and sheets | Popover and Select lists open with a 160 ms fade and 0.97 → 1 scale from their trigger; the filter sheet slides up (300 ms) over a fading backdrop. Matched by the primitives' `data-slot` attributes, only without reduced motion; they close at once. Charts don't animate; skeletons pulse only without reduced motion |
| Application screens | One 220 ms entrance for new step content (no delay, no per-field stagger); header and progress stay mounted; selection feedback 220 ms; errors and focus rings instant, no shake; navigation never waits for an exit. Success: check settles once (0.8 → 1), then a short next-step sequence (≈ 1 s total) |

### Verification (2026-09-26)

- Settled UI: 56/56 pixel-identical captures after the motion upgrade (headless Chromium, animations switched off only after completing, lazy images loaded); capture repeatability confirmed 56/56.
- Motion reviewed as seeked filmstrips (hero desktop/phone, What to expect, Vision, Doctrine, Blueprint, Journey, closing). Two issues found this way and fixed: a pink seam while the hero's split artwork faded (now still), and a sliver of route line visible before the Journey wipes (start clip now covers the stroke margin).
- Interactions: FAQ open/close heights sampled (smooth, reversible, no leftover styles; Enter/Space; reduced motion native), menu (timings, interrupt reversal, focus, lock), direct `/#journey`, fast scroll (nothing left hidden), resize across 390 ↔ 1100 ↔ 1440, returning to the page (one fresh opening), reduced motion at load and switched live, keyboard (no focus on hidden content), layout shift 0, no console errors.
- Frame pacing, production build, headless Chromium (120 Hz): phone 390 px with 4× CPU throttling: scroll through the whole page with reveals median 8.3 ms / p95 9.2 ms / worst 9 ms, 0 frames over 20 ms; FAQ and menu worst 9–16 ms. The opening has one 83 ms frame caused by the app's initial render (3 long tasks, 363 ms at 4× throttling), not by animation. Desktop 1440 px: scroll worst 17 ms.

### Verification: homepage hero (2026-09-29)

Production build, headless Chrome (60 Hz), tools as for the baseline recorded that morning:
- **Settled state:** with motion (the breathing stopped for the shot) the hero equals the reduced-motion page pixel for pixel at 390, 768, 1280, 1440 and 1920 px, and equals the previous build's resting design (peak difference 0). Against the previous build's *animated* hero it differs only by that build's own compositor-layer artefact (the same 7,516 edge pixels at 1280 px, 29 at 1440 and 1920). Every other page matched the previous build at all five widths, with and without motion.
- **Entrance:** no dropped frames (155 of 155 on time) at 390 px with 4× CPU throttling and at 1440 px. Screen changing for ≈ 2.1 s (was 0.74 s on phones, 0.99 s on desktop).
- **LCP:** 676 ms cold at 390 px, 4× CPU (before: 596–744 ms; budget 1 s); 64 ms at 1440 px (budget 0.6 s). CLS 0.
- **Scrolling (warm):** homepage 0 dropped frames at 390 px 4× CPU and at 1440 px; other pages as before (desktop `/journey` 7 vs 6). Menu and FAQ interactions 16–32 ms at 4× CPU (before 16–48).
- **Cost:** first-load JS 135.1 → 163.9 KB gzipped (+28.8 KB, GSAP core); the homepage's largest start-up task at 4× CPU ≈ 155 → 220 ms.
- **Extras:** breathing starts after the entrance, pauses off-screen and resumes; drift keeps the feet ≥ 23 px inside the frame at every scroll position; neither runs with reduced motion; no inline styles left on any hero element.

**Limits:** headless timing excludes a real phone's GPU raster costs, so it approximates rather than replaces a check on a mid-range Android device (the hero's entrance and breathing included). Route lines fade/wipe rather than stroke-draw (they're `<img>` artwork). If keyboard focus leaves a hero entrance within its first ≈ 300 ms, that entrance resumes.

## 7. Imagery

- 21 photos/illustrations converted to **WebP** (max 1200 px): total image weight 11.6 MB → **1.3 MB**. Files have meaningful names (`src/assets/landing/journey-04-boot-camp.webp`) and are content-hashed at build.
- Content images have **descriptive alt text** (e.g. "Painting of Nehemiah directing the rebuilding of Jerusalem's walls"). Decorative glows, rings, route lines and arrows use `alt=""`/`aria-hidden`.
- Below-the-fold images use `loading="lazy"`; the hero image has `fetchpriority="high"`.
- **Supporting photographs are AI-generated** (the owner's decision, 2026-09-29; policy, prompts and records: [IMAGERY.md](IMAGERY.md)): fictional Nigerian young adults in modest professional clothing (the women in skirts or dresses, not trousers: D-57), editorial daylight, a warm neutral grade with burgundy, cream, navy and charcoal as accents rather than a skin grade. They replaced the prototype's stock-style images, which showed invented event banners, name tags, a fake certificate and a laptop logo. Each photo has one placement only (no photo repeats across sections or pages), and each slot sets an `object-position` focus so faces survive its crops at every breakpoint. The footer ("About our images") and the success page say which photographs are AI-generated; alt text describes the scene only. The homepage hero, the brand artwork and the Biblical Blueprint paintings (artistic interpretations) are unchanged.
- Social card: `public/og-image.jpg` (1200×630): the settled desktop hero with its header (the lockup), captured from the production build at 1440 px (2× pixel density, rows 16–772) on 2026-09-28. It replaced the Figma crop, which still carried the prototype's headline.
- **Favicons and app icons**, resized from the brand mark by `scripts/brand-assets.py` (§2):
  - `favicon.ico` (16/32/48) and `favicon-32.png`: the mark on its own.
  - `apple-touch-icon.png` (180 px, opaque): the mark at 80% on brand burgundy.
  - `icons/icon-192.png`, `icon-512.png` (manifest `any`): the mark with transparent corners, also used for notifications.
  - `icons/icon-maskable-192.png`, `-512.png`: the mark at 76% on burgundy, so it stays inside the central 80% safe zone whatever shape Android crops to.
  - `icons/badge-96.png`: a white silhouette of the mark's ink (ring, path, sunburst) for Android's status bar, which only uses the alpha channel.
  - Splash/background colour: brand cream `#f3f0e6`. Theme colour: brand burgundy `#841d26`.

## 8. Accessibility

Target **WCAG 2.2 AA**. Status after the 2026-09-26 rebuild:

| # | Issue in the prototype | Status |
|---|---|---|
| A1 | No headings | ✅ One `<h1>` per screen (`data-page-heading`), `<h2>`/`<h3>` per section/card |
| A2 | No landmarks | ✅ `<header>`, `<main id="main">`, `<nav aria-label>`, `<footer>`, `<aside>` + skip link |
| A3 | Inputs without labels | ✅ `<label for>`; required state announced |
| A4 | No `<form>` | ✅ Each step is a `<form noValidate>`; Enter submits |
| A5 | Fake checkbox/radios | ✅ Native inputs with custom visuals |
| A6 | Errors not announced | ✅ `aria-invalid`, `aria-describedby`, `role="alert"` summary, focus to first invalid field |
| A7 | No focus styles | ✅ Global `:focus-visible` outline (white on burgundy surfaces via `.on-dark`) |
| A8 | Nav items were plain text | ✅ Real links to real pages (`/about`, `/programme`, `/journey`, `/faq`), `aria-current="page"` on the current one |
| A9 | Inaccessible mobile drawer | ✅ `role="dialog"` + `aria-modal`, labelled buttons, `aria-expanded`, Escape, focus trap, focus return, scroll lock |
| A10 | 7–9 px text | ✅ Raised (see §3) |
| A11 | Contrast failures | ✅ Fixed (see §2) |
| A12 | No reduced motion | ✅ CSS and JS (see §6) |
| A13 | Empty alt on content images | ✅ |
| A14 | `lang` | ✅ `<html lang="en">` |

**Motion pass (2026-09-26):** after an in-page link in the mobile menu, focus moves to the destination section's heading (the link itself disappears with the menu). **UX pass (2026-09-26):** the FAQ uses native `<details>`/`<summary>` (Enter/Space, expanded/collapsed state from the browser; rows ≥ 60 px tall; 3 px focus ring). The mobile progress row marks the current step with `aria-current="step"` and gives each step a hidden state ("completed", "current step", "not started"); Review is described as "All 3 sections complete / Review and submit", not as a fourth section. The Success page announces "Reference copied." (or the manual-copy fallback) in a `role="status"` region; focus stays on the button.

**Sticky header (2026-09-26):** the skip link stays above it (and skips it: the header now sits before `<main>` on every marketing page, the homepage included); keyboard focus is never hidden under it (checked by tabbing through every page both ways at 320–1440 px) and entering the header by keyboard never scrolls the page; the menu keeps Escape, the focus trap, focus return (without scrolling: the button is always on screen) and the scroll lock, opens correctly half-way down a page, and every item stays reachable on 375–480 px tall screens. Checked in Chromium; see [06 Phase 11](06-Implementation-Plan.md#phase-11-sticky-navigation-done-2026-09-26).

**Marketing pages (2026-09-26):** every page has one `<h1>` (the page intro's, focused on navigation), headings that never skip a level (the Journey stages are `<h2>`s under the intro, each named "Stage 02: Virtual Training" for assistive technology), a unique title ("About · School of Purpose", "Programme ·…", "Journey ·…", "FAQ ·…"), the skip link and one `<main id="main">`. The current page is `aria-current="page"` in the header nav, the menu and the footer. The menu dialog keeps Escape, the focus trap, focus return and the scroll lock on every page, and closes when the page changes (link or Back). Links name their destination ("About the School of Purpose", "See the full journey, stage by stage", "Read the FAQ"); "read more" links are ≥ 44 px tall and FAQ rows ≥ 60 px. The homepage hero's photograph and ring were intercepting clicks on the desktop nav (a bug since the Figma export); they are now `pointer-events: none`.

**Parish question (2026-09-30):** checked in Chromium with made-up parishes: the label names the combobox; arrow keys move the active option (`aria-activedescendant`), Enter chooses (and never submits the form while the list is open), Escape closes, then clears; the result count, the choice and the confirmation are announced; focus moves to **Yes, this is my parish** after a choice, to the card after confirming and back to the search after **Change parish**; a missing confirmation focuses that button (`data-focus-invalid`, described by the error), the card border turns burgundy and the summary counts it; the phone layout (375 px) keeps everything in the page flow. *Not yet done:* a screen-reader pass on real devices, and axe-core on this screen.

**App, account and admin screens (2026-09-26):** one `<h1>` per screen via `PageHeader` (focused on navigation), visible labels on every control (checkboxes and radios included), hint/error wiring, `role="status"`/`role="alert"` used deliberately (live regions are rendered empty first so changes are announced), wide tables inside a labelled, focusable scroll region with `<th scope>`, symbols in instructions read out by name (visually hidden text, not `aria-label` on a plain span), destructive actions confirmed by typing a value, and the update prompt never takes focus. A structural audit in the browser (one visible `<h1>`, `<main>`, every control labelled, every button/link named, no duplicate ids, `aria-describedby` targets exist, `<th scope>`, `alt` present) passed on all **20** new screens: `/install`, `/notifications`, `/updates`, the four account pages and 13 admin screens. **axe-core has not yet been run on these new screens**, and neither has a screen-reader pass.

**Verification:** axe-core 4.10 (WCAG 2.0/2.1/2.2 A + AA rules) reports **0 violations** on all 8 application screens and all 5 marketing pages at 390 px and 1280 px (2026-09-26, with every section revealed and an FAQ answer open). Its remaining "needs review" items are text over photos or overlapping route artwork, `aria-hidden` arrow glyphs, and the Journey intro (axe doesn't model the cascade's `overflow: clip` frame; nothing overlaps it, rose on burgundy is 8.4:1); checked by hand. Automated browser checks (2026-09-26) cover navigation from every nav item, Back/Forward/refresh, focus on route change, the old `/#about`… links, the menu (trap, Escape, focus return, scroll lock, same-page and cross-page links, Back while open), FAQ by keyboard, the skip link and reduced motion. Keyboard flows (consent, radios, menu dialog) were checked by hand. *Not yet done:* a screen-reader pass on real devices (VoiceOver on iOS, TalkBack on Android).

## 9. Design inconsistencies from the prototype

| # | Inconsistency | Resolution |
|---|---|---|
| D1 | Monogram "SOC" on landing vs "SOP" elsewhere | ✅ Superseded (2026-09-28): the official lockup replaced the text monogram everywhere. "SOP" remains the short name (manifest, home-screen title, application references) |
| D2 | Three spellings of the organisation name | Headers now show the lockup's "RCCG NYAYA". Text still uses the full "RCCG National Young Adults & Youth" (About eyebrow, footer copyright) and the short "RCCG Young Adults & Youth" (page title). **Brand owner to confirm** the preferred written form |
| D3 | Step 3 panel reused Step 1 copy | ✅ Own title/subtitle ("Purpose & Self-Discovery") |
| D4 | Step 2 panel label weights inverted | ✅ Shared component; active = bold |
| D5 | "5 minutes" vs "12 minutes" | ✅ "About 5 minutes" everywhere (`site.minutesToComplete`) |
| D6 | Doctrine II "burdens, gifts" vs "burden, gift" | ✅ "burden, gift, grace and enduring desire" on both layouts |
| D7 | Daniel card: different descriptions per breakpoint | ✅ Same description ("Conviction within secular systems."); mobile keeps its own illustration (art direction) |
| D8 | Parish hint referenced a missing "Yes" question | ✅ Hint now: "If you attend an RCCG parish, tell us which one." |
| D9 | "Review & Submit" with no review step | ✅ Real Review screen; Step 3 button says "Review Answers" |
| D10 | Mobile success cards used text glyphs | ✅ Same SVG icons as desktop |
| — | Desktop nav had "Experience" and "Speakers" (no such content) | ✅ Nav unified to Home · About · Programme · Journey · FAQ (+ Contact when configured), each a page of its own |

## 10. App, account and admin surfaces (2026-09-26)

**Installed app.** The standalone app looks exactly like the site (no separate design): same pages, header and footer. The status bar takes the theme colour where the platform supports it. "Install the app" appears as a plain link in the footer and the phone/tablet menu, never as a banner over content, and disappears inside the installed app.

**Status and prompts.**
- *Offline:* a slim ink-coloured bar at the very top of the page, in the page flow (content moves down; nothing is covered).
- *Update available:* a dark card at the bottom centre with **Later** and **Update now**/**Reload**, padded for the home indicator (`env(safe-area-inset-bottom)`). Its text adapts: on the form "Your answers stay saved on this device while this tab is open"; in the admin area "Save your changes first: anything unsaved on this page will be lost".
- *Get programme updates:* a white card under the reference on the Success page, with the brief's copy, **Enable notifications** (primary) and **Not now** (quiet).

**Account area.** Uses the marketing header and footer, on cream, with a pill tab bar (Overview · Application · Messages & notifications · Settings), "Signed in as …" and **Sign out**. Application statuses use calm badges: *Received* and *Not selected* neutral, *Under review* burgundy-tinted, *Shortlisted* and *Invited* green. A decision is never shown in alarm red. The Programme team's message sits in its own cream box.

**Admin area.** Its own layout: a deep-burgundy (`brand-deep`) sidebar with the cream lockup and an "Admin" label, navigation filtered to the person's role, their name and role, and **Sign out**; on phones the sidebar becomes a top bar with a **Menu** toggle. Content sits on cream in white `Panel`s (cards: 16 px corners, a hairline border and a soft shadow). Conventions:
- Review statuses: *New* amber, *Under review* burgundy, *Shortlisted*/*Invited* green, the rest neutral.
- Numbers use tabular figures; every time shows its zone (WAT by default).
- Lists keep filters, sort and page in the URL. On phones the filters fold behind a **Filters (n on)** toggle.
- Irreversible actions (delete an application or account) need the reference or email typed back and use the danger button. Publishing and bulk sends need an explicit "I've checked…" tick after a preview of exactly what people will see.
- Notification previews render as a phone-style card with the real icon, and say that devices differ.
- Counts use the brief's truthful labels: "Accepted by push service" (explained as not meaning shown or read), "Active subscriptions (devices)", "Observed installs", "Reported clicks" (as devices reported them: a lower bound, and unverified).
- **Sign-in methods (2026-10-01, D-58):**
  - Sign-in page: the password form, then under a hairline "Added a passkey to your account? You can sign in with it alone." and **Sign in with a passkey** (secondary), shown only where the browser supports passkeys (feature detection).
  - The second step offers the strongest way the account has, with **Another way:** links underneath (Use your passkey · Use your authenticator app · Email me a code · Use a recovery code). A passkey is one button that opens the device's own prompt; codes are one field (`autocomplete="one-time-code"`, a numeric keyboard for six-digit codes), its error under it (`aria-invalid`, `aria-describedby`). A closed or timed-out passkey prompt is a calm amber notice, not an error.
  - First-time setup: three choice cards (**A passkey (recommended)**, **An authenticator app**, **Codes by email**, which says plainly that it's the weakest), then the recovery codes with an "I've saved my recovery codes" tick before **Continue**.
  - Your security: a **Two-step verification** card saying which ways are on, then **Confirm it's you** (an amber notice and the strongest ways) until it's done, then a green "You can change your sign-in methods until …" for five minutes. Cards for **Passkeys** (one row each: the name, a **Backed up** badge only when the authenticator reported it, when it was added and last used; Rename; Remove with an inline confirmation), **Authenticator app**, **Codes by email** (with the same plain warning) and **Recovery codes** (how many are unused; new ones shown once). The reset page asks for the new password first, then "Confirm it's you" with the passkey, the app or a recovery code, and says why an emailed code can't be used.
- **Reports and analytics (card-first, 2026-09-30):**
  - Page order: `PageHeader`, the report navigation (a segmented bar of links with `aria-current`; two columns on phones), the filter toolbar (Period, Cohort, Review status, Published to applicant, Place: five fields in one row on wide screens, three on tablets, a **Filters** sheet from the bottom on phones), then "Reporting on …" in words with a removable chip per filter and **Clear all**.
  - Period: a popover with quick periods (All time, Last 7/30/90 days, This year) and a range calendar in Lagos days (future days disabled, today marked, Apply). Place: a popover with the unit finder, aligned to its field.
  - Cards: metric cards (label, a rose icon disc, the figure in 32 px tabular type, what it covers; a comparison line and badge only when a start date gives an earlier period, in words when that period had none); report cards (heading, description, content, actions at the bottom so a row's actions line up); section headings above groups. Wide cards span columns where a card is short, so rows don't hold empty space.
  - Visuals: Recharts bar charts for trends, status breakdowns and comparisons (no animation, muted axes, a tooltip; the plot is hidden from assistive technology and every chart has its numbers in text: a caption, a legend with counts or a table); a ranked bar list (the bar behind the name, counts in their own column) and a segmented category bar for compact breakdowns, after Tremor's patterns. Status colours as in the badges: New amber `#a8781a`, Under review brand, Shortlisted `#3f7f45`, Invited `#1e5b22`, Not selected muted, Withdrawn line-strong, with gaps between segments.
  - Tables stay where exact values or dense comparison matter: the regions/provinces/parishes table view (sortable headers with `aria-sort`, totals row, horizontal scroll in a labelled region), "Show the numbers" under the trend, and the status tables on Review and decisions. Cards/Table is a tab pair only on that report.
  - States: skeletons shaped like the content (with a status message) while loading, an error alert with **Try again**, dashed empty states with the way out (**Clear all filters**, **Clear the search**), and a small reload message if a chart, the calendar or the table can't be downloaded.
- **Drill-down from continents to a parish (2026-09-30):**
  - One layout at every level, not a screen per level: the `PageHeader` names the place (the parish, the unit, or "All continents"; "Place not found" with **Show every place** for a bad link), then the "Where you are" breadcrumb with **Back to …** (one level up) beside it on wide screens and under it on phones.
  - Place cards (`reports/PlaceCard.tsx`, also the Overview's continent cards): the directory's name, what it is and where ("Region in Continent 3"), the applications in the period in 28 px tabular type, the review-status bar with its legend, then a divided list of what is under it, each with how many have applications ("Regions 22 · 18 with applications", "Parishes 17,047 · 49 with applications"), and the actions: **View regions / provinces / parishes / applications** (outline, with a chevron) and **Applicants** (ghost; staff who can see applicants). Counts are "applications", never membership or attendance.
  - Groups outside any unit ("No province: directly under …", **Unassigned**) sit under their own heading after the units, so the totals add up in sight.
  - A parish's view: four metric cards, review and published status (the bar without its legend, then every status with its count), and its applications as a list of cards (name linking to the application, reference, cohort, time in WAT, both statuses), paged, with **Open in Applicants** and **Download CSV**; for roles that can't see applicants, a plain note instead of the list.
  - Empty states say which is which: "No organisational units found" (nothing in the directory there), "No applications match these filters" (units listed with none; or all hidden by **With applications only**, with **Show all …**), and no search match.
- **Parish screens (2026-09-30):**
  - Reports and the Parish directory drill down with a "Where you are" breadcrumb (`nav` + `aria-current="page"`). After each step, focus moves to its current item once the new level has loaded, because the link that was followed is gone (`useFocusOnPlaceChange`).
  - A level column appears only when a table mixes levels; otherwise the heading names them ("Regions under Continent 3").
  - Counts some roles can't see read "fewer than 5". Every other count in Reports links to the matching applicants.
  - Choosing a parish or unit (to link, move, merge or add) uses one pattern (`ParishFinder`, `UnitFinder` in `directory-parts.tsx`): a labelled search field and a Search button, then a result list. It announces the result count in a status region, and each button names its item for screen readers ("Link: Jesus House, Lagos Province 3 · Region 54 · Continent 3").
  - Each correction sits in its own disclosure (`<details>`). A merge asks for confirmation first and says what moves with it.
  - Selecting an entry opens a side panel whose heading takes focus. It sits beside the list from 1280 px and below it on smaller screens.
  - Filters that arrive by link (a unit or one parish) show as removable chips.
  - Markers use badges: *Inactive* and *Changed in 2026* amber, *Merged*, *Corrected* and *Added by staff* neutral.

**Sign-in screens** (staff): a single centred card on cream with the colour lockup and an "Admin" pill: password → six-digit code (or "Use a recovery code") → first-time authenticator setup with the QR code, the key in groups of four, and recovery codes shown once with **Copy codes** and an "I've saved my recovery codes" tick before continuing.
