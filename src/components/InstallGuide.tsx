import { useState, type ReactNode } from 'react';
import { copyText } from '../lib/clipboard';
import type { InstallGuide } from '../lib/install';

/**
 * Install steps per browser. Wording follows each vendor's own help pages (checked September
 * 2026: Apple Support "Turn a website into an app" for iPhone/iPad and "Use Safari web apps on
 * Mac", Google Chrome Help "Use web apps", Microsoft Learn "Use PWAs in Microsoft Edge", MDN
 * "Installing web apps"). Menus move between versions, so steps name what to look for.
 */
type Guide = { title: string; steps: ReactNode[]; after?: string; notifications: string };

/** A menu symbol, read out by name (aria-label isn't reliable on a plain span). */
const Glyph = ({ symbol, label }: { symbol: string; label: string }) => (
  <>
    <span aria-hidden="true">{symbol}</span>
    <span className="sr-only">{label}</span>
  </>
);

const PUSH_BROWSER = 'Notifications work in this browser too: installing isn’t needed for them.';
const PUSH_APPLE = 'On iPhone and iPad, notifications need iOS or iPadOS 16.4 or later and only work in the app opened from the Home Screen.';
const OPEN_MOBILE = 'Open School of Purpose from its icon on your Home Screen. It opens full screen, like an app.';
const OPEN_DESKTOP = 'It opens in its own window. Find it with your other apps (Start menu, Launchpad or app list).';

export const GUIDES: Record<Exclude<InstallGuide, 'in-app'>, Guide> = {
  'ios-safari': {
    title: 'iPhone: Safari',
    steps: [
      <>
        Tap the <strong>Share</strong> button (a square with an arrow pointing up). In iOS 26 and later, tap <strong>More</strong>{' '}
        (<Glyph symbol="•••" label="three dots" />) first, then <strong>Share</strong>.
      </>,
      <>
        Scroll down and tap <strong>Add to Home Screen</strong>. If it isn’t there, tap <strong>Edit Actions</strong> at the bottom of
        the list and add it.
      </>,
      <>
        Make sure <strong>Open as Web App</strong> is on (iOS 26 and later), then tap <strong>Add</strong>.
      </>,
    ],
    after: OPEN_MOBILE,
    notifications: PUSH_APPLE,
  },
  'ios-other': {
    title: 'iPhone: Chrome, Edge or Firefox',
    steps: [
      <>
        Tap the <strong>Share</strong> button (in Chrome it’s at the right of the address bar).
      </>,
      <>
        Tap <strong>Add to Home Screen</strong>, check the name, then tap <strong>Add</strong>.
      </>,
      <>If you can’t find it (it needs iOS 16.4 or later), open this page in Safari and follow the Safari steps.</>,
    ],
    after: OPEN_MOBILE,
    notifications: PUSH_APPLE,
  },
  'ipados-safari': {
    title: 'iPad: Safari',
    steps: [
      <>
        Tap the <strong>Share</strong> button (a square with an arrow pointing up, near the top right).
      </>,
      <>
        Tap <strong>Add to Home Screen</strong>. In iPadOS 26 and later, tap <strong>View More</strong> first if you don’t see it.
      </>,
      <>
        Make sure <strong>Open as Web App</strong> is on (iPadOS 26 and later), then tap <strong>Add</strong>.
      </>,
    ],
    after: OPEN_MOBILE,
    notifications: PUSH_APPLE,
  },
  'ipados-other': {
    title: 'iPad: Chrome, Edge or Firefox',
    steps: [
      <>
        Tap the <strong>Share</strong> button in the address bar or menu.
      </>,
      <>
        Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.
      </>,
      <>If you can’t find it (it needs iPadOS 16.4 or later), open this page in Safari and follow the Safari steps.</>,
    ],
    after: OPEN_MOBILE,
    notifications: PUSH_APPLE,
  },
  'android-chrome': {
    title: 'Android: Chrome',
    steps: [
      <>
        Tap the menu (<Glyph symbol="⋮" label="three dots" />) at the top right.
      </>,
      <>
        Tap <strong>Add to home screen</strong> or <strong>Install app</strong> (newer versions say <strong>Install and create shortcut</strong>
        ), then choose <strong>Install</strong>.
      </>,
    ],
    after: 'Open School of Purpose from your home screen or app drawer.',
    notifications: PUSH_BROWSER,
  },
  'android-samsung': {
    title: 'Android: Samsung Internet',
    steps: [
      <>
        Tap the install icon in the address bar if you see one. Otherwise tap the menu (<Glyph symbol="≡" label="three lines" />) at the
        bottom right.
      </>,
      <>
        Tap <strong>Add page to</strong>, then <strong>Home screen</strong>.
      </>,
    ],
    after: 'Open School of Purpose from your home screen or app drawer.',
    notifications: PUSH_BROWSER,
  },
  'android-firefox': {
    title: 'Android: Firefox',
    steps: [
      <>
        Tap the menu (<Glyph symbol="⋮" label="three dots" />).
      </>,
      <>
        Tap <strong>Add to Home screen</strong> (it may say <strong>Install</strong>), then confirm.
      </>,
    ],
    after: 'Open School of Purpose from your home screen or app drawer.',
    notifications: PUSH_BROWSER,
  },
  'android-other': {
    title: 'Android: other browsers',
    steps: [
      <>
        Open the browser menu and look for <strong>Install app</strong> or <strong>Add to Home screen</strong>.
      </>,
      <>If your browser doesn’t offer it, open this page in Chrome.</>,
    ],
    after: 'Open School of Purpose from your home screen or app drawer.',
    notifications: PUSH_BROWSER,
  },
  'desktop-chrome': {
    title: 'Computer: Chrome',
    steps: [
      <>
        Click the <strong>Install</strong> icon at the right of the address bar, or open the menu (
        <Glyph symbol="⋮" label="three dots" />) and choose <strong>Cast, save and share</strong> → <strong>Install page as app…</strong>
      </>,
      <>
        Click <strong>Install</strong>.
      </>,
    ],
    after: OPEN_DESKTOP,
    notifications: PUSH_BROWSER,
  },
  'desktop-edge': {
    title: 'Computer: Microsoft Edge',
    steps: [
      <>
        Click <strong>App available</strong> at the right of the address bar, or open <strong>Settings and more</strong> (…) →{' '}
        <strong>Apps</strong> → <strong>Install this site as an app</strong>.
      </>,
      <>
        Click <strong>Install</strong>.
      </>,
    ],
    after: OPEN_DESKTOP,
    notifications: PUSH_BROWSER,
  },
  'mac-safari': {
    title: 'Mac: Safari (macOS 14 Sonoma or later)',
    steps: [
      <>
        Choose <strong>File</strong> → <strong>Add to Dock</strong>, or click the <strong>Share</strong> button and choose{' '}
        <strong>Add to Dock</strong>.
      </>,
      <>
        Check the name, then click <strong>Add</strong>.
      </>,
    ],
    after: 'Open it from the Dock, Launchpad or Spotlight.',
    notifications: 'Notifications also work in Safari itself on macOS 13 or later.',
  },
  'desktop-firefox': {
    title: 'Computer: Firefox',
    steps: [
      <>Firefox on computers doesn’t install web apps. You can keep using School of Purpose in Firefox: nothing needs installing.</>,
      <>To install it, open this page in Chrome or Edge, or Safari on a Mac.</>,
    ],
    notifications: 'Notifications work in Firefox without installing.',
  },
  other: {
    title: 'Other browsers',
    steps: [
      <>
        Look in your browser’s menu for <strong>Install</strong>, <strong>Add to Home screen</strong> or <strong>Add to Dock</strong>.
      </>,
      <>If there’s no such option, keep using the site in your browser: everything works there.</>,
    ],
    notifications: 'Whether notifications work depends on your browser.',
  },
};

export const GUIDE_GROUPS: { label: string; guides: (keyof typeof GUIDES)[] }[] = [
  { label: 'iPhone and iPad', guides: ['ios-safari', 'ios-other', 'ipados-safari', 'ipados-other'] },
  { label: 'Android', guides: ['android-chrome', 'android-samsung', 'android-firefox', 'android-other'] },
  { label: 'Computers', guides: ['desktop-chrome', 'desktop-edge', 'mac-safari', 'desktop-firefox', 'other'] },
];

export function GuideSteps({ guide }: { guide: keyof typeof GUIDES }) {
  const { steps, after, notifications } = GUIDES[guide];
  return (
    <div className="flex flex-col gap-3 font-sans text-[15px] leading-[1.6] text-ink">
      <ol className="flex list-decimal flex-col gap-2 pl-6 marker:font-bold marker:text-brand">
        {steps.map((step, index) => (
          <li key={index}>{step}</li>
        ))}
      </ol>
      {after && <p className="text-muted">{after}</p>}
      <p className="text-[14px] text-muted">{notifications}</p>
    </div>
  );
}

/** For in-app browsers (Instagram, Facebook, TikTok…), which can't install or reliably show notifications. */
export function InAppBrowserNotice({ path = '/install' }: { path?: string }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'manual'>('idle');
  const url = `${window.location.origin}${path}`;
  return (
    <div className="flex flex-col gap-3 font-sans text-[15px] leading-[1.6] text-ink">
      <p>
        You’re viewing this page inside another app, such as Instagram, Facebook or TikTok. Its built-in browser can’t install apps
        or turn on notifications.
      </p>
      <p>
        Open this page in your usual browser: look for <strong>•••</strong> or the share icon, then <strong>Open in browser</strong>{' '}
        (it may say Open in Safari or Open in Chrome). Some apps don’t offer this; copy the link and paste it into your browser instead.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={async () => setCopied((await copyText(url)) ? 'copied' : 'manual')}
          className="min-h-[44px] cursor-pointer rounded-full border border-brand px-5 font-sans text-[14px] font-bold text-brand hover:bg-brand hover:text-white"
        >
          Copy link
        </button>
        <span role="status" className="text-[14px] text-muted">
          {copied === 'copied' ? 'Link copied. Paste it into your browser.' : ''}
        </span>
      </div>
      {copied === 'manual' && (
        <label className="flex flex-col gap-1 text-[14px] text-muted">
          Copy this link:
          <input
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
            className="rounded-[8px] border border-line-strong bg-white px-3 py-2 font-sans text-[14px] text-ink"
          />
        </label>
      )}
    </div>
  );
}
