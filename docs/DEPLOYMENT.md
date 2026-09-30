# Deployment and operations runbook: VPS (DigitalOcean, Linode or similar)

**Last updated:** 2026-09-30 · Production: https://nyayasop.org, the whole site on one DigitalOcean Droplet installed with the [quick install](#quick-install-one-command) ([06 D-49](06-Implementation-Plan.md#decisions-log)); every push to `main` released by GitHub Actions once [set up](#automatic-deployment-github-actions) (D-51)

This deploys the whole site (website + installable app + API + background worker + PostgreSQL) to **one Linux VPS**. There are two options:

| | **A. Docker Compose (recommended)** | **B. Bare metal** |
|---|---|---|
| What runs | 4 containers: Caddy (HTTPS) → app (Node) → Postgres 17, plus a worker (same image) | Nginx → Node (systemd, worker inside) → Postgres installed with apt |
| HTTPS | Automatic (Caddy / Let's Encrypt) | certbot |
| Updating | `git pull && docker compose up -d --build` | `git pull && pnpm install && pnpm build && systemctl restart` |
| Best for | Most setups; reproducible | Servers where Docker isn't allowed |

**C. Website on Vercel, API on the VPS** ([below](#c-website-on-vercel-api-on-the-vps)) splits it: Vercel serves the website and installable app, and forwards `/api` to a VPS set up with A or B, which keeps the API, worker and database.

Related: [02-TRD](02-TRD.md) (stack, security) · [05-Backend-Schema](05-Backend-Schema.md) (database, API, retention) · [`.env.example`](../.env.example) (every setting)

**Never expose the development server (`pnpm dev`) to the internet.** It has no HTTPS, uses the test email outbox (whose page shows sign-in links) and a development secret. Anything reachable from outside, including staging, runs a production build.

---

## 0. Before you start

1. **A VPS** running Ubuntu 24.04 LTS (or Debian 12). 1 vCPU / 1 GB RAM is enough (Linode "Nanode"); 2 GB is more comfortable with the worker. London is a good default region for Nigeria.
2. **A domain or subdomain** (e.g. `apply.yourchurch.org`) with an **A record** (and AAAA for IPv6) pointing at the VPS. **HTTPS is required**, not optional: installing the app, the service worker, push notifications and the secure sign-in cookies only work on a valid `https://` origin. Set up DNS first: certificates are issued only once it resolves. If people may type `www.`, point `www.DOMAIN` at the VPS too (an A record, or a CNAME to `DOMAIN`): it then redirects to `https://DOMAIN` (`WWW_REDIRECT`, [A2](#a2-get-the-code-and-configure)).
3. **Firewall:** allow only SSH (22), HTTP (80) and HTTPS (443). Postgres is never exposed.
   ```bash
   sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
   ```
4. **An email provider** (optional at first, needed for applicant sign-in and emailed staff invitations): any SMTP service (Resend, which production uses, Postmark, Mailgun, Amazon SES, Zoho, Brevo…), with SPF and DKIM set up for the sending domain. Without it, sign-in by email stays **off** and the site says so; nothing pretends an email was sent.
5. **Who the staff are and their roles** ([05 §6](05-Backend-Schema.md#roles-and-permissions)). At least one owner, ideally two, so one can recover the other.

---

## Quick install (one command)

On a fresh Ubuntu 24.04 / Debian 12 VPS (e.g. a Hostinger KVM plan), as root:

```bash
# 1. If the repository is private, give this server a read-only deploy key (a public one clones over HTTPS)
ssh-keygen -t ed25519 -N "" -f ~/.ssh/sop_deploy -C sop-vps && cat ~/.ssh/sop_deploy.pub
#    → GitHub: E310-Tech-Team/nyaya-sop → Settings → Deploy keys → Add (leave "write access" off)

# 2. Get the code
GIT_SSH_COMMAND="ssh -i ~/.ssh/sop_deploy -o StrictHostKeyChecking=accept-new" \
  git clone git@github.com:E310-Tech-Team/nyaya-sop.git /opt/school-of-purpose
cd /opt/school-of-purpose && git config core.sshCommand "ssh -i ~/.ssh/sop_deploy"

# 3. Install
./deploy/install.sh --domain apply.yourchurch.org --email you@yourchurch.org --name "Your Name"
```

[`deploy/install.sh`](../deploy/install.sh) installs Docker if needed (and swap on servers under 2 GB), refuses to start if something else holds ports 80/443, creates `.env` with **new secrets generated on the server** (`POSTGRES_PASSWORD`, `APP_SECRET`), checks that the domain points at the server, builds and starts the four containers, generates the Web Push keys, creates the first owner (it prints the single-use setup link: open it straight away), schedules nightly backups, and prints the site's health. It never prints secrets.

- **Domain:** point the domain's A record at the VPS first. No domain yet? Leave out `--domain`: it uses the server's hostname (on Hostinger, `srvNNNNNN.hstgr.cloud`, which already points at the VPS) and you can switch later by running the script again with `--domain`.
- **www:** when `www.DOMAIN` points at the VPS too, the script sets `WWW_REDIRECT=on` in `.env` and `https://www.DOMAIN` redirects to `https://DOMAIN`. Added the record later? Run the script again. `WWW_REDIRECT=off` keeps it off.
- **Hostinger firewall:** if the VPS firewall in hPanel is on, allow TCP 22, 80 and 443 (and UDP 443).
- **DigitalOcean:** an Ubuntu 24.04 Droplet created with your SSH key is enough (1 GB works: the script adds swap). Add a Cloud Firewall (Networking → Firewalls) allowing inbound TCP 22, 80 and 443 and UDP 443. DigitalOcean blocks outbound email ports 25, 465 and 587 on new accounts: use your email provider's alternative port (Resend: 2465; many others: 2525; see [Email](#email)), or ask DigitalOcean support to lift the block.
- **Email** stays off until you add `SMTP_URL` and `EMAIL_FROM` to `.env` and run the script again ([Email](#email)).
- **Updating:** `cd /opt/school-of-purpose && git pull && ./deploy/install.sh` (it backs up the database first and keeps `.env`). Production is instead released by GitHub Actions on every push to `main` ([Automatic deployment](#automatic-deployment-github-actions)).
- **Back up `.env` privately** (password manager or sealed offline copy): see [A7](#a7-backups-do-this-on-day-one).

The sections below are the same steps done by hand, and how to run the site.

## A. Docker Compose (recommended)

### A1. Install Docker (once)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # log out and back in afterwards
```

### A2. Get the code and configure

```bash
sudo mkdir -p /opt/school-of-purpose && sudo chown $USER /opt/school-of-purpose
git clone <your-repo-url> /opt/school-of-purpose
cd /opt/school-of-purpose
cp .env.example .env && chmod 600 .env
nano .env
```

Get the code with `git clone` (or `git archive` from a clean checkout), never by copying a working folder: a developer's folder can hold `.env`, local databases and dumps.

| Variable | Value |
|---|---|
| `DOMAIN` | `apply.yourchurch.org` (the site will be `https://DOMAIN`; `SITE_URL` is derived from it) |
| `WWW_REDIRECT` | `on` to redirect `www.DOMAIN` to `https://DOMAIN` (its DNS must point at the VPS too, or Caddy can't get its certificate); `off` or unset: no `www` site. `install.sh` sets it when it finds that record |
| `POSTGRES_PASSWORD` | `openssl rand -hex 24` |
| `APP_SECRET` | `openssl rand -base64 48`. **Required.** Keep it stable: changing it signs everyone out and breaks stored secrets ([rotation](#rotating-secrets)) |
| `SMTP_URL`, `EMAIL_FROM` | when you have an email provider, e.g. `smtps://USER:PASS@smtp.example.com:465` and `School of Purpose <no-reply@apply.yourchurch.org>`. With `smtp://` (port 587) the server must offer STARTTLS, or nothing is sent: the links in these emails sign people in |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | for push notifications: see [A4](#a4-web-push-keys-once) |
| `VITE_CONTACT_EMAIL` | optional public contact address |
| `BUILD_ID` | optional release name (e.g. the git commit: `BUILD_ID=$(git rev-parse --short HEAD)`) |

### A3. Start

```bash
docker compose up -d --build
docker compose ps              # db, app (healthy), worker, caddy: all running
docker compose logs -f app     # "Applied migration …", "Server listening…"
docker compose logs -f worker  # "Background worker … started"
```

The app logs a warning for each optional integration that isn't configured ("Email is not configured…", "VAPID keys are not configured…").

### A4. Web Push keys (once)

```bash
docker compose run --rm app node server-dist/push-keys.js
```

Copy the three lines into `.env`, set `VAPID_SUBJECT` to a monitored `mailto:` address (Apple requires `mailto:` or `https:`), then `docker compose up -d` (app and worker restart). **Back up the key pair with `.env`** ([A7](#a7-backups-do-this-on-day-one)). Generate it only once per site: new keys make every device turn notifications on again (the app does this automatically when someone next opens it with permission already granted, but devices that aren't opened stop receiving).

### A5. First admin

No default credentials exist anywhere. On the server:

```bash
docker compose exec app node server-dist/admin.js create-owner --email you@yourchurch.org --name "Your Name"
```

It prints a **single-use link, valid 72 hours**: treat it like a password. Open it, choose a password (12+ characters), then set up two-step verification (scan the QR code in an authenticator app, confirm a code, **save the 10 recovery codes**). Then invite colleagues from **Admin → Staff** (emailed, or a link to share privately when email is off).

### A6. Smoke test

```bash
curl -s https://DOMAIN/api/health   # {"status":"ok","database":"ok"}
curl -s https://DOMAIN/api/config   # accounts/push enabled flags and the release id
curl -sI https://DOMAIN/sw.js | grep -i -E "cache-control|service-worker-allowed"   # no-cache, /
```

Then in a browser: submit a test application; sign in to `/admin`; check **Settings → Integrations and health** (email, push, worker "Running"); register your phone as a test device (**Notifications → Your test devices**) and **Send a test**; delete the test application (**Applicants → the application → Delete**).

### A7. Backups (do this on day one)

```bash
./deploy/backup.sh          # writes backups/sop-YYYY-MM-DD_HHMMSS.dump (private, 600)
crontab -e                  # add:
# 30 2 * * * cd /opt/school-of-purpose && ./deploy/backup.sh >> backups/backup.log 2>&1
```

- Backups contain personal data. Keep 14 days on the server (the default) **and** copy them off the server (e.g. `rclone` or `restic` to encrypted object storage, or Linode Backups). The dumps themselves aren't encrypted: encrypt them on the way off the server, and arrange an alert when the nightly backup fails (it only writes to `backups/backup.log`).
- A failed dump leaves nothing behind (no half-written files with personal data), and `install.sh` stops an update when its backup fails (`--skip-backup` to go on anyway).
- **Back up `.env` separately and securely** (a password manager or sealed offline copy): it holds `APP_SECRET` and the VAPID private key. A database restored without the matching `APP_SECRET` can't decrypt staff authenticator secrets or push subscriptions.
- **Restore:** see the comment at the top of [`deploy/backup.sh`](../deploy/backup.sh). Test a restore on a spare machine once a term.

### A8. Updating the site

Production does this through GitHub Actions on every push to `main` ([Automatic deployment](#automatic-deployment-github-actions): `deploy/ci-deploy.sh` runs `deploy/install.sh`). By hand, on a server without that setup:

```bash
cd /opt/school-of-purpose
git pull
./deploy/backup.sh                                            # before any upgrade with migrations: stop if it fails
docker compose pull --ignore-buildable                        # fresh Postgres and Caddy images (security fixes)
BUILD_ID=$(git rev-parse --short HEAD) docker compose build --pull   # fresh Node base image
docker compose up -d --remove-orphans                         # app applies migrations, then the worker restarts
docker image prune -f
```

`sudo ./deploy/install.sh` does the same (and stops if the backup fails; it waits for a release that is already running). A change to `deploy/Caddyfile` alone also needs `docker compose restart caddy`: Compose mounts that one file, and a running container keeps the copy it started with. Run it at least monthly even without code changes, so security fixes in the base images reach the server, and keep the host's own packages patched (`sudo apt-get install unattended-upgrades`).

What people see: pages open in a browser tab pick up the new release when reloaded; the installed app and open tabs show **"An update is ready · Update now"** and never reload by themselves (so nobody loses a form or an admin edit). Old files stay available to tabs still on the previous version.

---

## B. Bare metal (Node + local Postgres + Nginx)

### B1. Install Node 22, pnpm, Postgres 17, Nginx

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo corepack enable
sudo apt-get install -y postgresql-common && sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-17
```

### B2. Database and service user

```bash
sudo adduser --system --group --home /opt/school-of-purpose sop
openssl rand -hex 24                                # a password to paste at the prompt below
sudo -u postgres createuser --pwprompt sop          # asked twice, never echoed, logged or in the process list
sudo -u postgres createdb --owner sop sop
```

### B3. Build

```bash
sudo -u sop git clone <your-repo-url> /opt/school-of-purpose
cd /opt/school-of-purpose
sudo -u sop cp .env.example .env && sudo -u sop nano .env
#   DATABASE_URL=postgres://sop:<PASSWORD>@127.0.0.1:5432/sop
#   TRUST_PROXY=loopback
#   SITE_URL=https://apply.yourchurch.org
#   APP_SECRET=<openssl rand -base64 48>
#   (+ SMTP_URL, EMAIL_FROM, VAPID_* when ready; WORKER_MODE stays inline)
sudo chmod 600 .env
sudo -u sop pnpm install --frozen-lockfile
sudo -u sop pnpm build
```

The systemd unit sets `NODE_ENV=production`. Run the server any other way (pm2, a shell) only with `NODE_ENV=production`: outside production mode it refuses to start with a public `SITE_URL` or on a network interface, because its development settings (a published secret, a readable email outbox, optional two-step verification) are only safe on a developer's own computer.

### B4. Run with systemd, publish with Nginx + certbot

```bash
sudo cp deploy/school-of-purpose.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now school-of-purpose
journalctl -u school-of-purpose -f            # "Server listening…", "Background worker … started"

sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/school-of-purpose
sudo sed -i 's/apply.example.org/apply.yourchurch.org/' /etc/nginx/sites-available/school-of-purpose
sudo ln -s /etc/nginx/sites-available/school-of-purpose /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt-get install -y certbot python3-certbot-nginx && sudo certbot --nginx -d apply.yourchurch.org
```

The example site logs to `/var/log/nginx/school-of-purpose.access.log` without query strings or referrers: emailed sign-in, invitation and reset links carry single-use tokens there. Keep that format if you change the logging.

First admin: `sudo -u sop node server-dist/admin.js create-owner --email … --name …`. VAPID keys: `node server-dist/push-keys.js`. Updating: `git pull && pnpm install --frozen-lockfile && pnpm build && sudo systemctl restart school-of-purpose`.

**Backups:** the same script as Docker, reading the local Postgres (`--local`, as root). It writes private files (600, in a 700 folder), removes a failed dump, and keeps 14 days:

```bash
sudo BACKUP_DIR=/var/backups/sop ./deploy/backup.sh --local    # test it once
sudo crontab -e                                                  # add:
# 30 2 * * * cd /opt/school-of-purpose && BACKUP_DIR=/var/backups/sop ./deploy/backup.sh --local >> /var/log/sop-backup.log 2>&1
```

(A `pg_dump … $(date +%F)` line in a crontab never runs: cron cuts the command at the first unescaped `%`.)

---

## C. Website on Vercel, API on the VPS

Vercel serves the website and installable app; the VPS (set up with A or B) keeps the API, background worker and database. People only ever use the Vercel address: Vercel's middleware ([`middleware.ts`](../middleware.ts)) forwards `/api/*` to the VPS, so the browser talks to one origin, sign-in cookies stay first-party and there is no CORS.

```mermaid
flowchart LR
    Browser["Browser / installed app"] -->|pages and files| CDN["Vercel: dist/ + vercel.json headers"]
    Browser -->|/api/*| MW["Vercel middleware"]
    MW -->|"+ visitor's address, shared secret"| VPS["VPS: Caddy → app"]
    VPS --> PG[("PostgreSQL")]
    Worker["worker"] --> PG
```

What stays the same as a single VPS:

- **Headers, caching, deep links:** [`vercel.json`](../vercel.json) sends the server's security headers (CSP, HSTS, frame and referrer policy…), its cache rules (`no-cache` for pages, `sw.js`, the manifest and `offline.html`; a year for `/assets/`, only for files that exist, so a 404 is never cached) and the `index.html` fallback. [`server/vercel-config.test.ts`](../server/vercel-config.test.ts) fails if the two drift apart: change both together. It uses Vercel's routing phases (`routes` with `handle: filesystem` and `hit`); in `hit` the *first* matching rule wins, so no two rules may set the same header (the test checks). Vercel also adds `Access-Control-Allow-Origin: *` to static files (all public); API responses don't get it.
- **Rate limits per visitor:** the VPS would otherwise see only Vercel's addresses. The middleware passes on each visitor's address with a secret shared by both sides (`EDGE_PROXY_SECRET`); the API believes the address only with the right secret ([`server/edge-proxy.ts`](../server/edge-proxy.ts)).
- **Update offers:** API responses through Vercel carry the Vercel release (the commit), so open pages offer "Update" after each website deploy, whatever release the VPS runs.

### C1. The VPS (API, worker, database)

1. Set it up with A (or B) under its own name, e.g. `api.yourchurch.org` (or the Hostinger `srvNNNNNN.hstgr.cloud` name). `DOMAIN` stays that name: Caddy's certificate is for it.
2. Add to `.env`:
   ```bash
   SITE_URL=https://your-project.vercel.app    # the website's address (or its own domain on Vercel)
   EDGE_PROXY_SECRET=                          # openssl rand -base64 48; the same value goes into Vercel (C2)
   ```
   `SITE_URL` is where people use the site: email links point there, and the API accepts changes only from pages there.
3. `docker compose up -d --build` (bare metal: keep `TRUST_PROXY=loopback`, then restart).
4. `curl -s https://api.yourchurch.org/api/health` → `{"status":"ok","database":"ok"}`.

### C2. The Vercel project

1. **Add New → Project** and import the GitHub repository (or deploy a clean checkout with the CLI: `vercel deploy --prod`). `vercel.json` sets the build: `pnpm run build:web`, output `dist/`.
2. **Settings → Environment Variables**, for Production:

   | Name | Value |
   |---|---|
   | `API_ORIGIN` | the VPS, e.g. `https://api.yourchurch.org` (https, no path) |
   | `EDGE_PROXY_SECRET` | the same value as the VPS's `.env` (mark it Sensitive) |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`: the build then uses the pnpm version pinned in `package.json` |
   | `VITE_CONTACT_EMAIL` | optional, as on the VPS |

   `SITE_URL` isn't needed here: the build uses the project's production address for social cards. The release id is the commit (`BUILD_ID` overrides it).
3. **Redeploy** after changing variables (Deployments → ⋯ → Redeploy): a deployment keeps the values it was built with.
4. Keep `API_ORIGIN` and `EDGE_PROXY_SECRET` on Production only. Preview deployments then answer `/api` with 503 and never touch real data (and the API refuses changes from any address but `SITE_URL` anyway).

Until both variables are set, the website works and every `/api` call answers `503` with "This service is temporarily unavailable", which forms show; nothing pretends to have been sent.

### C3. Check

```bash
SITE=https://your-project.vercel.app
curl -s $SITE/api/health                                  # {"status":"ok","database":"ok"}; 503 SERVICE_UNAVAILABLE = C2 not done
curl -sI $SITE/api/health | grep -i x-app-build           # the Vercel release (the commit)
curl -sI $SITE/sw.js | grep -i -E "cache-control|service-worker-allowed"   # no-cache, /
curl -sI $SITE/apply | grep -i -E "content-security-policy|cache-control"
```

Then A6's browser checks on the Vercel address: a test application, `/admin` sign-in (**Settings → Integrations and health** shows the Vercel site address, and one release id when both sides run the same commit), a test notification, then delete the test application. `docker compose logs app` shows visitors' addresses; the warning "edge proxy secret did not match" means the two secrets differ.

### C4. Updating

- **Website:** Vercel builds every push once the repository is connected (production from `main`, previews from other branches). **API:** A8 on the VPS, as before (migrations run there). Production doesn't use this split (06 D-49): its Vercel project stays unconnected, and releases go only through [automatic deployment](#automatic-deployment-github-actions).
- A website change that needs a new API (a new endpoint or field): update the VPS first, then merge the website.
- Service worker rollback: set `SW_KILL_SWITCH=1` in Vercel's environment variables and redeploy; remove it and redeploy after a few days ([below](#service-worker-rollback)).

### C5. Good to know

- The VPS's own address still serves a copy of the website, but its forms don't work there (the API only accepts changes from `SITE_URL`). Share only the Vercel address.
- Vercel's Hobby plan is for personal, non-commercial use, and deploying an organisation's private repository needs Pro; check the current terms fit.
- A CLI deploy uploads the folder it runs in. [`.vercelignore`](../.vercelignore) keeps `.env`, local databases, dumps and archives out, but a clean checkout is safer.

---

## Operating the site

### Automatic deployment (GitHub Actions)

Production is released by one workflow, [`.github/workflows/ci.yml`](../.github/workflows/ci.yml): every push to `main` (a merged pull request) is checked, released and then checked live ([06 D-51](06-Implementation-Plan.md#decisions-log)). It is the only way releases reach production: the Vercel project's Git integration stays disconnected (Phase 15 is on hold), and `deploy/install.sh` by hand is for emergencies ([below](#releasing-by-hand)).

**Status (2026-09-30): built and tested locally; it runs once the owner has done the [one-time setup](#one-time-setup-the-owner).** Until then the deploy job of each push to `main` fails at "Check the settings" and changes nothing.

```mermaid
flowchart LR
    PR["Pull request"] --> C1["check + docker"]
    Push["Push to main"] --> C2["check + docker<br/>(that commit)"] --> D["deploy<br/>(environment: production)"]
    Manual["Run workflow<br/>(a commit on main)"] --> C2
    D -->|"ssh deploy@server 'deploy SHA'"| S["deploy/ci-deploy.sh<br/>(root, one sudo rule)"]
    S --> I["deploy/install.sh<br/>backup → build → restart"]
    S --> V1["app healthy, same release,<br/>worker heartbeat"]
    D --> V2["from GitHub: /api/health,<br/>/api/config, /, /sw.js"]
```

1. **Pull request:** `check` (`pnpm check`: types, tests, build) and `docker` (the production image builds). Nothing is deployed.
2. **Push to `main`:** the same two jobs on the pushed commit, then `deploy`. If `main` has moved on by the time `deploy` starts, it releases nothing: the newer commit's own run releases it, with everything before it, so an older commit never replaces a newer one.
3. **Run by hand** (Actions → CI → Run workflow, branch `main`, optional `sha`): the same checks on that commit, which must already be on `main` (empty: the head of `main`), then the same release. For recovery and [rollback](#rollback).
4. **On the server:** `deploy` connects as the `deploy` user with its own key, pinned to the server's host key. The key can only run `sudo -n /opt/school-of-purpose/deploy/ci-deploy.sh "deploy <commit>"`, which waits for any release already running, refuses a commit that isn't on GitHub's `main`, local changes to tracked files and local commits, notes the release that was running (the rollback target), checks the commit out on branch `main`, runs `deploy/install.sh` (database backup first, and it stops if the backup fails; fresh base images; build; `docker compose up -d`), then confirms that the app is healthy and serves this release, and that the worker runs it and has written a heartbeat since. Its whole output is kept in `logs/deploy/` on the server (90 days).
5. **From GitHub:** `/api/health` answers ok with the database ok, `/api/config` reports this release (an abbreviation of the commit), `/` answers 200 with the page, and `/sw.js` contains the release id. Any failure fails the deployment.

One release at a time: the `production-deploy` concurrency group never cancels a running release. GitHub keeps only the newest waiting run and cancels older waiting ones, which is fine: it releases the newest `main`. A cancelled or timed-out job doesn't stop a release that has started on the server (the release writes to its log, not to the connection): it finishes there, and the next one waits for it.

During a release the app restarts: for a few seconds (longer while migrations run) Caddy answers with an error. Open pages keep their loaded files; the installed app and open tabs offer **"An update is ready · Update now"** and never reload by themselves; `/api`, `/admin*` and `/account*` are never cached, as before ([03 §6](03-App-Flow.md#6-offline-and-updates)).

#### One-time setup (the owner)

In this order:

1. **Merge** the pull request that adds this (its deploy job fails at "Check the settings": expected).
2. **Install that release by hand once**, so the script exists on the server. As root: `cd /opt/school-of-purpose && git pull && ./deploy/install.sh`
3. **The `deploy` user**, whose key can run one command, through one sudo rule. As root on the server:
   ```bash
   adduser --disabled-password --comment "GitHub Actions deploy" deploy
   install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
   f="$(mktemp)" && echo 'deploy ALL=(root) NOPASSWD: /opt/school-of-purpose/deploy/ci-deploy.sh' > "$f" \
     && visudo -cf "$f" && install -m 440 -o root -g root "$f" /etc/sudoers.d/sop-deploy; rm -f "$f"
   ```
   If `/etc/ssh/sshd_config` limits logins (`AllowUsers`, `AllowGroups`), add `deploy` there and `systemctl reload ssh`.
4. **The key pair**, on your own computer (not the server), without a passphrase (GitHub uses it unattended):
   ```bash
   ssh-keygen -t ed25519 -N "" -C github-actions-deploy -f ~/.ssh/sop-github-deploy
   cat ~/.ssh/sop-github-deploy.pub
   ```
   On the server, as root, the one line that key may use (put the contents of `sop-github-deploy.pub` in place of `ssh-ed25519 AAAA… github-actions-deploy`):
   ```bash
   cat > /home/deploy/.ssh/authorized_keys <<'EOF'
   restrict,command="sudo -n /opt/school-of-purpose/deploy/ci-deploy.sh \"$SSH_ORIGINAL_COMMAND\"" ssh-ed25519 AAAA… github-actions-deploy
   EOF
   chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys
   ```
   `restrict` leaves the key no shell, forwarding or terminal; `command=` runs only the release script, which accepts only `deploy <full commit on main>`. Check it from your computer: `ssh -i ~/.ssh/sop-github-deploy deploy@DEPLOY_HOST "deploy nothing"` answers `Expected one argument: "deploy <full 40-character commit on main>". Nothing was changed.` (the key, the forced command and sudo work, and nothing was released).
5. **The server's host key**, for `DEPLOY_KNOWN_HOSTS`. On your computer:
   ```bash
   ssh-keyscan -t ed25519 DEPLOY_HOST > sop-known-hosts
   ssh-keygen -lf sop-known-hosts
   ```
   Compare that `SHA256:…` fingerprint with the one the server gives in the DigitalOcean web console (Droplet → Access → Launch Droplet Console): `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`. Use the line only if they match (otherwise something is between you and the server).
6. **GitHub → Settings → Environments → New environment `production`:**
   - Deployment branches and tags: **Selected branches and tags** → `main`, **before** adding the secrets: a workflow edited on any other branch could otherwise ask for this environment and read them.
   - Optional: **Required reviewers** (the owner). Each release then waits for approval (Review deployments); that is also the way to pause releases.
   - **Environment secrets:** `DEPLOY_SSH_KEY` = the whole private key file `~/.ssh/sop-github-deploy` (from `-----BEGIN` to `-----END`); `DEPLOY_KNOWN_HOSTS` = the line in `sop-known-hosts`. Environment secrets, not repository secrets: only the deploy job can read them, and it runs no third-party actions.
   - **Environment variables:** `DEPLOY_HOST` = the Droplet's IP address, or a name that points straight at it (the same one you gave `ssh-keyscan`; not a name behind a proxy or CDN); `DEPLOY_USER` = `deploy`; `SITE_URL` = `https://nyayasop.org`.

   Then delete the private key and `sop-known-hosts` from your computer. If the key is ever needed again, make a new pair (step 4) and replace the secret.
7. **Try it:** Actions → CI → Run workflow, branch `main`, `sha` empty. It should end green, with a summary naming the release. From then on every push to `main` is released.
8. **Protect `main`** ([next](#protecting-main)).

To replace the key: a new pair (step 4), the new line in `authorized_keys`, the new `DEPLOY_SSH_KEY`. To switch automatic releases off: delete `/home/deploy/.ssh/authorized_keys` on the server (releases then fail at the SSH step), or add required reviewers and don't approve.

#### Protecting main

Every commit that reaches `main` is released, and its `deploy/install.sh` and `deploy/ci-deploy.sh` run as root on the server. A direct push to `main` is released too (after its checks) without anyone reviewing it, so `main` must only take reviewed, checked pull requests. **Settings → Branches → Add branch protection rule** for `main`:

- **Require a pull request before merging**; optionally 1 approving review (the owner reviews what techsupport-alt opens, and the other way round).
- **Require status checks to pass:** `check` and `docker`, with **Require branches to be up to date before merging**.
- **Do not allow bypassing the above settings** (administrators included).
- Force pushes and deletions stay blocked (a protection rule's default).

The same with the GitHub CLI (`0` instead of `1` keeps pull requests required without approvals):

```bash
gh api -X PUT repos/E310-Tech-Team/nyaya-sop/branches/main/protection --input - <<'EOF'
{ "required_status_checks": { "strict": true, "checks": [ { "context": "check" }, { "context": "docker" } ] },
  "enforce_admins": true,
  "required_pull_request_reviews": { "required_approving_review_count": 1 },
  "restrictions": null, "allow_force_pushes": false, "allow_deletions": false }
EOF
```

#### Release safety

- **Migrations must work with the release before them.** The previous worker keeps running against the migrated database until the new app is healthy, and a rollback runs the previous code on it. So: additive first (new tables, new columns that are nullable or have a default); destructive changes (dropping or renaming a column, table or enum value, `NOT NULL` on existing data) in a later release, once no running code, including the release before, uses the old shape. A rename is add, copy, switch the code, drop later. A new enum value is safe only once the release before can read rows that use it.
- The app applies pending migrations once per release, when it starts and before it serves (under a lock); the worker (`RUN_MIGRATIONS=false`) starts only once the app is healthy. An older release doesn't trip over newer migrations: the runner applies only the files it has.
- Never reset or drop the database in a release, and there are no automatic down-migrations. The backup `install.sh` takes before every release (`backups/sop-<time>.dump`) is the recovery point: a failed backup stops the release, and releases never use `--skip-backup`.
- One release at a time: `ci-deploy.sh` and `install.sh` share the lock `/run/lock/sop-deploy.lock`. `git pull` isn't covered by it: on this server, release by hand with `ci-deploy.sh`.

#### Releasing by hand

When GitHub Actions can't run, or in an emergency, as root on the server:

```bash
cd /opt/school-of-purpose && git fetch origin main && ./deploy/ci-deploy.sh "deploy $(git rev-parse origin/main)"
```

It runs the same checks, lock, backup and summary as the workflow (any commit on `main` works in place of `origin/main`). If GitHub itself is unreachable, `./deploy/install.sh` rebuilds what is checked out (it waits for a running release too).

#### Rollback

1. Find the last good release: the failed run's summary (**Release before**), the server's `logs/deploy/`, or Settings → Environments → production (each deployment names its commit).
2. Actions → CI → Run workflow, branch `main`, `sha` = that commit. It runs the checks on it, then releases it like any other (backup first). Re-running an old push run doesn't roll back: a push run whose commit is no longer the head of `main` releases nothing.
3. The database stays as the newer release left it (migrations only go forward), so the older code must work with it ([release safety](#release-safety)). If it doesn't (the rollback fails its checks), restoring the backup `install.sh` took just before the bad release is a human decision: everything written since then is lost. Take a fresh backup first, and restore into an empty database (the restore in [`deploy/backup.sh`](../deploy/backup.sh) with `--clean` keeps tables that newer migrations created):
   ```bash
   cd /opt/school-of-purpose && ./deploy/backup.sh
   docker compose stop app worker
   docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
   docker compose exec -T db sh -c 'pg_restore --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/sop-YYYY-MM-DD_HHMMSS.dump
   ```
   Then run the workflow with the old `sha` again: it starts the app and worker.

#### What a release leaves behind

- **The run's summary** (Actions → the run → Summary): the outcome, the commit and its subject, what started it, the release before (the rollback target), which services were recreated (the app and worker whenever the commit changes; Postgres and Caddy only when a newer image was pulled) and the live checks.
- **Settings → Environments → production** (and the repository's Deployments): each release with its commit, time and run.
- **On the server:** `logs/deploy/<UTC time>-<commit>.log`, the whole release. The Actions log shows the same output and is public, so the scripts print no secrets, no `.env` and no container logs (they can hold visitors' addresses).

### The admin area

Everything the Programme team does is at **`https://DOMAIN/admin`**: applicants (review, notes, publishing decisions, CSV download), applicant accounts, cohorts (opening and closing applications), notifications, announcements, staff, settings and the audit history ([03 §9](03-App-Flow.md#9-admin-platform)). Each person signs in with their own account and two-step verification. What they can do depends on their role. The old `…/api/admin/applications.csv` address no longer accepts a shared password.

### Opening and closing applications

**Admin → Cohorts → Edit**: tick or untick *Accepting applications*, and optionally set opening and closing times (entered in Lagos time by default, stored in UTC). SQL fallback: `update cohorts set is_accepting_applications = false where slug = 'called-generation-1';`.

### Email

Set `SMTP_URL` and `EMAIL_FROM`, restart (`docker compose up -d`). Check **Settings → Integrations and health** shows "SMTP configured", then request a sign-in link at `/account` with your own address. If emails land in spam, check SPF/DKIM/DMARC for the sending domain. Some hosts block the usual SMTP ports (DigitalOcean: 25, 465 and 587 on new accounts): use the provider's alternative port, often 2525 with STARTTLS (`smtp://USER:PASS@smtp.example.com:2525`).

Production uses **Resend**: `SMTP_URL=smtps://resend:API_KEY@smtp.resend.com:2465` (TLS on Resend's alternative port; 2587 is its STARTTLS one) and `EMAIL_FROM=School of Purpose <no-reply@nyayasop.org>`, with `nyayasop.org` verified in Resend (DKIM on `resend._domainkey`, MX and SPF on `send`, and a DMARC record). Give the key sending access only. It belongs only in the server's `.env`: paste it there over SSH (or send it through SSH's standard input), never into a chat, a ticket or a command line, and restart the app and worker. To replace the key, create a new one in Resend, put it in `.env`, restart, then delete the old one.

Applicant sign-in can also be switched off in **Settings** without removing the configuration.

### Background worker

- Docker: the `worker` container (`restart: unless-stopped`); the app runs with `WORKER_MODE=off`. Bare metal: inside the web process (`WORKER_MODE=inline`, supervised by systemd).
- **Graceful shutdown:** on SIGTERM the worker stops claiming jobs, lets running ones finish for up to 20 s, then hands the rest back to the queue (the web server finishes requests within 15 s). Compose waits 30 s for the worker and 20 s for the app; systemd waits 20 s.
- **Heartbeat:** the worker writes a heartbeat every 30 s; **Settings → Integrations and health** shows "Running" if it's under 2 minutes old. If it says "Not seen", check `docker compose logs worker`.
- Several workers can run at once safely (jobs are claimed with `FOR UPDATE SKIP LOCKED`).

### Queue monitoring and failed jobs

The dashboard's **Background jobs** panel shows waiting, running and failed (7 days) jobs with the latest errors. A campaign's page shows its deliveries (queued, attempted, accepted by the push service, failed, expired, skipped).

```sql
-- docker compose exec db psql -U sop -d sop
select id, kind, status, attempts, run_at, last_error from jobs where status in ('failed', 'pending') order by updated_at desc limit 20;
-- Retry a failed job (every job kind is safe to run again):
update jobs set status = 'pending', run_at = now(), attempts = 0, last_error = null, finished_at = null where id = 123;
```

A job whose worker crashed is picked up again automatically when its lease (2 minutes) runs out. Deliveries that failed permanently (e.g. a device that no longer exists) are not retried; that's expected.

### Staff sign-in problems

| Situation | Fix |
|---|---|
| Lost phone, has recovery codes | Sign in with a recovery code ("Use a recovery code"), then **Your security → Create new recovery codes**; an owner can reset their two-step verification so they enrol the new phone |
| Lost phone and codes | Another owner: **Staff → Reset two-step verification**. The only owner: on the server, `docker compose exec app node server-dist/admin.js reset-mfa --email …` |
| Forgotten password | `/admin/forgot` (needs email). Without email: `docker compose exec app node server-dist/admin.js reset-password --email …` prints a single-use 30-minute link; the reset still asks for their authenticator code |
| Locked out after wrong attempts | Wait (15 min, doubling up to 24 h), or an owner uses **Staff → Unlock sign-in**. Anyone who knows a staff email can cause a lock this way, so unlock only when you're sure it was a mistake or a nuisance, not someone who has the password |
| Invitation expired | **Staff → New invitation link** |

### Migrations

They run automatically when the app starts (`RUN_MIGRATIONS=true`), in order, each in a transaction, under a lock. To run them without starting the site: `docker compose run --rm app node server-dist/migrate.js`. **Back up first**; never edit an applied migration file. Each must work with the release before it ([release safety](#release-safety)).

### Parish directory

The parish question and the reports use the RCCG parish list ([05 §2](05-Backend-Schema.md#parish-directory-0006-0008)). Its source is the **RCCG directory API** once that's configured ([next section](#rccg-directory-api)); until then, a spreadsheet loaded from the command line, as below. Once the API has supplied the directory, spreadsheet imports are refused. **Never commit the RCCG files or the issue reports**: the repository is public (`.gitignore` ignores spreadsheets and CSVs). Copy the file straight to the server and delete it afterwards.

```bash
docker compose cp "RCCG PARISHES.xlsx" app:/tmp/parishes.xlsx
docker compose exec app node server-dist/directory.js import /tmp/parishes.xlsx --report /tmp/directory-issues.csv
```

That is a **dry run**: it shows what would change (rows, entries, units, same-name groups, parishes with no province, provinces with no state) and changes nothing. `docker compose cp app:/tmp/directory-issues.csv .` fetches the issue list to send to RCCG. Then back up (§A7) and apply:

```bash
docker compose exec app node server-dist/directory.js import /tmp/parishes.xlsx --apply --as-at YYYY-MM-DD
docker compose exec app rm /tmp/parishes.xlsx /tmp/directory-issues.csv
```

- Only the CONTINENT, REGION, PROVINCE and PARISH columns are read (any order, under any title rows). Every other column, including attendance, is ignored and never stored.
- `--as-at` records the date the list's structure is correct for.
- Importing the same file again changes nothing. A newer file updates what changed and deactivates what's gone (never deletes); each parish keeps its ID.
- **Staff corrections are kept.** A name, place, state or status staff corrected in Admin → Parish directory stays as they set it, and the dry run lists each place the file differs (`staff_override`), so you can take the correction back to RCCG. Merges and parishes staff added are kept too.
- **Undo** the latest import: `node server-dist/directory.js revert <import-id>` (the ID is printed when you apply). It's refused once staff have corrected the directory since, or once applications or reports point at parishes the import added.
- **New provinces or regions:** before importing a list that has them, record where they came from so moved parishes keep their history. A CSV with the columns `level,unit,source` (optionally `source_level`, `approved_on`), one row per source, for example `province,LAGOS PROVINCE 135,LAGOS PROVINCE 2,2026-08-17`, then `node server-dist/directory.js lineage /tmp/lineage.csv` (dry run) and again with `--apply`.
- `node server-dist/directory.js status` shows the counts, the latest imports and the consistency check.
- **Switching it on:** once a list is imported, an owner switches the parish question on in Admin → Settings (“Ask applicants to choose their parish from the RCCG directory”), next to what's loaded and what's waiting in Parish review. It can't be switched on while the directory is empty. Then work through Admin → Parish review: the answers typed before the directory, with exact matches to confirm together. Parish search needs the `pg_trgm` extension: migration 0007 creates it, which works when the app's database user owns the database (as in Compose and the bare-metal steps); otherwise run `create extension pg_trgm;` as a superuser first.
- Bare metal: the same commands in the app folder without `docker compose exec app`. In development: `pnpm directory …` (it uses `.data/pglite`, so stop `pnpm dev` first).

### RCCG directory API

Once it's configured, the RCCG Organisation Hierarchy API ([provider's documentation](https://directory-api.rccgyaya.org/docs#description/introduction)) is the directory's **only source**. The worker keeps a copy in step with it, the form searches that copy, and spreadsheet imports and staff corrections are refused. How it works: [05 §2, "Directory API"](05-Backend-Schema.md#directory-api-0010).

**Keys and environments.** The provider issues one key per environment. Each server holds one:

- **production** is the live directory, at `https://directory-api.rccgyaya.org/api/v1/org`. Use it on the live site.
- **sandbox** is the provider's staging server, `https://rccg-parish-api-staging.rccgyaya.org/api/v1/org`, with its own test codes. Use it only on a staging server or for local integration tests, never on a server that takes real applications. The server warns at start-up if a production server uses it.
  - On 2026-09-30 that host name didn't exist in public DNS (NXDOMAIN), although the provider's published contract still lists it. Sandbox keys are self-served in the provider's admin area. Ask the registry team for the sandbox's current address before relying on it.

The key needs the `org:sync` and `org:payload` scopes.

**Where the key lives.** Only in the server's `.env`. Never put it in a chat, a ticket, a URL, the repository, a `VITE_` variable or a command line. The site sends it only as `Authorization: Bearer …` to its environment's fixed address. The key never appears in logs, the admin area or error messages.

To set the key, in the app folder on the server:

```bash
./deploy/directory-key.sh production
docker compose up -d app worker
docker compose exec app node server-dist/directory.js api-status
```

The script asks for the key at a hidden prompt and writes `DIRECTORY_API_ENV` and `DIRECTORY_API_KEY` into `.env`. The key goes in single quotes, which Docker Compose and Node both read literally. The script leaves every other line alone and never prints the key.

On restart the worker fetches the directory straight away. `api-status` then shows the release in use and when the provider last confirmed it. Bare metal: run the same script, then restart the service.

**Going live, the first time:**

1. **Back up** (§A7).
2. **Set the key and restart**, as above. The first sync downloads the provider's releases and builds the copy. Release `2026.1` is about 50,000 entries in 254 pages and took under 8 minutes when checked; until it finishes, Settings says "None yet".
   - If the database holds a spreadsheet import, the old entries stop being offered. They are kept, with their history.
   - Applications keep their parish link and snapshot.
   - Each old parish that applications link to is compared with the API's parishes, by exact name and place only. Nothing is relinked. `node server-dist/directory.js legacy-report` lists the outcome as names, codes and counts, for staff to act on in Parish review.
3. Check **Admin → Settings → Parish directory**:
   - the source (production), the release in use, when the provider last confirmed it, and no problem;
   - the issues from the sync in **Parish directory → Imports** (entries the provider's data doesn't let the site place). Send them to the registry team.
4. **Switch the question on**, in the same Settings panel ("Ask applicants to choose their parish from the RCCG directory"). Until then the form asks for the parish's name.

**Settings** (in `.env`; defaults in brackets):
- `DIRECTORY_SYNC_INTERVAL_MINUTES` [15, 5–1440]: how often the worker asks for the latest release.
- `DIRECTORY_FRESHNESS_HOURS` [24, 1–168]: how long a confirmation from the provider lasts. After that, each application's parish is checked with the provider directly at submission.

**When the provider is down:**
- The form keeps working from the last copy. Once that copy is older than the freshness limit, the form says so.
- An application is accepted only if its parish was confirmed. If it can't be checked, the review page tells the applicant their parish couldn't be confirmed just now and nothing was sent; their answers stay saved for another try. Nothing is stored unconfirmed.
- A failed sync changes nothing. Settings shows the problem and how many checks have failed in a row.
- **Check now** (Settings, for directory managers) or `node server-dist/directory.js sync` tries again at once.

| Problem shown | What to do |
|---|---|
| The key was refused | The key is wrong, revoked or for the other environment: run the script again with the right one |
| The key doesn't cover the whole directory | Ask the provider for `org:sync` and `org:payload` |
| Too many requests / didn't answer / couldn't be reached | Usually passes by itself. The server retries within limits and honours the provider's `Retry-After` |
| A release arrived incomplete / the releases don't lead back to a base release / unexpected answer | Nothing was applied: tell the registry team, with the release shown |
| The result wouldn't be consistent | Nothing was changed: send the latest issues to the registry team |

**Maintenance:**
- **Replacing a key:** run the script again with the new key, restart the app and worker, then revoke the old key with the provider.
- **Moving a staging server from sandbox to production:** set the production key. The production entries are built alongside the sandbox ones, and the form then offers only the production entries.
- **Switching the API off:** remove both lines from `.env` and restart. The form then asks for the parish's name. The copy stays as the API left it, and imports and staff corrections stay closed, because its entries are the API's.
- **Rebuilding the copy:** `node server-dist/directory.js sync --force` rebuilds it from the releases kept here, even when nothing is new.

### Database roles

Compose's Postgres image makes `POSTGRES_USER` a superuser, and the app and worker connect as it. Bare metal is better (the `sop` role owns the database but isn't a superuser), but can still rewrite any table, including the audit history. Planned ([06, 7.13](06-Implementation-Plan.md#phase-7-hardening--launch-in-progress)), not yet in the scripts: an owner role (not a superuser) that runs the migrations, a separate app role with data access only (`select, insert, update, delete`) for the app and worker (`RUN_MIGRATIONS=false`), and `revoke update, delete, truncate on audit_events` from the app role. Plan it with a restore test, since it changes how updates run.

### Rotating secrets

| Secret | How | Consequences |
|---|---|---|
| `POSTGRES_PASSWORD` | `alter role sop password '…'` in psql, update `.env`, `docker compose up -d` | None for users |
| SMTP credentials | Update `SMTP_URL`, restart | None |
| `DIRECTORY_API_KEY` | `./deploy/directory-key.sh production`, restart the app and worker, then revoke the old key with the provider ([RCCG directory API](#rccg-directory-api)) | None: the copy stays in use while you change it |
| VAPID keys | Only if the private key leaked: `push-keys.js`, update `.env`, restart | Devices must re-subscribe: the app does it automatically for people who open it again with permission granted; others stop receiving |
| `EDGE_PROXY_SECRET` | New value in the Vercel project and in the VPS's `.env`, redeploy Vercel, restart the app | None. Rotate it if a Vercel build from before 2026-09-30 ever ran with `API_ORIGIN` and the secret set (its middleware could be made to send the secret to another host) |
| `APP_SECRET` | Only if leaked (or the server was compromised): new value in `.env`, restart, then as below | Everyone is signed out (CSRF tokens change). Staff authenticator secrets and push subscriptions encrypted with the old key can't be read: reset two-step verification for every staff member (`admin.js reset-mfa --email …` or Staff page) and run `update push_subscriptions set status = 'revoked', deactivated_at = now(), deactivated_reason = 'rejected' where status = 'active';` so devices show "turn on again" |
| A staff member's password | They change it under **Your security** (other sessions are signed out) |

### Incident response

1. **Contain:** suspend the affected staff account (**Staff → Suspend**, which also signs them out everywhere) or all sessions (`update staff_sessions set revoked_at = now() where revoked_at is null;`). If the server is compromised, take it offline (`docker compose stop app worker`).
2. **Assess:** **Audit history** (exports, views of applicant records, publications, sends, role changes, settings), `docker compose logs app` (request metadata only, no bodies).
3. **Rotate** anything that may have leaked (table above) and restore from a clean backup if data was altered.
4. **Notify:** follow your obligations under the Nigeria Data Protection Act 2023 (the regulator expects prompt breach notification) and tell affected applicants where required. Record what happened and what changed.

### Service worker rollback

If a release's service worker misbehaves (e.g. serves a broken page offline):

1. **Normal fix:** deploy a corrected release. Browsers fetch `sw.js` without caching and offer the update.
2. **Emergency kill switch:** `SW_KILL_SWITCH=1 docker compose up -d --build` (website on Vercel: the variable in Vercel's settings, then redeploy). That release's page removes any service worker registration, and its `sw.js` deletes every School of Purpose cache and unregisters itself on the next update check (at the latest when the site is next opened). The site keeps working without offline support.
3. After a few days (once people have opened the site), deploy a normal build again (`SW_KILL_SWITCH=` empty) to restore offline support.

Never serve `sw.js` with long cache headers; the app sends `Cache-Control: no-cache` for it (and for `index.html`, the manifest and `offline.html`).

### Staging and device testing

Physical-device testing (iPhone/iPad Home Screen install and push, Android Chrome and Samsung Internet install and push) **needs a trusted HTTPS origin reachable from the phone**. `127.0.0.1`/`localhost` on your computer isn't reachable from a phone, and service workers, install and push require a valid certificate.

1. Add a DNS record such as `staging.apply.yourchurch.org` → the VPS.
2. Run a second Compose project with its own `.env` (its own `DOMAIN`, `POSTGRES_PASSWORD`, `APP_SECRET`, **separate VAPID keys**, test email provider or sandbox) and its own volumes: `docker compose -p sop-staging --env-file .env.staging up -d --build`. Caddy needs one site block per domain (run staging's Caddy on the same instance by adding a second site to `deploy/Caddyfile`, or put staging on a separate small VPS).
3. **Never use real applicants' data on staging** and never send test notifications to real applicants: register your own devices as test devices.
4. Device checklist (record the device, OS and browser versions):

| Device | Check |
|---|---|
| iPhone/iPad, iOS/iPadOS 16.4+ | Safari → Share (iOS 26: ••• → Share) → Add to Home Screen, Open as Web App on; opens full screen; **Enable notifications** in the app → Allow; admin test send arrives; tapping opens the right page; offline: public pages load, account pages show the offline page |
| iPhone in Safari (not installed) | Notification card says to add to Home Screen first; `/install` shows the Safari steps |
| Android, Chrome | Install prompt from `/install`; notifications in the browser and in the installed app; test send arrives; lock-screen text is neutral for application updates |
| Android, Samsung Internet | Add page to → Home screen; notifications |
| Mac, Safari 17+ | File → Add to Dock; notifications in Safari |
| Windows, Edge / Chrome | App available → Install; notifications |
| Any, Firefox | No install on desktop (page says so); notifications work |
| Instagram/Facebook in-app browser | `/install` shows "open in your browser" and Copy link |

### Handling a deletion request

- **Account:** **Admin → Accounts → the account → Delete account** (type the email). The person can also do it themselves under **Account → Settings**. Applications stay, unlinked.
- **Application:** **Admin → Applicants → the application → Delete application** (type the reference). Notes and history go with it.
- Remove the person from any exported spreadsheets; backups age out after 14 days on the server, with Docker or bare metal (off-server copies per your retention policy).

### Monitoring

- `GET /api/health` → 200 when the app and database are up (503 otherwise). Point an uptime monitor at it.
- **Settings → Integrations and health**: database, email, push, worker heartbeat, queue, release id. No secrets are shown.
- Logs: `docker compose logs -f app worker` (JSON; API request metadata only, never bodies) or `journalctl -u school-of-purpose`.

---

## Production checklist

- [ ] DNS points at the VPS; `https://DOMAIN` loads with a valid certificate (and `https://www.DOMAIN` redirects to it, if `www` has a DNS record)
- [ ] `.env` has strong `POSTGRES_PASSWORD` and `APP_SECRET`, is `chmod 600`, and is backed up securely off the server
- [ ] `/api/health` returns `ok`; `docker compose ps` shows the worker running
- [ ] First owner created, two-step verification set up, recovery codes stored safely; a second owner invited
- [ ] Email configured and a sign-in link received (or accounts intentionally left off)
- [ ] VAPID keys generated once, backed up, and a test notification received on a staff test device (or push intentionally left off)
- [ ] A test application submitted, found in **Applicants**, and deleted
- [ ] Nightly backup cron installed, a restore tested, **and** encrypted off-server copies arranged
- [ ] The server runs with `NODE_ENV=production` (Compose, the Dockerfile and the systemd unit set it)
- [ ] Base images and host packages updated regularly (§A8; each automatic release pulls fresh base images)
- [ ] [Automatic deployment](#automatic-deployment-github-actions) set up and tried with a manual run, and `main` [protected](#protecting-main)
- [ ] Firewall allows only 22/80/443
- [ ] Privacy notice, consent wording and retention periods agreed by the Programme team ([01-PRD §8](01-PRD.md#8-open-questions))
- [ ] Device checks done on staging (above)
- [ ] Uptime monitor on `/api/health`
