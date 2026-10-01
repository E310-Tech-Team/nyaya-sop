# School of Purpose: Purpose Boot Camp applications

The expression-of-interest website for the **RCCG Young Adults & Youth School of Purpose** Purpose Boot Camp (First Edition, "The Called Generation"). It has a landing page and programme pages, and a three-step application form that stores submissions in PostgreSQL. On top of that, all optional for applicants:

- an **installable web app** (PWA) with an offline-friendly public site and honest install guidance per device;
- **Web Push notifications** by topic, with consent kept separate from the application;
- **applicant accounts** (passwordless email sign-in) to follow a published application status and read messages;
- an **admin platform** at `/admin` for the Programme team: applicant review and publication, accounts, cohorts, notification campaigns, announcements, staff roles with two-step verification (passkeys, an authenticator app or email codes, or a passkey alone), settings and an audit history.

- **Website:** React 19 + React Router, Tailwind CSS v4, built with Vite
- **API:** Fastify 5 (Node 22) serving the built website and `/api/*`
- **Database:** PostgreSQL 17 (embedded PGlite for local development and tests)
- **Hosting:** one VPS: Docker Compose with Caddy for automatic HTTPS; or the website on Vercel with `/api` forwarded to the VPS (see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Production: https://nyayasop.org, the whole site on one DigitalOcean Droplet

## Quick start (local development)

Requirements: Node ≥ 22.22 and pnpm (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173. `pnpm dev` starts Vite (web, with hot reload) and the API on port 3000 (proxied at `/api`; if another tool already uses port 3000, set `API_PORT=3001` in `.env`). **No database setup is needed**: in development the API uses an embedded Postgres (PGlite) stored in `.data/pglite/`. To use a real Postgres instead, set `DATABASE_URL` in `.env` (see [`.env.example`](.env.example)).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Web (Vite, :5173) + API (tsx watch, :3000) with the embedded dev database |
| `pnpm build` | Production build: website → `dist/`, server → `server-dist/` |
| `pnpm start` | Run the built server (serves `dist/` + API). For a real deployment set `NODE_ENV=production` (it then needs `DATABASE_URL`, `SITE_URL` and `APP_SECRET`); without it the server only starts on loopback with a local or no `SITE_URL` |
| `pnpm test` | Unit + API tests (Vitest; API tests run against an in-memory Postgres) |
| `pnpm typecheck` | TypeScript: the app and server, then the service worker (its own `tsconfig.sw.json`) |
| `pnpm check` | typecheck + test + build (what CI runs) |
| `pnpm db:migrate` | Apply database migrations (they also run automatically at startup) |
| `pnpm admin create-owner --email … --name …` | Create the first owner (prints a single-use setup link). Also `reset-mfa --email …`, `list` |
| `pnpm push:keys` | Generate a VAPID key pair for Web Push (once per site) |
| `pnpm worker` | Run background jobs as a separate process (with `WORKER_MODE=off` on the web server) |
| `python3 scripts/brand-assets.py` | Rebuild the logo lockups, favicons and app icons from the brand masters in `design/brand/` (needs Pillow; outputs are committed) |
| `python3 scripts/partner-logo.py` | Rebuild the footer's RCCG Young Adults & Youths emblem from the supplied logo in `design/brand/partners/`, its white page made transparent (needs Pillow and numpy; outputs are committed) |

## Project layout

```
src/                 React app
  pages/             Landing, programme pages, Welcome, the 3 form steps, Review, Success, Install, Notifications, Updates, 404
  components/        Form layout, fields, buttons, header, route helpers, account/admin UI kit (ui/: shadcn/ui primitives adapted to the brand, basic.tsx for public pages), notification card/settings
  account/           Applicant account area (/account/*, lazy-loaded)
  admin/             Admin platform (/admin/*, lazy-loaded)
  sw/                Service worker (sw.ts) and its tested caching policy (routing.ts)
  lib/               API client, install and push helpers, service-worker registration and updates
  state/             Application draft (React context, saved in sessionStorage)
  shared/            Option lists + validation shared with the server (single source of truth)
  assets/            Images (WebP/SVG, content-hashed at build), including brand/ (the logo lockups)
server/              Fastify API: app.ts, config.ts, db.ts, migrate.ts
  auth/              Staff and applicant sessions, CSRF, staff sign-in with two-step verification (passkeys, app, email codes)
  account/ admin/    Applicant account routes; admin routes (applicants, accounts, cohorts, campaigns, staff…)
  push/ jobs/        Web Push (SSRF-safe transport, VAPID, subscriptions); Postgres job queue and worker
  notifications/     Campaign audience, dispatch and delivery
  migrations/        SQL migrations (schema + first cohort)
deploy/              One-command VPS installer, release script for GitHub Actions (ci-deploy.sh), Caddyfile, backup script, systemd unit, Nginx example
.github/workflows/   CI: checks on pull requests; checks, then a release to production, on main
docs/                Product & technical docs (PRD, TRD, flows, design, schema, plan, deployment)
design/              brand/: logo masters, palette and usage rules; the Figma prototype's reference render
Dockerfile, docker-compose.yml, .env.example
vercel.json, middleware.ts   The website on Vercel: headers, caching, SPA fallback; /api forwarded to the VPS
```

## Deploying

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. In short, on an Ubuntu VPS (as root), after cloning to `/opt/school-of-purpose` with a read-only deploy key:

```bash
./deploy/install.sh --domain apply.example.org --email you@example.org --name "Your Name"
```

It installs Docker, generates the secrets on the server, builds and starts Caddy (HTTPS), the app, the worker and Postgres, creates the first owner and schedules backups. Run it again after `git pull` to update.

Production is released by GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): pull requests get `pnpm check` and a Docker image build; every push to `main` gets the same checks, then (while the repository variable `AUTO_DEPLOY` is `on`) `deploy/ci-deploy.sh` releases it on the server over SSH and the live site is checked. It needs a one-time setup on the server and in GitHub first ([DEPLOYMENT, Automatic deployment](docs/DEPLOYMENT.md#automatic-deployment-github-actions)).

To serve the website from Vercel instead (the VPS keeps the API, worker and database), see [DEPLOYMENT §C](docs/DEPLOYMENT.md#c-website-on-vercel-api-on-the-vps).

## Documentation

| Doc | Contents |
|---|---|
| [01-PRD](docs/01-PRD.md) | Product requirements, form content, user stories, open questions |
| [02-TRD](docs/02-TRD.md) | Stack, architecture, configuration, non-functional requirements |
| [03-App-Flow](docs/03-App-Flow.md) | Routes, screens and user flows |
| [04-UI-UX-Design-Brief](docs/04-UI-UX-Design-Brief.md) | Design tokens, typography, components, accessibility |
| [05-Backend-Schema](docs/05-Backend-Schema.md) | Database schema and API reference |
| [06-Implementation-Plan](docs/06-Implementation-Plan.md) | What's built, what's next, decisions log |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | VPS runbook, automatic deployment and rollback, website on Vercel, backups, operating the site |
