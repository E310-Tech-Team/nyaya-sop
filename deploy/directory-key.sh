#!/usr/bin/env bash
# Stores the RCCG directory API key in this server's .env without showing it (docs/DEPLOYMENT.md,
# "RCCG directory API"). Run it in the app folder, then restart the app and worker:
#
#   ./deploy/directory-key.sh production        # or: sandbox (a staging server, never the live site)
#   docker compose up -d app worker
#
# The key is read at a hidden prompt (or from standard input), never from the command line, so it
# stays out of shell history and the process list. The script sets DIRECTORY_API_ENV and
# DIRECTORY_API_KEY where .env has them (or their commented placeholders), adds them otherwise, and
# leaves every other line as it was. It never prints the key.
set -euo pipefail
export LC_ALL=C

die() { printf '%s\n' "$*" >&2; exit 1; }

if [ "$#" -ne 1 ] || { [ "$1" != production ] && [ "$1" != sandbox ]; }; then
  # Never echo the arguments: someone may have typed the key there.
  printf 'Usage: %s production|sandbox\nThe key is asked for at a hidden prompt: never put it on the command line.\n' "$0" >&2
  exit 2
fi
env_name="$1"
[ -f .env ] || die "No .env here: run this in the app folder (e.g. cd /opt/school-of-purpose)."

if [ -t 0 ]; then printf 'RCCG directory API %s key (nothing shows while you paste): ' "$env_name" >&2; fi
key=''
IFS= read -rs key || true
if [ -t 0 ]; then echo >&2; fi

[ -n "$key" ] || die "No key entered. Nothing was changed."
# The key as issued: 16 to 512 visible ASCII characters (the server checks the same). It is written
# in single quotes, which Docker Compose and Node both read literally, so a quote mark can't be in it.
# (The length is checked apart: BSD regex, as on macOS, allows no repeat count above 255.)
if [ "${#key}" -lt 16 ] || [ "${#key}" -gt 512 ] || ! [[ "$key" =~ ^[!-~]+$ ]]; then
  die "That doesn't look like an API key (16 to 512 characters, no spaces or line breaks). Nothing was changed."
fi
case "$key" in *"'"*) die "The key contains a quote mark, which this script can't store safely. Nothing was changed." ;; esac

# Replaces NAME=… (or the first commented "# NAME=…") in place and drops later copies, or appends it.
# The value reaches awk through its environment: an argument would show in `ps`.
set_setting() {
  local name="$1" tmp
  tmp="$(umask 077 && mktemp ./.env.tmp.XXXXXX)" # beside .env: private, and git-ignored
  SETTING_VALUE="$2" awk -v k="$name" '
    $0 ~ "^(export[ \t]+)?" k "[ \t]*=" { if (!done) print k "=" ENVIRON["SETTING_VALUE"]; done = 1; next }
    !done && $0 ~ "^#[ \t]*" k "[ \t]*=" { print k "=" ENVIRON["SETTING_VALUE"]; done = 1; next }
    { print }
    END { if (!done) print k "=" ENVIRON["SETTING_VALUE"] }' .env > "$tmp"
  cat "$tmp" > .env # keeps the file's owner and permissions
  rm -f "$tmp"
}

set_setting DIRECTORY_API_ENV "$env_name"
set_setting DIRECTORY_API_KEY "'$key'"
key=''
chmod go-rwx .env

echo "Saved the $env_name key in .env (not shown)."
echo "Next: docker compose up -d app worker   (the worker then fetches the directory straight away)"
echo "Then: docker compose exec app node server-dist/directory.js api-status"
