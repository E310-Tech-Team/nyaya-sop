#!/usr/bin/env bash
# Releases one commit of main on this server and checks that it runs. This is the only command the
# GitHub Actions deploy key can run (docs/DEPLOYMENT.md, "Automatic deployment"): the key's forced
# command hands over the requested command as one argument, through a single sudo rule:
#
#   sudo -n /opt/school-of-purpose/deploy/ci-deploy.sh "deploy <full 40-character commit>"
#
# Root can run it the same way (or with the request in SSH_ORIGINAL_COMMAND), for example to
# release by hand when GitHub Actions can't:
#
#   cd /opt/school-of-purpose && git fetch origin main && ./deploy/ci-deploy.sh "deploy $(git rev-parse origin/main)"
#
# One release at a time: it waits for one that is already running (deploy/install.sh takes the
# same lock). It refuses a commit that isn't on GitHub's main, local changes to tracked files and
# local commits. It checks the commit out on branch main, runs deploy/install.sh (which backs up
# the database first and stops if that fails), then checks that the app is healthy and serves this
# release, and that the worker runs it and has written a heartbeat since. Anything else: exit 1.
#
# The release writes only to logs/deploy/<time>-<commit>.log (kept 90 days), which is streamed to
# the caller, so a dropped connection or a cancelled workflow can't stop it halfway. GitHub Actions
# logs are public: it never prints secrets, .env or the app's log (it can hold visitors' addresses).
set -euo pipefail

LOCK_WAIT=1200 # seconds to wait for a release that is already running
LOG_DAYS=90

SHA="" PREVIOUS="" STAGE="" REPORTED=""

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }

usage() {
  echo 'Expected one argument: "deploy <full 40-character commit on main>". Nothing was changed.' >&2
  exit 2
}

rollback_hint() {
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$SHA" ]; then
    say "To roll back: GitHub > Actions > CI > Run workflow (branch main) with sha $PREVIOUS,"
    say "or here, as root: ./deploy/ci-deploy.sh \"deploy $PREVIOUS\""
  fi
}

# What a release that stopped leaves behind, and the way back.
outcome() {
  case "$STAGE" in
    "") say "Nothing was changed." ;;
    checked-out)
      say "The checkout is at $SHA, but deploy/install.sh didn't finish: the site may still run the"
      say "release before it (${PREVIOUS:-unknown}), or only part of this one."
      rollback_hint
      ;;
    installed)
      say "This release is installed, but it didn't pass its checks."
      rollback_hint
      ;;
  esac
}

fail() {
  REPORTED=yes
  printf '\nError: %s\n' "$*"
  outcome
  exit 1
}

on_exit() {
  local status=$?
  if [ "$status" -ne 0 ] && [ -z "$REPORTED" ]; then
    printf '\nError: the release stopped unexpectedly (exit status %s).\n' "$status"
    outcome
  fi
}

# Streams the log to the caller until the release (process $1) has ended. Only this copy writes to
# the caller: when the connection drops, the release carries on and its log stays complete. One
# open descriptor keeps the place: each cat prints what was added since the last one.
follow() {
  local pid="$1" alive
  exec 3< "$2"
  while :; do
    alive=yes
    kill -0 "$pid" 2> /dev/null || alive=no
    cat <&3
    [ "$alive" = yes ] || return 0
    sleep 1
  done
}

# The container running a service of docker-compose.yml, or nothing.
container() { docker compose ps -q "$1" 2> /dev/null | head -n 1 || true; }

# One service=container line per service, to tell afterwards which ones were replaced.
containers() {
  local service
  for service in app worker db caddy; do printf '%s=%s\n' "$service" "$(container "$service")"; done
}

# What happened to service $1 between two containers() lists.
change() {
  local before after
  before="$(printf '%s\n' "$2" | sed -n "s/^$1=//p")"
  after="$(printf '%s\n' "$3" | sed -n "s/^$1=//p")"
  if [ -z "$after" ]; then
    echo "not running"
  elif [ -z "$before" ]; then
    echo "started"
  elif [ "$before" = "$after" ]; then
    echo "unchanged"
  else
    echo "recreated"
  fi
}

# The release id the running app reports at /api/config, or nothing.
app_release() {
  docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/config 2> /dev/null \
    | sed -n 's/.*"buildId":"\([A-Za-z0-9._-]\{1,64\}\)".*/\1/p' || true
}

# The full commit that release id $1 (an abbreviated commit) stands for, or nothing.
commit_of() {
  local pattern='^[0-9a-f]{7,40}$'
  if [[ ${1:-} =~ $pattern ]]; then git rev-parse --verify --quiet "$1^{commit}" 2> /dev/null || true; fi
}

# Is release id $1 this release: an abbreviation of $SHA, at least 7 characters long?
is_this_release() { [ "${#1}" -ge 7 ] && [ "${SHA#"$1"}" != "$SHA" ]; }

# When the worker last wrote its heartbeat (Unix time), as Settings > Integrations and health reads
# it. Read-only; psql runs inside the database container with that container's own settings.
heartbeat() {
  docker compose exec -T db sh -c 'psql -X -q -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' 2> /dev/null <<'SQL' | tr -dc '0-9' || true
select floor(extract(epoch from (value #>> '{}')::timestamptz))::bigint from app_settings where key = 'heartbeat_worker';
SQL
}

utc() { date -u -d "@$1" '+%Y-%m-%d %H:%M:%S UTC' 2> /dev/null || date -u -r "$1" '+%Y-%m-%d %H:%M:%S UTC'; }

main() {
  export LC_ALL=C
  [ "$#" -le 1 ] || usage
  local request="${1-${SSH_ORIGINAL_COMMAND-}}" pattern='^deploy ([0-9a-f]{40})$'
  [[ $request =~ $pattern ]] || usage
  SHA="${BASH_REMATCH[1]}"
  [ "$(id -u)" -eq 0 ] || { echo "Run this as root (through its sudo rule)." >&2; exit 1; }

  local worker_wait="${SOP_DEPLOY_WORKER_WAIT:-150}" # seconds for a new heartbeat (one every 30 s)
  case "$worker_wait" in "" | *[!0-9]*) worker_wait=150 ;; esac

  local dir
  dir="$(cd "$(dirname "$0")/.." && pwd -P)"
  cd "$dir"
  [ -f docker-compose.yml ] && [ -f deploy/install.sh ] || { echo "$dir isn't the School of Purpose checkout." >&2; exit 1; }

  # From here on everything goes to the log only, and follow() copies it to the caller.
  local logs="$dir/logs/deploy" log
  mkdir -p "$logs"
  chmod 700 "$dir/logs" "$logs"
  find "$logs" -type f -name '*.log' -mtime +"$LOG_DAYS" -delete 2> /dev/null || true
  log="$logs/$(date -u +%Y%m%dT%H%M%SZ)-${SHA:0:12}.log"
  (umask 077 && : >> "$log")
  follow "$$" "$log" 2> /dev/null &
  exec >> "$log" 2>&1 < /dev/null
  trap on_exit EXIT
  trap '' HUP # run by hand, a dropped terminal doesn't stop the release either

  local lock="${SOP_DEPLOY_LOCK:-/run/lock/sop-deploy.lock}"
  mkdir -p "$(dirname "$lock")"
  exec 9>> "$lock"
  if ! flock -n 9; then
    say "Another release is running: waiting for it to finish (at most $((LOCK_WAIT / 60)) minutes)."
    flock -w "$LOCK_WAIT" 9 || fail "Another release was still running after $((LOCK_WAIT / 60)) minutes."
  fi
  export SOP_RELEASE_LOCK_HELD=1 # deploy/install.sh: the caller holds the release lock

  local started
  started="$(date +%s)"
  step "Releasing $SHA ($(utc "$started"))"

  git rev-parse --git-dir > /dev/null 2>&1 || fail "$dir isn't a git checkout."
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    fail "Tracked files have local changes on this server (above). Put the change through a pull request or undo it (git checkout -- <file>), then release again."
  fi
  say "Fetching main from GitHub"
  git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 fetch --quiet --no-tags origin refs/heads/main:refs/remotes/origin/main \
    || fail "Couldn't fetch main from GitHub (above)."
  { git cat-file -e "$SHA^{commit}" 2> /dev/null && git merge-base --is-ancestor "$SHA" refs/remotes/origin/main; } \
    || fail "$SHA is not on GitHub's main: only commits already on main are released."
  if git rev-parse --verify --quiet refs/heads/main > /dev/null \
    && ! git merge-base --is-ancestor refs/heads/main refs/remotes/origin/main; then
    fail "This server's branch main has commits that aren't on GitHub's main. Put them through a pull request, then release again."
  fi

  # The release running now: the rollback target.
  local running
  running="$(app_release)"
  PREVIOUS="$(commit_of "$running")"
  [ -n "$PREVIOUS" ] || PREVIOUS="$(git rev-parse --verify --quiet HEAD || true)"
  say "Running now: release ${running:-unknown}, commit ${PREVIOUS:-unknown}"
  if [ -n "$PREVIOUS" ] && [ "$PREVIOUS" != "$SHA" ]; then
    if git merge-base --is-ancestor "$PREVIOUS" "$SHA" 2> /dev/null; then
      say "New commits:"
      git log --oneline --no-decorate -20 "$PREVIOUS..$SHA"
    elif git merge-base --is-ancestor "$SHA" "$PREVIOUS" 2> /dev/null; then
      say "This commit is older than the running release: it rolls back"
      git log --oneline --no-decorate -20 "$SHA..$PREVIOUS"
    fi
  fi
  local before
  before="$(containers)"

  step "Checking out $SHA on branch main"
  git checkout --quiet -B main "$SHA" || fail "git couldn't check out $SHA (above)."
  STAGE=checked-out
  git log -1 --format='%h %s'

  step "Running deploy/install.sh: database backup, build and restart (a few minutes)"
  local status=0
  ./deploy/install.sh || status=$?
  [ "$status" -eq 0 ] || fail "deploy/install.sh stopped with exit status $status (above)."
  STAGE=installed
  local installed
  installed="$(date +%s)"

  step "Checking the release"
  local app app_state release
  app="$(container app)"
  [ -n "$app" ] || fail "The app isn't running."
  app_state="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$app" 2> /dev/null || true)"
  [ "$app_state" = "running healthy" ] || fail "The app is \"$app_state\", not running and healthy."
  release="$(app_release)"
  is_this_release "$release" || fail "The app reports release \"${release:-nothing}\", not $SHA."
  say "App: running and healthy, release $release"

  local worker worker_state worker_release beat="" epoch='^[0-9]{9,11}$'
  worker="$(container worker)"
  [ -n "$worker" ] || fail "The worker isn't running."
  worker_state="$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$worker" 2> /dev/null || true)"
  [ "${worker_state%% *}" = running ] || fail "The worker is \"${worker_state%% *}\", not running."
  worker_release="$(docker compose exec -T worker cat dist/build-id.txt 2> /dev/null | tr -dc 'A-Za-z0-9._-' || true)"
  [ "$worker_release" = "$release" ] || fail "The worker runs release \"${worker_release:-unknown}\", not $release."
  say "Worker: running release $worker_release; waiting for its next heartbeat (one every 30 seconds)"
  # Written after install.sh finished, so by the worker this release started (or kept running).
  while :; do
    beat="$(heartbeat)"
    if [[ $beat =~ $epoch ]] && [ "$beat" -ge "$installed" ]; then break; fi
    [ "$(date +%s)" -lt $((installed + worker_wait)) ] \
      || fail "The worker hasn't written a heartbeat in the $worker_wait seconds since the release."
    sleep 5
  done
  [ "$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$worker" 2> /dev/null || true)" = "$worker_state" ] \
    || fail "The worker restarted while it was being checked."

  local after took
  after="$(containers)"
  took=$(($(date +%s) - started))
  step "Released $SHA"
  say "Commit:    $(git log -1 --format='%H %s')"
  say "Previous:  ${PREVIOUS:-unknown}"
  say "App:       $(change app "$before" "$after") (website + API), healthy, release $release"
  say "Worker:    $(change worker "$before" "$after"), release $worker_release, heartbeat $(utc "$beat")"
  say "Postgres:  $(change db "$before" "$after")"
  say "Caddy:     $(change caddy "$before" "$after")"
  say "Took:      $((took / 60)) min $((took % 60)) s"
  say "Log:       $log"
  rollback_hint
}

# Bash reads a script while it runs it, and a release replaces this file. Everything above only
# sets variables and defines functions, and this last line is read whole before main starts, so
# the copy that is running can't change under it.
main "$@"; exit $?
