import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

// deploy/directory-key.sh stores the RCCG directory API key in a server's .env from a hidden prompt.
const SCRIPT = resolve('deploy/directory-key.sh');
// Characters Compose and dotenv parsers treat specially, to prove the value is stored literally.
const KEY = 'yaya_$HOME#x=1"`\\z0123456789';
const ENV = [
  'DOMAIN=nyayasop.org',
  'APP_SECRET=keep$this#one',
  '',
  '# ── RCCG directory API ──',
  '# DIRECTORY_API_ENV=production',
  '# DIRECTORY_API_KEY=',
  'LOG_LEVEL=info',
].join('\n');

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});

function folder(env: string | null = ENV) {
  const dir = mkdtempSync(join(tmpdir(), 'sop-directory-key-'));
  dirs.push(dir);
  if (env !== null) writeFileSync(join(dir, '.env'), `${env}\n`, { mode: 0o644 });
  return dir;
}

const run = (dir: string, args: string[], input: string) => {
  const result = spawnSync('bash', [SCRIPT, ...args], { cwd: dir, input, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
};

describe('deploy/directory-key.sh', () => {
  it('stores the key in place of the placeholders, literally, privately, and never prints it', () => {
    const dir = folder();
    const result = run(dir, ['production'], `${KEY}\n`);
    expect(result.status).toBe(0);
    expect(result.output).not.toContain(KEY);
    expect(result.output).toMatch(/Saved the production key/);

    const text = readFileSync(join(dir, '.env'), 'utf8');
    expect(text.split('\n')).toEqual([
      'DOMAIN=nyayasop.org',
      'APP_SECRET=keep$this#one',
      '',
      '# ── RCCG directory API ──',
      'DIRECTORY_API_ENV=production',
      `DIRECTORY_API_KEY='${KEY}'`,
      'LOG_LEVEL=info',
      '',
    ]);
    // Node reads single-quoted values literally (so does Docker Compose).
    expect(parseEnv(text)).toMatchObject({ DIRECTORY_API_ENV: 'production', DIRECTORY_API_KEY: KEY });
    expect(statSync(join(dir, '.env')).mode & 0o077).toBe(0);
  });

  it('replaces an earlier key and environment without leaving copies, and adds them when .env has neither', () => {
    const dir = folder('DOMAIN=nyayasop.org\nDIRECTORY_API_ENV=sandbox\nexport DIRECTORY_API_KEY=old-key-0123456789\nDIRECTORY_API_KEY=older-key-0123456789');
    expect(run(dir, ['production'], `${KEY}\n`).status).toBe(0);
    expect(run(dir, ['production'], `${KEY}\n`).status).toBe(0);
    const text = readFileSync(join(dir, '.env'), 'utf8');
    expect(text).toBe(`DOMAIN=nyayasop.org\nDIRECTORY_API_ENV=production\nDIRECTORY_API_KEY='${KEY}'\n`);

    const bare = folder('DOMAIN=nyayasop.org');
    expect(run(bare, ['sandbox'], `${KEY}\n`).status).toBe(0);
    expect(parseEnv(readFileSync(join(bare, '.env'), 'utf8'))).toEqual({ DOMAIN: 'nyayasop.org', DIRECTORY_API_ENV: 'sandbox', DIRECTORY_API_KEY: KEY });
  });

  it('changes nothing for a wrong environment, a key on the command line, or a key that isn’t one', () => {
    const dir = folder();
    for (const args of [[], ['staging'], ['production', KEY]]) {
      const result = run(dir, args, `${KEY}\n`);
      expect(result.status).toBe(2);
      expect(result.output).not.toContain(KEY);
    }
    for (const input of ['', '\n', 'short-key\n', 'has a space 0123456789\n', "has'quote0123456789\n", `${'k'.repeat(513)}\n`, 'ключ-0123456789-abcdef\n']) {
      const result = run(dir, ['production'], input);
      expect(result.status, JSON.stringify(input)).toBe(1);
      expect(result.output).toMatch(/Nothing was changed/);
    }
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe(`${ENV}\n`);
    expect(run(folder(null), ['production'], `${KEY}\n`).output).toMatch(/No \.env here/);
  });
});
