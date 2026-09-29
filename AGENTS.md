# Agent notes: School of Purpose

Expression-of-interest site: React SPA (Vite, installable PWA with a service worker) + Fastify API + PostgreSQL + a background worker (Postgres job queue). Optional applicant accounts, Web Push notifications, and an admin platform at `/admin`. It started as a Figma Make export and is now a standalone project. The Figma tooling has been removed. It runs on one VPS, or with the website on Vercel and `/api` forwarded to the VPS (`docs/DEPLOYMENT.md` §C).

## Before you change things

- Read the docs in `docs/` (01-PRD … 06-Implementation-Plan, DEPLOYMENT). **Keep them current** when you change features, routes, the schema or the stack, especially `05-Backend-Schema.md` and `06-Implementation-Plan.md`.
- `pnpm check` must pass (typecheck + tests + build).

## Commands

- `pnpm dev`: Vite on :5173 + API on :3000 (embedded PGlite database in `.data/pglite`, no setup; test email outbox at `/api/dev/outbox`). No service worker in dev: test PWA behaviour with `pnpm build` + the built server on `localhost`
- `pnpm test`: Vitest. API tests use `createTestContext()` in `server/test-helpers.ts` (in-memory PGlite, the email outbox and a **fake push transport**: tests never reach a real push service or email provider)
- `pnpm typecheck`: app + server, then the service worker (`tsconfig.sw.json`, WebWorker types)
- `pnpm build` / `pnpm start` / `pnpm worker`: production build, server, separate worker
- `pnpm admin create-owner|reset-mfa|reset-password|list`, `pnpm push:keys`. PGlite is single-process: stop `pnpm dev` before running these against `.data/pglite`

## Conventions

- **Form options and validation live in `src/shared/`** and are imported by both the browser and the server. Enum values there must match the Postgres enums in `server/migrations/`. Change both together, via a **new** migration file (never edit an applied one).
- Server code must not import React/DOM; `src/shared/` must not import Node or DOM APIs.
- Styling: Tailwind v4 utilities; design tokens (`bg-brand`, `text-muted`, `font-display`, …) are defined in `src/index.css` `@theme`. The homepage hero and the reused editorial sections still use the Figma export's arbitrary values.
- Marketing pages (`/`, `/about`, `/programme`, `/journey`, `/faq`): mobile/tablet layout below `xl` (1280px); from 1280px a 1440px frame scaled with CSS `zoom` (`.landing-desktop` for the fixed compositions, `.landing-scale` for fluid sections; `useLandingZoom` sets it). Form pages switch to the side-panel layout at `lg` (1024px).
- Navigation lives in `src/components/marketing/nav.ts`; the header, desktop nav, menu, footer, page intro and apply band in `src/components/marketing/`. The four dedicated pages render inside `MarketingLayout` (a layout route in `src/App.tsx`); the homepage builds its hero header from the same parts. Use `NavLink` for nav items (it sets `aria-current="page"`). The homepage previews keep the ids `about`, `programme`, `journey`, `faq`, so old `/#…` links still work: don't rename them.
- Decorative layers drawn over interactive content (the hero photograph and ring) need `pointer-events-none`.
- The marketing header is sticky (`StickyHeader`). Don't give its ancestors `overflow`, `transform` or `contain` (that breaks `position: sticky`), keep content below `z-40`, and don't add `scroll-padding-top` (focus inside the header then scrolls the page). Offsets come from `--sticky-header-height` via `scroll-margin-top` in `index.css`; change it with the header's height.
- Accessibility: use native inputs (styled), `<label>`/`<fieldset>`, `aria-invalid` + `aria-describedby` for errors, one `<h1 data-page-heading tabIndex={-1}>` per screen (focused on navigation).
- Programme facts shown in more than one place (hero, What to expect, previews, the About/Programme/Journey/FAQ pages, welcome checklist) live in `src/config/programme.ts` (`src/config/programme.test.ts` checks the nav order, FAQ groups/previews and the journey stages). Only confirmed copy: no invented dates, fees, criteria, response times or contact details.
- New marketing sections should be **one responsive tree** (`.landing-gutter` below 1280px, `.landing-scale` + 1440px-frame values from 1280px), not another mobile/desktop pair or fixed composition.
- Motion (docs/04 §6): use the tokens in `src/index.css` `:root`, the `.enter-*` / `.form-enter` classes with `enterStep()`/`enterAfter()`, and `data-reveal` for scroll reveals (`data-reveal-group` + `data-reveal-at` for a section's timeline, `data-reveal-with` for companions, `data-depth` for a photo settling inside its frame). Every entrance must end on the element's own resting style: motion never changes the settled UI. Animate only `opacity`, `translate`, `scale`; put anything that hides or moves content inside `@media (prefers-reduced-motion: no-preference)`; never delay forms, consent or errors. Containers that clip decoration but hold focusable content use `.clip-overflow`, not `overflow-hidden`.
- The homepage hero is the exception to the CSS system: a GSAP timeline in `src/lib/heroMotion.ts` (timings in its `HERO_*` tables, tested). Its moves clear their inline styles as they land, so the settled hero equals the page without motion. An element is animated by GSAP **or** CSS, never both: the hero's CSS extras (glow breathing, desktop scroll drift) run on inner elements. Those two are the only sanctioned loop and scroll-linked motion; a new one needs the same care (pause off-screen, none with reduced motion, attach scroll animations only while scrolled).
- Brand: the logo is the supplied artwork in `design/brand/` (palette, rationale and usage rules in its README). Show it with `BrandLockup` (`on="dark"`: cream lettering, `on="light"`: burgundy) and never redraw, recolour or re-type it. `python3 scripts/brand-assets.py` (Pillow) rebuilds the committed lockups, favicons and app icons from the masters. The `brand`, `cream` and `gold` tokens are the brand palette: use them or their `rgba()` tints, not new near-miss hex values.
- Photography: never change the homepage hero images. A supporting photo may only be replaced by an authentic, permission-cleared RCCG NYAYA photo recorded in `docs/IMAGERY.md` (source, credit, context, permission, placement); never crop out watermarks or imply a photo shows the Purpose Boot Camp unless it does.
- Never log request bodies (they contain personal data), push subscriptions (endpoints, keys) or notification content. `server/push.test.ts` checks the logs.

### Accounts, admin, notifications, PWA

- **Permissions** live in `src/shared/permissions.ts`. Every admin route uses `staffGuard(services, { permission })` (session → active → Origin/CSRF → MFA → permission); the UI's `useCan()` only hides controls. Add a row to the permission matrix test in `server/admin.test.ts` for new areas. Audit sensitive actions with `audit()` (identifiers and field names only).
- **Applicant-facing data:** only `published_status`/`published_message`. Never send notes, the internal `status` or reviewer details to `/api/account/*`.
- State-changing requests from the browser go through `apiRequest(path, { method, csrf: 'staff' | 'applicant', json })` in `src/lib/api.ts`.
- The account (`src/account/`) and admin (`src/admin/`) areas are lazy chunks: don't import them from public pages. They use the kit in `src/components/ui.tsx` (`PageHeader` gives the `<h1>`; `when()` always names the time zone).
- **Service worker:** the caching policy is `src/sw/routing.ts`; change it only with `src/sw/routing.test.ts`. Never cache `/api`, `/admin*`, `/account*` or non-GET requests. Updates must never reload a page by themselves, and the first install taking control of a page (`controllerchange` on a page that loaded uncontrolled) is not an update: never offer one for it (`src/lib/pwa.ts`).
- **Notifications:** links must be in `NOTIFICATION_LINK_PATHS` (`src/shared/platform.ts`). Application updates use the fixed neutral text. Every push shows a notification (no silent pushes). In the browser, call `pushManager.subscribe()` first in the click handler (Safari's user-gesture rule): get the service worker registration beforehand.
- **Jobs:** handlers must be idempotent (delivery is at-least-once). Use dedupe keys and unique constraints, and re-check eligibility right before acting.
- **SQL:** a `$n` parameter used in two places needs an explicit cast in both (`$2::delivery_status`); Postgres deduces one type per parameter. `ON DELETE SET NULL` re-checks table constraints on the child row (see `server/account/delete.ts`).
- **Time:** store UTC; show and enter times in a named zone (default `Africa/Lagos`, "WAT") with `src/shared/time.ts`.
- Install/notification copy must stay honest: feature detection decides what's possible, the user agent only picks instructions; never claim to detect installs universally or to force another browser.

### Website on Vercel

- `vercel.json` gives the website the server's security headers, cache rules and SPA fallback (`server/app.ts`): change both together; `server/vercel-config.test.ts` compares them. It uses Vercel's routing phases: long caching sits in `hit` (existing files only, so 404s are never cached), and there the **first** matching rule wins, so never let two rules set the same header on a path (the test rejects it).
- `middleware.ts` forwards `/api/*` to `API_ORIGIN`. Vercel runs it as an unbundled Node ES module: its relative imports need the `.js` extension (tested).
- The API trusts `x-edge-client-ip` only with the right `EDGE_PROXY_SECRET` (`server/edge-proxy.ts`, before Fastify logs or rate-limits the request). Never log the secret or put it in a command line.
- Deploy with the CLI only from a clean export of committed files, never from the working folder (it holds `.env`, local databases and dumps; `.vercelignore` is only a backstop).
