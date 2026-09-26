# 04 — UI/UX Design Brief

**Last updated:** 2026-09-26
**Design source:** Figma Make project "Prototype Design". Compressed render of the desktop landing page: [`design/landing-reference.webp`](../design/landing-reference.webp). The 15 MB original, `design/landing-reference-figma.png`, is kept locally and git-ignored.
**Implementation:** design tokens in [`src/index.css`](../src/index.css) `@theme` (colour, type) and `:root` (motion). The application screens use the shared components in `src/components/`. The homepage hero and the reused editorial sections (Vision & Mission, Doctrine, Blueprint, the Journey cascade) still use the Figma export's arbitrary values; the newer sections and the shared marketing chrome ([`src/components/marketing/`](../src/components/marketing/)) use the tokens. Programme wording shared across screens lives in [`src/config/programme.ts`](../src/config/programme.ts).

Related: [01-PRD](01-PRD.md) · [03-App-Flow](03-App-Flow.md)

---

## 1. Design direction

**Mood:** warm, editorial, reverent but energetic. It should feel like a premium leadership programme, not a generic church flyer.

- **Burgundy + cream + antique gold.** Burgundy carries authority and brand. Cream keeps long reading comfortable. Gold marks progress, numerals and sacred accents.
- **Poster-style condensed headlines** (Anton), a clean sans body (Inter), and a **classical serif** (Cormorant Garamond) for scripture, biblical names and numerals.
- **Pill CTAs with a white circular arrow "knob":** the single primary-action pattern.
- **Numbered structure everywhere** (01, 02 … / I, II, III): a guided, ordered journey.
- **Photography** of young Black professionals and students, plus painted biblical scenes for the doctrine content.

**Voice:** encouraging, scriptural, purposeful; British spelling ("Programme"). Scripture in KJV with citation. Key vocabulary: *purpose, formation, assignment, called, Kingdom impact, Church · marketplace · nation*.

## 2. Colour

### Tokens (implemented in `@theme`, usable as `bg-brand`, `text-muted`, `border-line-strong`, …)

| Token | Hex | Role |
|---|---|---|
| `brand` | `#8b1e3f` | Primary burgundy: CTAs, headers, side panel, headings, focus rings |
| `brand-hover` | `#6b1629` | Primary button hover |
| `brand-deep` | `#4a0e1a` | Done-step tick, deep accents |
| `ink` | `#202124` | Primary text |
| `muted` | `#665d60` | Secondary text, placeholders, hints |
| `gold` | `#b89b5e` | Decorative gold: rules, done-step fill (non-text, 3.35:1 on brand is fine for shapes) |
| `gold-light` | `#dcc28a` | **Gold text on burgundy** (eyebrows, numerals): 5.15:1 |
| `cream` | `#f7f3eb` | Page background |
| `paper` | `#fcfaf6` | Inputs, desktop header |
| `rose` | `#f3dce3` | Tints, badges, subtitles on burgundy |
| `line` | `#d8d0c3` | Card borders, dividers |
| `line-strong` | `#8f8577` | **Form-control borders**: 3.48:1 on paper |

Landing-only colours (arbitrary values from the Figma export): deep burgundies `#3b081a` `#5c1329` `#6b1d2a`, footer `#1a0810`, card darks `#161719` `#202124`, gold variant `#b8962e`. Success-page confetti colours are decorative.

### Contrast fixes made (2026-09-26)

| Pair | Before | After |
|---|---|---|
| Gold eyebrow/numeral text on burgundy ("STEP 1 OF 3", "COVENANT DOCTRINE", journey numbers) | `#b89b5e` 3.35:1 ✗ | `#dcc28a` 5.15:1 ✓ |
| Input and radio borders on paper | `#bfb3a3` 1.98:1 ✗ | `#8f8577` 3.48:1 ✓ |
| Footer copyright and tagline on `#1a0810` | 34–50% cream ✗ | 62–72% cream ✓ |
| Grey glyph icons on white (mobile success cards) | 1.97:1 | Replaced with the SVG icons and marked decorative |

Current result: **axe-core reports no contrast violations** on any screen.

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
| `SiteHeader` | Brand lockup (links home, never wraps) + badge ("Expression of Interest Form", "Application received"…) |
| `ApplicationLayout`, `StepHeader`, `FormCard`, `FormActions`, `SavedNote`, `Divider` (`FormLayout.tsx`) | Step chrome: compact mobile progress row / desktop side panel, the page `<h1>` (section label shown from 1024 px, where the side panel doesn't repeat it), "* Required" note. `FormActions` always ends with the saved-answers note ("Your answers are saved while this tab stays open.") |
| `TextField`, `SelectField` | `<label>`-associated native controls, hint + error wired with `aria-describedby`, `aria-invalid`; focus ring `0 0 0 3px rgba(139,30,63,.22)` |
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
| `ui.tsx` kit: `Input`, `TextArea`, `Select`, `Checkbox`, `Button` (primary/secondary/danger/ghost, busy), `ButtonLink`, `PageHeader`, `Panel`, `Notice` (info/success/warning/error), `Badge`, `Loading`, `LoadError`, `TableScroll`, `Pagination`, `when()` | Building blocks for the account and admin areas: visible labels, hints and errors wired with `aria-describedby`/`aria-invalid`, 44 px minimum targets, `role="alert"` only for errors. `PageHeader` renders the screen's single `<h1 data-page-heading>` and sets the title. `when()` always names the time zone ("26 Sept 2026, 12:48 WAT") |
| `AppStatus.tsx`: `ConnectionStatus`, `UpdatePrompt`, `ServiceWorkerMessages`, `PushReconciler` | The in-flow offline notice (never covers anything); the update offer (bottom, dismissible, never reloads by itself; warns about unsaved admin edits); in-place navigation for notification clicks |
| `InstallGuide.tsx`: `GUIDES`, `GuideSteps`, `InAppBrowserNotice` | Numbered install steps per browser (menu symbols read out by name, e.g. "three dots"), and the in-app browser advice with **Copy link** (manual-copy fallback) |
| `notifications/`: `NotificationCard`, `NotificationSettings`, `usePushDevice` | The "Get programme updates" card (brief's exact wording) and the full settings panel with every state and the topic checkboxes |

Consent uses a native checkbox styled as the original custom box; it is never pre-ticked. The review screen uses a `<dl>` summary with per-section **Edit** links.

**Guidance next to questions:** email ("The Programme team will use this to contact you about your application."), phone (country code), age range ("The programme is for ages 18–30."), parish (optional) and the purpose scale.

## 6. Motion

**Feel:** elegant, confident and youthful, the quality bar of a flagship product launch without copying one. Choreography carries the hierarchy: overlapping entrances with precise timing, a quick start with a long soft landing, subtle depth in the existing photography, immediate interaction feedback, and generous stillness in between. The most expressive moments are the **hero**, the **Biblical Blueprint** deck and the **Participant Journey**; supporting sections are quieter, and no single fade-up is applied to everything.

**Implementation:** CSS keyframes/transitions plus one hook ([`src/lib/motion.ts`](../src/lib/motion.ts): `useScrollReveal`, `animateDisclosure`), no animation library. Only `opacity`, the individual `translate`/`scale` properties (which compose with existing transforms such as the rotated Blueprint cards) and, for journey route lines, `clip-path` animate, plus the FAQ panel's height (the interaction itself). No `transition-all`, permanent `will-change`, blur, filters, loops (except the submit spinner while busy), scroll hijacking, pinning, cursor effects, bouncing or typewriter text.

**Settled UI is unchanged by motion:** every one-shot entrance ends on the element's own resting style. Verified with deterministic headless captures (8 screens × 7 widths): after the motion upgrade all 56 settled captures were **pixel-identical** to the pre-upgrade baseline (the only later changes are the intentional hero redesign; everything below it and every application screen still matches).

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
| **Hero** (load) | brand 0 → eyebrow 40 → headline line 1 60 / line 2 120 → photograph depth settle 140 (visible from first paint: scale 1.02 → 1 + small rise) → glow 160 → sentence 180 → eligibility + CTAs 240 → ring 300 → caption 340 → dots 380; finished ≈ 1 s. The split-sweep artwork is part of the background and stays still | brand 0 → eyebrow 30 → headline (one block) 60 → sentence 120 → eligibility + CTAs 180; finished ≈ 0.6 s. The photograph, glow, ring and caption play when the photograph is actually in view |
| **What to expect** | One group (`data-reveal-group="(min-width: 1280px)"`): heading + description together, cards 140/200/260/320 ms, note 420 ms | Each card reveals as it approaches |
| **Vision & Mission** | Group: heading → portrait (frame fades, photo settles 1.025 → 1 inside it) → Vision column → Mission column, each column as one unit; rules extend after | Heading, blocks and portrait reveal as they arrive (portrait: in-frame depth) |
| **Doctrine** | Group, calmer (12 px travel): photograph settles as a whole → heading → questions in reading order (60 ms) → CTA | Photo in-frame depth; header, questions (stagger if they arrive together), CTA |
| **Biblical Blueprint** | Deck group: the five cards deal into their collage positions in visual order (Daniel → Nehemiah → Deborah → Paul → Joseph, 50 ms apart), each starting a little toward the centre and lower; 600 ms each, sequence ≈ 800 ms. Motion runs on the inner card; rotation, overlap, crop, shadow and stacking stay on the untouched wrapper | Clean individual reveal per card, vertical only |
| **Participant Journey** | Each stage rises (feature tempo) as it enters, its photo settling in frame; its route lines draw 160 ms later in the direction of travel (02–03 → right, 04 → down, 05–06 → left) and endpoint dots fade in at 640 ms. The lines are `<img>` artwork, so a `clip-path` wipe (keyframes with `backwards` fill, ending unclipped) rather than stroke drawing | Compact timeline; each stage reveals as it enters, short vertical travel |
| **FAQ** | Height + opacity animation on the answer panel (open 260 ms, close 220 ms), starting from wherever it is, so rapid toggles reverse instead of snapping; the + turns to × immediately. Native `<details>` semantics, keyboard and find-in-page kept | Same |
| **Closing invitation** | Group: the quotation as one unit → citation 220 ms → CTA 360 ms | Same |
| **Footer** | A single quiet fade | Same |

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
| Application screens | One 220 ms entrance for new step content (no delay, no per-field stagger); header and progress stay mounted; selection feedback 220 ms; errors and focus rings instant, no shake; navigation never waits for an exit. Success: check settles once (0.8 → 1), then a short next-step sequence (≈ 1 s total) |

### Verification (2026-09-26)

- Settled UI: 56/56 pixel-identical captures after the motion upgrade (headless Chromium, animations switched off only after completing, lazy images loaded); capture repeatability confirmed 56/56.
- Motion reviewed as seeked filmstrips (hero desktop/phone, What to expect, Vision, Doctrine, Blueprint, Journey, closing). Two issues found this way and fixed: a pink seam while the hero's split artwork faded (now still), and a sliver of route line visible before the Journey wipes (start clip now covers the stroke margin).
- Interactions: FAQ open/close heights sampled (smooth, reversible, no leftover styles; Enter/Space; reduced motion native), menu (timings, interrupt reversal, focus, lock), direct `/#journey`, fast scroll (nothing left hidden), resize across 390 ↔ 1100 ↔ 1440, returning to the page (one fresh opening), reduced motion at load and switched live, keyboard (no focus on hidden content), layout shift 0, no console errors.
- Frame pacing, production build, headless Chromium (120 Hz): phone 390 px with 4× CPU throttling: scroll through the whole page with reveals median 8.3 ms / p95 9.2 ms / worst 9 ms, 0 frames over 20 ms; FAQ and menu worst 9–16 ms. The opening has one 83 ms frame caused by the app's initial render (3 long tasks, 363 ms at 4× throttling), not by animation. Desktop 1440 px: scroll worst 17 ms.

**Limits:** headless timing excludes a real phone's GPU raster costs, so it approximates rather than replaces a check on a mid-range Android device. Route lines fade/wipe rather than stroke-draw (they're `<img>` artwork). If keyboard focus leaves a hero entrance within its first ≈ 300 ms, that entrance resumes.

## 7. Imagery

- 21 photos/illustrations converted to **WebP** (max 1200 px): total image weight 11.6 MB → **1.3 MB**. Files have meaningful names (`src/assets/landing/journey-04-boot-camp.webp`) and are content-hashed at build.
- Content images have **descriptive alt text** (e.g. "Painting of Nehemiah directing the rebuilding of Jerusalem's walls"). Decorative glows, rings, route lines and arrows use `alt=""`/`aria-hidden`.
- Below-the-fold images use `loading="lazy"`; the hero image has `fetchpriority="high"`.
- **Provenance (audit 2026-09-26):** the supporting photographs came with the Figma Make prototype and are generic stock-style or AI-generated, not RCCG photography. Two show invented event signage: the boot-camp image's "Redemption City Team Building Seminar" banner and the community image's "Unity in Innovation 2024 Summit" banner. Authentic RCCG NYAYA photos were found (RISE skills programme) but have no usage permission and carry a "RISE 30" watermark, so nothing has been replaced yet. Sources, candidates, gaps and the adoption steps are in [IMAGERY.md](IMAGERY.md). The hero photograph and artwork are fixed and must not change.
- Social card: `public/og-image.jpg` (1200×630, cropped from the Figma hero). Favicons: `favicon.svg`, `favicon-32.png`, `apple-touch-icon.png` (burgundy "SOP" mark).
- **App icons** (`public/icons/`, rendered by `scripts/generate-icons.mjs`): the burgundy disc with white Arial Black "SOP" (192/512, like the favicon); a full-bleed **maskable** version with the lettering inside the central safe zone (Android crops it to its own shape); and a 96 px monochrome **badge** (a white disc with the letters cut out) for Android's status bar. Splash/background colour cream `#f7f3eb`, theme colour burgundy `#8b1e3f`.

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

**App, account and admin screens (2026-09-26):** one `<h1>` per screen via `PageHeader` (focused on navigation), visible labels on every control (checkboxes and radios included), hint/error wiring, `role="status"`/`role="alert"` used deliberately (live regions are rendered empty first so changes are announced), wide tables inside a labelled, focusable scroll region with `<th scope>`, symbols in instructions read out by name (visually hidden text, not `aria-label` on a plain span), destructive actions confirmed by typing a value, and the update prompt never takes focus. A structural audit in the browser (one visible `<h1>`, `<main>`, every control labelled, every button/link named, no duplicate ids, `aria-describedby` targets exist, `<th scope>`, `alt` present) passed on all **20** new screens: `/install`, `/notifications`, `/updates`, the four account pages and 13 admin screens. **axe-core has not yet been run on these new screens**, and neither has a screen-reader pass.

**Verification:** axe-core 4.10 (WCAG 2.0/2.1/2.2 A + AA rules) reports **0 violations** on all 8 application screens and all 5 marketing pages at 390 px and 1280 px (2026-09-26, with every section revealed and an FAQ answer open). Its remaining "needs review" items are text over photos or overlapping route artwork, `aria-hidden` arrow glyphs, and the Journey intro (axe doesn't model the cascade's `overflow: clip` frame; nothing overlaps it, rose on burgundy is 8.4:1); checked by hand. Automated browser checks (2026-09-26) cover navigation from every nav item, Back/Forward/refresh, focus on route change, the old `/#about`… links, the menu (trap, Escape, focus return, scroll lock, same-page and cross-page links, Back while open), FAQ by keyboard, the skip link and reduced motion. Keyboard flows (consent, radios, menu dialog) were checked by hand. *Not yet done:* a screen-reader pass on real devices (VoiceOver on iOS, TalkBack on Android).

## 9. Design inconsistencies from the prototype

| # | Inconsistency | Resolution |
|---|---|---|
| D1 | Monogram "SOC" on landing vs "SOP" elsewhere | ✅ "SOP" everywhere (confirm with the brand owner) |
| D2 | Three spellings of the organisation name | Kept as-is: the full "RCCG National Young Adults & Youth" on the landing page and footer, the short "RCCG Young Adults & Youth" on form headers. The hero's "Young Adult and Youth" is the design's headline wording. **Brand owner to confirm** |
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

**Admin area.** Its own layout: a deep-burgundy (`brand-deep`) sidebar with the SOP lockup, navigation filtered to the person's role, their name and role, and **Sign out**; on phones the sidebar becomes a top bar with a **Menu** toggle. Content sits on cream in white `Panel`s. Conventions:
- Review statuses: *New* amber, *Under review* burgundy, *Shortlisted*/*Invited* green, the rest neutral.
- Numbers use tabular figures; every time shows its zone (WAT by default).
- Lists keep filters, sort and page in the URL. On phones the filters fold behind a **Filters (n on)** toggle.
- Irreversible actions (delete an application or account) need the reference or email typed back and use the danger button. Publishing and bulk sends need an explicit "I've checked…" tick after a preview of exactly what people will see.
- Notification previews render as a phone-style card with the real icon, and say that devices differ.
- Counts use the brief's truthful labels: "Accepted by push service" (explained as not meaning shown or read), "Active subscriptions (devices)", "Observed installs", "Recorded clicks (a lower bound)".

**Sign-in screens** (staff): a single centred card on cream with the SOP lockup: password → six-digit code (or "Use a recovery code") → first-time authenticator setup with the QR code, the key in groups of four, and recovery codes shown once with **Copy codes** and an "I've saved my recovery codes" tick before continuing.
