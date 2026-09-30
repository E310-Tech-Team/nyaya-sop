/**
 * deploy/ci-deploy.sh releases a commit on the production server, as root: it is the only command
 * the GitHub Actions deploy key can run (docs/DEPLOYMENT.md, "Automatic deployment"). These tests
 * run the real script against throwaway git repositories, with stand-ins for docker, flock, id and
 * deploy/install.sh, to pin what it accepts and refuses, and that it survives replacing itself.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = readFileSync(new URL('../deploy/ci-deploy.sh', import.meta.url), 'utf8');

const lines = (...text: string[]) => `${text.join('\n')}\n`;

/** Stand-ins found on PATH before the real commands. They answer from files in $STUB_STATE. */
const STUBS: Record<string, string> = {
  docker: lines(
    '#!/usr/bin/env bash',
    '# docker: what ci-deploy.sh asks about the Compose services.',
    'set -euo pipefail',
    's="$STUB_STATE"',
    'last=""',
    'for last in "$@"; do :; done',
    'case "$1 ${2:-}" in',
    '  "compose ps") cat "$s/containers/$last" 2> /dev/null || true ;;',
    '  "compose exec")',
    '    case "$4" in',
    '      app)',
    '        [ -f "$s/app-release" ] || exit 1',
    '        printf \'{"accounts":{"enabled":true},"buildId":"%s","parishDirectory":{"enabled":false}}\' "$(cat "$s/app-release")" ;;',
    '      worker) cat "$s/worker-release" ;;',
    '      db) cat > "$s/sql"; cat "$s/heartbeat" 2> /dev/null || date +%s ;;',
    '      *) exit 1 ;;',
    '    esac ;;',
    '  "inspect -f")',
    '    case "$last" in app-*) echo "running healthy" ;; worker-*) echo "running 0" ;; *) exit 1 ;; esac ;;',
    '  *) echo "docker stand-in: unexpected call: $*" >&2; exit 1 ;;',
    'esac',
  ),
  flock: lines('#!/bin/sh', '# flock: the lock is free unless lock-busy exists.', '[ ! -e "$STUB_STATE/lock-busy" ]'),
  id: lines('#!/bin/sh', '# id: the release runs as root.', 'if [ "$1" = -u ]; then echo 0; else exec /usr/bin/id "$@"; fi'),
};

/** deploy/install.sh's stand-in: records the run, then "starts" containers for the commit checked out. */
const INSTALL = lines(
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'cd "$(dirname "$0")/.."',
  's="$STUB_STATE"',
  'echo "$(git rev-parse HEAD) lock=${SOP_RELEASE_LOCK_HELD:-none}" >> "$s/installs"',
  'echo "==> install.sh stand-in at $(git rev-parse --short HEAD)"',
  // About 1 MB at once, like a Docker build: far more than a pipe holds.
  'if [ -f "$s/noisy" ]; then seq 1 40000 | sed "s/^/build output line /"; fi',
  'if [ -f "$s/install-fails" ]; then echo "Error: the stand-in failed"; exit 1; fi',
  // Rewrites the running script in place (same file, new contents), as an editor or a careless copy would.
  'if [ -f "$s/rewrite-script" ]; then cat "$s/rewrite-script" > deploy/ci-deploy.sh; fi',
  'release="$(git rev-parse --short HEAD)"',
  'if [ ! -f "$s/app-stays" ]; then echo "$release" > "$s/app-release"; echo "app-$release" > "$s/containers/app"; fi',
  'if [ -f "$s/no-worker" ]; then rm -f "$s/containers/worker"; else echo "$release" > "$s/worker-release"; echo "worker-$release" > "$s/containers/worker"; fi',
);

const FLAGS = ['lock-busy', 'install-fails', 'rewrite-script', 'app-stays', 'no-worker', 'heartbeat', 'noisy', 'installs', 'sql'];

let root: string;
let work: string;
let server: string;
let state: string;
let env: NodeJS.ProcessEnv;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const head = () => git(server, 'rev-parse', 'HEAD');
const installs = () => (existsSync(join(state, 'installs')) ? readFileSync(join(state, 'installs'), 'utf8').trim().split('\n') : []);

/** A new commit on GitHub's main (the bare repository), optionally with other files. */
function commitToMain(message: string, files: Record<string, string> = {}): string {
  writeFileSync(join(work, 'README.md'), `${message}\n`);
  for (const [path, text] of Object.entries(files)) writeFileSync(join(work, path), text, { mode: 0o755 });
  git(work, 'add', '--all');
  git(work, 'commit', '--quiet', '-m', message);
  git(work, 'push', '--quiet', 'origin', 'HEAD:refs/heads/main');
  return git(work, 'rev-parse', 'HEAD');
}

/** Runs the server's copy of the script, as its forced command does. */
function release(args: string[], extra: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(join(server, 'deploy/ci-deploy.sh'), args, {
    env: { ...env, ...extra },
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'sop-ci-deploy-'));
  const bin = join(root, 'bin');
  state = join(root, 'state');
  mkdirSync(bin);
  mkdirSync(join(state, 'containers'), { recursive: true });
  for (const [name, text] of Object.entries(STUBS)) writeFileSync(join(bin, name), text, { mode: 0o755 });
  env = {
    PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: root,
    LC_ALL: 'C',
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    // Nothing from the developer's git settings, and git never looks above the fixture.
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: root,
    GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.org',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.org',
    STUB_STATE: state,
    SOP_DEPLOY_LOCK: join(root, 'release.lock'),
  };

  const origin = join(root, 'origin.git');
  work = join(root, 'work');
  server = join(root, 'server');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(root, 'init', '--quiet', '--initial-branch=main', work);
  git(work, 'remote', 'add', 'origin', origin);
  mkdirSync(join(work, 'deploy'));
  writeFileSync(join(work, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(work, '.gitignore'), 'logs/\n');
  commitToMain('First release', { 'deploy/install.sh': INSTALL, 'deploy/ci-deploy.sh': SCRIPT });
  git(root, 'clone', '--quiet', origin, server);

  // The server runs the first release.
  const running = git(server, 'rev-parse', '--short', 'HEAD');
  writeFileSync(join(state, 'app-release'), `${running}\n`);
  writeFileSync(join(state, 'worker-release'), `${running}\n`);
  for (const [service, id] of Object.entries({ app: 'app-first', worker: 'worker-first', db: 'db-1', caddy: 'caddy-1' })) {
    writeFileSync(join(state, 'containers', service), `${id}\n`);
  }
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  for (const flag of FLAGS) rmSync(join(state, flag), { force: true });
});

describe('deploy/ci-deploy.sh', () => {
  it('accepts only "deploy <full lowercase commit>", as one argument, and changes nothing otherwise', () => {
    const sha = head();
    const refused = [
      [],
      [''],
      ['deploy'],
      [sha],
      [`release ${sha}`],
      [`deploy ${sha.slice(0, 7)}`],
      [`deploy ${sha.toUpperCase()}`],
      [`deploy ${sha} `],
      [`deploy ${sha}\n`],
      [`deploy  ${sha}`],
      [`deploy ${sha}; touch pwned`],
      [`deploy ${sha}\ntouch pwned`],
      ['deploy', sha],
      [`deploy ${sha}`, 'extra'],
    ];
    for (const args of refused) {
      const { status, output } = release(args);
      expect(status, JSON.stringify(args)).toBe(2);
      expect(output).toContain('Expected one argument: "deploy <full 40-character commit on main>". Nothing was changed.');
    }
    // It stopped before its log, the lock, git or the installer.
    expect(existsSync(join(server, 'logs'))).toBe(false);
    expect(existsSync(join(root, 'release.lock'))).toBe(false);
    expect(existsSync(join(server, 'pwned'))).toBe(false);
    expect(head()).toBe(sha);
    expect(installs()).toEqual([]);
  });

  it('reads the request from SSH_ORIGINAL_COMMAND only when it has no argument', () => {
    const notOnMain = git(server, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Only on the server');
    expect(release([], { SSH_ORIGINAL_COMMAND: 'rm -rf /' }).status).toBe(2);
    expect(release(['deploy nothing'], { SSH_ORIGINAL_COMMAND: `deploy ${notOnMain}` }).status).toBe(2);
    const { status, output } = release([], { SSH_ORIGINAL_COMMAND: `deploy ${notOnMain}` });
    expect(status).toBe(1);
    expect(output).toContain(`${notOnMain} is not on GitHub's main`);
  });

  it("refuses a commit that isn't on GitHub's main", () => {
    const before = head();
    git(work, 'checkout', '--quiet', '-b', 'feature');
    writeFileSync(join(work, 'README.md'), 'Not merged\n');
    git(work, 'commit', '--quiet', '-am', 'Not merged');
    git(work, 'push', '--quiet', 'origin', 'feature');
    const branchOnly = git(work, 'rev-parse', 'HEAD');
    git(work, 'checkout', '--quiet', 'main');
    git(server, 'fetch', '--quiet', 'origin', 'feature'); // present on the server, still not on main
    const localOnly = git(server, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'Only on the server');

    for (const sha of [branchOnly, localOnly, 'f'.repeat(40)]) {
      const { status, output } = release([`deploy ${sha}`]);
      expect(status).toBe(1);
      expect(output).toContain(`Error: ${sha} is not on GitHub's main: only commits already on main are released.`);
      expect(output).toContain('Nothing was changed.');
    }
    expect(head()).toBe(before);
    expect(installs()).toEqual([]);
  });

  it('refuses local changes to tracked files, and local commits on main', () => {
    const before = head();
    const next = commitToMain('Next release');

    writeFileSync(join(server, 'README.md'), 'Edited on the server\n');
    let result = release([`deploy ${next}`]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('Tracked files have local changes on this server');
    expect(result.output).toContain('README.md');
    expect(readFileSync(join(server, 'README.md'), 'utf8')).toBe('Edited on the server\n');
    git(server, 'checkout', '--', 'README.md');

    git(server, 'commit', '--quiet', '--allow-empty', '-m', 'Committed on the server');
    result = release([`deploy ${next}`]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("This server's branch main has commits that aren't on GitHub's main");
    git(server, 'reset', '--quiet', '--hard', before);

    expect(head()).toBe(before);
    expect(installs()).toEqual([]);
  });

  it('gives up when another release keeps the lock', () => {
    const before = head();
    writeFileSync(join(state, 'lock-busy'), '');
    const { status, output } = release([`deploy ${git(work, 'rev-parse', 'HEAD')}`]);
    expect(status).toBe(1);
    expect(output).toContain('Another release is running: waiting for it to finish');
    expect(output).toContain('Error: Another release was still running after 20 minutes.');
    expect(head()).toBe(before);
    expect(installs()).toEqual([]);
  });

  it('releases a commit of main and checks the app and worker run it', () => {
    const previous = head();
    const sha = commitToMain('Add the new page');
    writeFileSync(join(state, 'noisy'), '');
    const { status, output } = release([`deploy ${sha}`]);
    expect(status, output.slice(-2000)).toBe(0);
    expect(output).toContain('build output line 40000\n');

    // On branch main at that commit, still following GitHub's main, nothing modified.
    expect(head()).toBe(sha);
    expect(git(server, 'symbolic-ref', 'HEAD')).toBe('refs/heads/main');
    expect(git(server, 'rev-parse', '--abbrev-ref', 'main@{upstream}')).toBe('origin/main');
    expect(git(server, 'status', '--porcelain')).toBe('');
    // install.sh ran once, on that commit, knowing the lock is held.
    expect(installs()).toEqual([`${sha} lock=1`]);

    const id = sha.slice(0, 7);
    expect(output).toContain(`Running now: release ${previous.slice(0, 7)}, commit ${previous}`);
    expect(output).toContain(`New commits:\n${id} Add the new page`);
    expect(output).toContain(`==> Released ${sha}`);
    expect(output).toContain(`Previous:  ${previous}`);
    expect(output).toMatch(new RegExp(`App: {7}recreated \\(website \\+ API\\), healthy, release ${id}`));
    expect(output).toMatch(new RegExp(`Worker: {4}recreated, release ${id}, heartbeat \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d UTC`));
    expect(output).toContain('Postgres:  unchanged');
    expect(output).toContain('Caddy:     unchanged');
    expect(output).toContain(`deploy ${previous}`); // the way back

    // The heartbeat is only read.
    const sql = readFileSync(join(state, 'sql'), 'utf8');
    expect(sql).toMatch(/^select .* from app_settings where key = 'heartbeat_worker';\n$/);

    // The whole output is kept on the server, private (one log per run).
    const logs = join(server, 'logs/deploy');
    const mine = readdirSync(logs).filter((name) => name.endsWith(`-${sha.slice(0, 12)}.log`));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{12}\.log$/);
    expect(statSync(logs).mode & 0o777).toBe(0o700);
    expect(statSync(join(logs, mine[0]!)).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(logs, mine[0]!), 'utf8')).toBe(output);
  });

  it('releases a commit that replaces this script', () => {
    const replaced = SCRIPT.replace('#!/usr/bin/env bash\n', `#!/usr/bin/env bash\n${'# A longer header moves every line.\n'.repeat(40)}`);
    const sha = commitToMain('Change the release script', { 'deploy/ci-deploy.sh': replaced });
    const { status, output } = release([`deploy ${sha}`]);
    expect(status, output).toBe(0);
    expect(output).toContain(`==> Released ${sha}`);
    expect(readFileSync(join(server, 'deploy/ci-deploy.sh'), 'utf8')).toBe(replaced);
  });

  it('finishes normally when its file is rewritten in place during the release', () => {
    // Without the main "$@"; exit $? pattern bash would read on into these lines.
    const running = readFileSync(join(server, 'deploy/ci-deploy.sh'), 'utf8');
    writeFileSync(join(state, 'rewrite-script'), 'echo INJECTED; exit 99\n'.repeat(Math.ceil((2 * running.length) / 23)));
    const sha = commitToMain('Another release');
    const { status, output } = release([`deploy ${sha}`]);
    expect(status, output).toBe(0);
    expect(output).toContain(`==> Released ${sha}`);
    expect(output).not.toContain('INJECTED');
    git(server, 'checkout', '--', 'deploy/ci-deploy.sh');
  });

  it('says what is left and how to go back when install.sh fails', () => {
    const previous = head();
    const sha = commitToMain('A release whose install fails');
    writeFileSync(join(state, 'install-fails'), '');
    const { status, output } = release([`deploy ${sha}`]);
    expect(status).toBe(1);
    expect(output).toContain('Error: deploy/install.sh stopped with exit status 1 (above).');
    expect(output).toContain(`The checkout is at ${sha}, but deploy/install.sh didn't finish`);
    expect(output).toContain(`with sha ${previous},`);
    expect(output).toContain(`./deploy/ci-deploy.sh "deploy ${previous}"`);
    expect(head()).toBe(sha);
  });

  it("fails when the app doesn't serve the new release, or the worker doesn't run it", () => {
    let sha = commitToMain('A release the app never starts');
    writeFileSync(join(state, 'app-stays'), '');
    let result = release([`deploy ${sha}`]);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/Error: The app reports release "[0-9a-f]{7}", not [0-9a-f]{40}\./);
    expect(result.output).toContain("This release is installed, but it didn't pass its checks.");
    rmSync(join(state, 'app-stays'));

    sha = commitToMain('A release without a worker');
    writeFileSync(join(state, 'no-worker'), '');
    result = release([`deploy ${sha}`]);
    expect(result.status).toBe(1);
    expect(result.output).toContain("Error: The worker isn't running.");
    rmSync(join(state, 'no-worker'));

    sha = commitToMain('A release whose worker never writes a heartbeat');
    writeFileSync(join(state, 'heartbeat'), '1700000000\n');
    result = release([`deploy ${sha}`], { SOP_DEPLOY_WORKER_WAIT: '1' });
    expect(result.status).toBe(1);
    expect(result.output).toContain("Error: The worker hasn't written a heartbeat in the 1 seconds since the release.");
  });
});
