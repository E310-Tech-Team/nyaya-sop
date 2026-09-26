/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public contact email for the Programme team (optional). */
  readonly VITE_CONTACT_EMAIL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** This release's id (vite.config.ts): matches dist/build-id.txt and the API's x-app-build header. "dev" in development. */
declare const __APP_BUILD__: string;
/** False in an emergency-rollback build (SW_KILL_SWITCH=1): the page then removes any service worker. */
declare const __SW_ENABLED__: boolean;

/** Chromium's install prompt event (not standardised; other browsers never fire it). */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

interface WindowEventMap {
  beforeinstallprompt: BeforeInstallPromptEvent;
  'vite:preloadError': Event & { payload?: unknown };
}

interface Navigator {
  /** iOS Safari: true when opened from a Home Screen icon. */
  readonly standalone?: boolean;
}
