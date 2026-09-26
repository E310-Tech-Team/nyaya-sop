/**
 * Installing the site as an app (docs/03 §Install). Feature detection decides what we can do;
 * the platform (from the user agent) only picks which instructions to show first.
 *
 * - Chromium browsers fire `beforeinstallprompt`: we keep the event and prompt only when the
 *   person presses "Install" (never automatically).
 * - Safari (iOS, iPadOS, macOS) and Firefox have no prompt API: we show their menu steps.
 * - We can't reliably know whether the app is already installed. We only know two things, and
 *   report them separately: an *observed* install (the `appinstalled` event fired on this page)
 *   and a *standalone launch* (this page is running in an app window, inferred from display mode).
 */
import { useSyncExternalStore } from 'react';
import { reportEvent } from './events';

// ── Platform (hints only) ─────────────────────────────────────────────────────

export type Os = 'ios' | 'ipados' | 'android' | 'mac' | 'windows' | 'chromeos' | 'linux' | 'other';
export type Browser = 'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'opera' | 'other';
export type InAppBrowser = 'facebook' | 'instagram' | 'tiktok' | 'snapchat' | 'twitter' | 'linkedin' | 'line' | 'wechat' | 'other';
export type Platform = { os: Os; browser: Browser; inApp: InAppBrowser | null; appleVersion: number | null };

const IN_APP: [RegExp, InAppBrowser][] = [
  [/FBAN|FBAV|FB_IAB|FBIOS|FB4A/, 'facebook'],
  [/Instagram/, 'instagram'],
  [/musical_ly|BytedanceWebview|TikTok/i, 'tiktok'],
  [/Snapchat/, 'snapchat'],
  [/\bTwitter\b/, 'twitter'],
  [/LinkedInApp/, 'linkedin'],
  [/\bLine\//, 'line'],
  [/MicroMessenger/, 'wechat'],
  [/; wv\)|GSA\//, 'other'], // Android WebView inside another app, the Google app on iOS
];

export function detectPlatform({ userAgent: ua, maxTouchPoints = 0 }: { userAgent: string; maxTouchPoints?: number }): Platform {
  const inApp = IN_APP.find(([pattern]) => pattern.test(ua))?.[1] ?? null;
  let os: Os = 'other';
  if (/iPhone|iPod/.test(ua)) os = 'ios';
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) os = 'ipados'; // iPadOS asks for desktop sites
  else if (/Android/.test(ua)) os = 'android';
  else if (/CrOS/.test(ua)) os = 'chromeos';
  else if (/Macintosh|Mac OS X/.test(ua)) os = 'mac';
  else if (/Windows NT/.test(ua)) os = 'windows';
  else if (/Linux/.test(ua)) os = 'linux';

  let browser: Browser = 'other';
  if (/CriOS/.test(ua)) browser = 'chrome';
  else if (/FxiOS|Firefox\//.test(ua)) browser = 'firefox';
  else if (/EdgiOS|EdgA\/|Edg\//.test(ua)) browser = 'edge';
  else if (/SamsungBrowser/.test(ua)) browser = 'samsung';
  else if (/OPiOS|OPR\/|Opera/.test(ua)) browser = 'opera';
  else if (/Chrome\/|Chromium\//.test(ua)) browser = 'chrome';
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) browser = 'safari';
  else if ((os === 'ios' || os === 'ipados') && !inApp && /Safari\//.test(ua)) browser = 'safari';

  // iOS/iPadOS version as major.minor (16.4 → 16.04): "iPhone OS 18_5", or Safari's "Version/18.5"
  // when an iPad asks for desktop sites. (macOS user agents are frozen at 10_15_7, so not used.)
  const apple = os === 'ios' || os === 'ipados' ? (/OS (\d+)_(\d+)/.exec(ua) ?? /Version\/(\d+)\.(\d+)/.exec(ua)) : null;
  const appleVersion = apple ? Number(`${apple[1]}.${apple[2]!.padStart(2, '0')}`) : null;
  return { os, browser, inApp, appleVersion };
}

/** Which set of instructions to show first. */
export type InstallGuide =
  | 'in-app'
  | 'ios-safari'
  | 'ios-other'
  | 'ipados-safari'
  | 'ipados-other'
  | 'android-chrome'
  | 'android-samsung'
  | 'android-firefox'
  | 'android-other'
  | 'desktop-chrome'
  | 'desktop-edge'
  | 'mac-safari'
  | 'desktop-firefox'
  | 'other';

export function guideFor(platform: Platform): InstallGuide {
  const { os, browser } = platform;
  if (platform.inApp) return 'in-app';
  if (os === 'ios') return browser === 'safari' ? 'ios-safari' : 'ios-other';
  if (os === 'ipados') return browser === 'safari' ? 'ipados-safari' : 'ipados-other';
  if (os === 'android') {
    if (browser === 'chrome') return 'android-chrome';
    if (browser === 'samsung') return 'android-samsung';
    if (browser === 'firefox') return 'android-firefox';
    return 'android-other';
  }
  if (os === 'mac' && browser === 'safari') return 'mac-safari';
  if (os === 'mac' || os === 'windows' || os === 'linux' || os === 'chromeos') {
    if (browser === 'chrome') return 'desktop-chrome';
    if (browser === 'edge') return 'desktop-edge';
    if (browser === 'firefox') return 'desktop-firefox';
  }
  return 'other';
}

/** iOS/iPadOS push needs 16.4+ and the Home Screen app. */
export const isAppleMobile = (platform: Platform) => platform.os === 'ios' || platform.os === 'ipados';
export const appleSupportsWebPush = (platform: Platform) => isAppleMobile(platform) && (platform.appleVersion ?? 0) >= 16.04;

export const coarsePlatform = (platform: Platform): 'android' | 'ios' | 'desktop' | 'other' =>
  isAppleMobile(platform) ? 'ios' : platform.os === 'android' ? 'android' : platform.os === 'other' ? 'other' : 'desktop';

export const currentPlatform = (): Platform =>
  typeof navigator === 'undefined'
    ? { os: 'other', browser: 'other', inApp: null, appleVersion: null }
    : detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });

// ── Display mode ──────────────────────────────────────────────────────────────

/** Running in an app window (opened from the home screen / app list), not a browser tab. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const modes = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];
  return window.navigator.standalone === true || modes.some((mode) => window.matchMedia?.(`(display-mode: ${mode})`).matches);
}

// ── Install state (a tiny external store for React) ───────────────────────────

export type InstallState = {
  /** A Chromium install prompt is ready to show on request. */
  canPrompt: boolean;
  /** This page runs in an app window (inferred). */
  standalone: boolean;
  /** `appinstalled` fired while this page was open (observed). */
  installedHere: boolean;
};

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = { canPrompt: false, standalone: false, installedHere: false };
const listeners = new Set<() => void>();
const update = (next: Partial<InstallState>) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

/** Once per browser session, so reloads don't inflate the counts. */
function reportOncePerSession(name: 'install_prompt_available' | 'standalone_launch') {
  try {
    const key = `sop.event.${name}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, '1');
  } catch {
    // storage blocked: report anyway (at worst a duplicate)
  }
  const platform = coarsePlatform(currentPlatform());
  reportEvent(name, name === 'standalone_launch' ? { platform, displayMode: 'standalone' } : { platform });
}

/** Call once, before the first render, so an early `beforeinstallprompt` isn't missed. */
export function startInstallTracking(): void {
  if (typeof window === 'undefined') return;
  update({ standalone: isStandaloneDisplay() });
  if (state.standalone) reportOncePerSession('standalone_launch');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // no automatic mini-infobar: we prompt only when asked
    deferred = event;
    update({ canPrompt: true });
    reportOncePerSession('install_prompt_available');
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    update({ canPrompt: false, installedHere: true });
    reportEvent('app_installed', { platform: coarsePlatform(currentPlatform()) });
  });
  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => update({ standalone: isStandaloneDisplay() }));
}

/** Shows the browser's install prompt (only after a click). A prompt event works once. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  update({ canPrompt: false });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    reportEvent(outcome === 'accepted' ? 'install_prompt_accepted' : 'install_prompt_dismissed', { platform: coarsePlatform(currentPlatform()) });
    return outcome;
  } catch {
    return 'unavailable';
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};
export const useInstallState = () => useSyncExternalStore(subscribe, () => state, () => state);

// ── "Not now" for install suggestions ─────────────────────────────────────────

const SNOOZE_KEY = 'sop.install.snoozedAt';
export const SNOOZE_DAYS = 30;

/** Only a timestamp is stored (no personal data). */
export function isInstallSuggestionSnoozed(now = Date.now()): boolean {
  try {
    const at = Number(window.localStorage.getItem(SNOOZE_KEY));
    return at > 0 && now - at < SNOOZE_DAYS * 86_400_000;
  } catch {
    return false;
  }
}

export function snoozeInstallSuggestion(now = Date.now()): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(now));
  } catch {
    // storage blocked: the suggestion may show again next time
  }
}
