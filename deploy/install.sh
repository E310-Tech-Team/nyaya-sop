#!/usr/bin/env bash
# One-command install (and update) of School of Purpose on an Ubuntu/Debian VPS with Docker Compose:
# Caddy (automatic HTTPS) → app → Postgres, plus the background worker. docs/DEPLOYMENT.md has the details.
#
#   sudo ./deploy/install.sh --domain apply.example.org --email you@example.org --name "Your Name"
#
#   --domain  The site's address. Its DNS A record must point at this server. Defaults to this
#             server's hostname (a Hostinger VPS hostname such as srv123456.hstgr.cloud works).
#   --email   Your email: becomes the first owner of the admin area and the Web Push contact.
#   --name    Your name for the admin area (default "Site owner").
#   --skip-backup  Update even if the backup taken first fails (not recommended).
#
# Safe to run again (e.g. after `git pull`): it keeps .env and its secrets, backs up the database,
# pulls fresh base images, rebuilds, restarts, and applies database migrations automatically.
# It never prints secrets, or puts them on a command line.
set -euo pipefail
cd "$(dirname "$0")/.."

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33mWarning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

DOMAIN="" EMAIL="" NAME="Site owner" SKIP_BACKUP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --skip-backup) SKIP_BACKUP="yes"; shift ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done
[ "$(id -u)" -eq 0 ] || die "Run as root: sudo ./deploy/install.sh …"
[ -f docker-compose.yml ] && [ -f .env.example ] || die "Run this from inside the project folder."
if [ -n "$EMAIL" ] && ! printf '%s' "$EMAIL" | grep -Eq '^[^@ ]+@[^@ ]+\.[^@ ]+$'; then die "--email doesn't look like an email address."; fi

# Replaces KEY=… (or a commented "# KEY=…") in .env, or appends it. Values are never printed, and
# reach awk through its environment: a command-line argument would show in `ps` to every user,
# and awk -v would rewrite backslashes.
set_env() {
  local key="$1" value="$2" tmp
  case "$value" in *$'\n'* | *$'\r'*) die "The value for $key can't contain a line break." ;; esac
  tmp="$(umask 077 && mktemp ./.env.tmp.XXXXXX)" # beside .env: private, and git-ignored
  SET_ENV_VALUE="$value" awk -v k="$key" '
    !done && ($0 ~ "^" k "=" || $0 ~ "^# ?" k "=") { print k "=" ENVIRON["SET_ENV_VALUE"]; done = 1; next }
    { print }
    END { if (!done) print k "=" ENVIRON["SET_ENV_VALUE"] }' .env > "$tmp"
  cat "$tmp" > .env # keeps the file's permissions (600)
  rm -f "$tmp"
}
get_env() { sed -n "s/^$1=//p" .env | tail -n 1; }

# ── Server prerequisites ──────────────────────────────────────────────────────
if ! command -v docker > /dev/null 2>&1; then
  log "Installing Docker"
  command -v curl > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version > /dev/null 2>&1 || die "The Docker Compose plugin is missing (apt-get install docker-compose-plugin)."
systemctl enable --now docker > /dev/null 2>&1 || true
command -v openssl > /dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq openssl; }

# Building the site needs about 2 GB of memory; add swap on small servers.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ] && [ "$(awk '/SwapTotal/ {print $2}' /proc/meminfo)" -eq 0 ]; then
  log "Adding a 2 GB swap file (this server has less than 2 GB of memory)"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Only this site's Caddy may use ports 80 and 443.
if command -v ss > /dev/null 2>&1; then
  busy="$(ss -ltnpH '( sport = :80 or sport = :443 )' 2> /dev/null | grep -v docker-proxy || true)"
  [ -z "$busy" ] || die "Something else is using port 80 or 443 (e.g. Apache or Nginx). Stop or remove it first:
$busy"
fi
if command -v ufw > /dev/null 2>&1 && ufw status 2> /dev/null | grep -q 'Status: active'; then
  ufw allow OpenSSH > /dev/null && ufw allow 80,443/tcp > /dev/null && ufw allow 443/udp > /dev/null
fi

# ── Configuration (.env): secrets are generated here, on the server ─────────
if [ ! -f .env ]; then
  log "Creating .env with new secrets (it stays on this server; back it up privately)"
  umask 077
  cp .env.example .env
  chmod 600 .env
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env APP_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
  [ -n "$DOMAIN" ] || DOMAIN="$(hostname -f)"
  set_env DOMAIN "$DOMAIN"
elif [ -n "$DOMAIN" ]; then
  set_env DOMAIN "$DOMAIN"
fi
chmod go-rwx .env # a hand-made copy of .env.example may be readable by every user
[ "$(get_env POSTGRES_PASSWORD)" != change-me ] || warn "POSTGRES_PASSWORD is still the example value: change it (docs/DEPLOYMENT.md)."
DOMAIN="$(get_env DOMAIN)"
case "$DOMAIN" in "" | apply.example.org | *" "*) die "Set the site's address with --domain." ;; esac

# The HTTPS certificate is only issued once the domain points at this server.
resolved="$(getent ahostsv4 "$DOMAIN" 2> /dev/null | awk '{print $1}' | sort -u || true)"
local_ips=" $(hostname -I 2> /dev/null || true) "
matched=""
for ip in $resolved; do case "$local_ips" in *" $ip "*) matched="yes" ;; esac; done
[ -n "$matched" ] || warn "$DOMAIN doesn't resolve to this server yet (${resolved:-no DNS record}). Point its A record here; HTTPS starts working once it does."

# ── Build and start ───────────────────────────────────────────────────────────
if [ -n "$(docker compose ps -q db 2> /dev/null)" ]; then
  log "Backing up the database before updating"
  # An update can migrate the database: without a backup there's no way back.
  if ! ./deploy/backup.sh; then
    [ -n "$SKIP_BACKUP" ] || die "The backup failed, so nothing was changed. Fix the problem above, or run again with --skip-backup to update without a backup."
    warn "Backup failed; continuing because of --skip-backup."
  fi
fi
export BUILD_ID="$(git rev-parse --short HEAD 2> /dev/null || date -u +%Y%m%d%H%M)"
log "Building and starting (the first build takes a few minutes)"
# Fresh base images every time, so security fixes to Node, Postgres and Caddy reach this server.
docker compose pull --quiet --ignore-buildable
docker compose build --pull
docker compose up -d --remove-orphans

wait_healthy() {
  local status="starting" id
  for _ in $(seq 1 60); do
    id="$(docker compose ps -q app)"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$id" 2> /dev/null || echo starting)"
    [ "$status" = healthy ] && return 0
    sleep 5
  done
  docker compose logs --tail 40 app
  die "The app did not become healthy (see the log above)."
}
wait_healthy

# ── Web Push keys, generated once (keep them: new keys mean every device must re-enable) ──
if [ -z "$(get_env VAPID_PRIVATE_KEY)" ]; then
  log "Generating Web Push (VAPID) keys"
  keys="$(docker compose run --rm -T app node server-dist/push-keys.js)"
  set_env VAPID_PUBLIC_KEY "$(printf '%s\n' "$keys" | sed -n 's/^VAPID_PUBLIC_KEY=//p')"
  set_env VAPID_PRIVATE_KEY "$(printf '%s\n' "$keys" | sed -n 's/^VAPID_PRIVATE_KEY=//p')"
  set_env VAPID_SUBJECT "mailto:${EMAIL:-webmaster@$DOMAIN}"
  unset keys
  docker compose up -d app worker
  wait_healthy
fi

# ── First owner of the admin area ─────────────────────────────────────────────
if [ -n "$EMAIL" ] && docker compose exec -T app node server-dist/admin.js list | grep -q 'No staff accounts yet'; then
  log "Creating the first owner of the admin area"
  docker compose exec -T app node server-dist/admin.js create-owner --email "$EMAIL" --name "$NAME"
fi

# ── Nightly database backups at 02:30 ─────────────────────────────────────────
mkdir -p backups && chmod 700 backups
(crontab -l 2> /dev/null | grep -v 'deploy/backup.sh' || true; echo "30 2 * * * cd \"$(pwd)\" && ./deploy/backup.sh >> backups/backup.log 2>&1") | crontab -
docker image prune -f > /dev/null 2>&1 || true

# ── Summary ───────────────────────────────────────────────────────────────────
health=""
for _ in $(seq 1 12); do
  health="$(curl -fsS --max-time 5 "https://$DOMAIN/api/health" 2> /dev/null || true)"
  [ -n "$health" ] && break
  sleep 5
done
log "Done"
echo "Site:     https://$DOMAIN"
echo "Admin:    https://$DOMAIN/admin"
echo "Health:   ${health:-not reachable over HTTPS yet (check DNS, then re-check in a few minutes)}"
if [ -z "$(get_env SMTP_URL)" ]; then
  echo "Email:    not configured, so applicant sign-in by email is off. Add SMTP_URL and EMAIL_FROM to .env, then run this script again."
fi
echo "Backups:  nightly into $(pwd)/backups (copy them off the server too)."
echo "Keep a private copy of .env: it holds the secrets for the database, sign-in and push notifications."
