import type { AppConfig } from './config';
import type { Secrets } from './crypto';
import type { Db } from './db';
import type { EmailTransport } from './email';
import type { PushService } from './push/service';

/** Everything route modules and job handlers need, created once in buildApp / the worker. */
export type Services = {
  config: AppConfig;
  db: Db;
  secrets: Secrets;
  email: EmailTransport;
  /** Null when VAPID keys aren't configured: push is then unavailable, everything else works. */
  push: PushService | null;
};
