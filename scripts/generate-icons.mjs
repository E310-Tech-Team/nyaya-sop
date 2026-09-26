// Renders the app icons in public/icons from the SOP monogram: white Arial Black lettering on the
// brand burgundy, as in public/favicon.svg and the site header. (public/apple-touch-icon.png, the
// full-bleed 180×180 iOS icon, predates this script and is kept as it is.)
//
//   node scripts/generate-icons.mjs            (needs Google Chrome; set CHROME=/path/to/chrome elsewhere)
//
// The PNGs are committed, so this only needs running when the mark changes.
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BURGUNDY = '#8b1e3f';

const text = (s, size, fill) =>
  `<text x="${s / 2}" y="${s / 2}" text-anchor="middle" dominant-baseline="central" font-family="'Arial Black', Arial, Helvetica, sans-serif" font-weight="900" font-size="${size}" fill="${fill}" letter-spacing="${size * 0.02}">SOP</text>`;
const svg = (s, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">${body}</svg>`;

const designs = {
  // purpose "any": the disc, like the favicon (transparent corners).
  any: (s) => svg(s, `<circle cx="${s / 2}" cy="${s / 2}" r="${s / 2}" fill="${BURGUNDY}"/>${text(s, s * 0.3, '#fff')}`),
  // purpose "maskable": full bleed; the lettering sits well inside the central 80% safe zone.
  maskable: (s) => svg(s, `<rect width="${s}" height="${s}" fill="${BURGUNDY}"/>${text(s, s * 0.22, '#fff')}`),
  // Android status-bar badge: only alpha is used, so a white disc with the letters cut out.
  badge: (s) =>
    svg(s, `<defs><mask id="m"><rect width="${s}" height="${s}" fill="#fff"/>${text(s, s * 0.34, '#000')}</mask></defs><circle cx="${s / 2}" cy="${s / 2}" r="${s * 0.47}" fill="#fff" mask="url(#m)"/>`),
};

const outputs = [
  ['any', 192, 'public/icons/icon-192.png'],
  ['any', 512, 'public/icons/icon-512.png'],
  ['maskable', 192, 'public/icons/icon-maskable-192.png'],
  ['maskable', 512, 'public/icons/icon-maskable-512.png'],
  ['badge', 96, 'public/icons/badge-96.png'],
];

/** Headless Chrome writes the screenshot but may not exit on its own, so stop it once the file exists. */
function screenshot(html, size, file, profile) {
  return new Promise((resolve, reject) => {
    const chrome = spawn(
      CHROME,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--disable-crash-reporter',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--user-data-dir=${profile}`,
        `--window-size=${size},${size}`,
        `--screenshot=${file}`,
        `file://${html}`,
      ],
      { stdio: 'ignore' },
    );
    const started = Date.now();
    const poll = setInterval(async () => {
      const written = await stat(file).then((info) => info.size > 0, () => false);
      if (written || Date.now() - started > 30_000) chrome.kill('SIGKILL');
    }, 250);
    chrome.on('error', (error) => {
      clearInterval(poll);
      reject(error);
    });
    chrome.on('exit', async () => {
      clearInterval(poll);
      const written = await stat(file).then(() => true, () => false);
      written ? resolve() : reject(new Error(`Chrome did not render ${file}`));
    });
  });
}

const work = await mkdtemp(join(tmpdir(), 'sop-icons-'));
try {
  for (const [index, [design, size, target]] of outputs.entries()) {
    const html = join(work, `${index}.html`);
    const png = join(work, `${index}.png`);
    await writeFile(html, `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${designs[design](size)}`);
    await screenshot(html, size, png, join(work, `profile-${index}`));
    await copyFile(png, target);
    console.log(`${target} (${size}×${size})`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
