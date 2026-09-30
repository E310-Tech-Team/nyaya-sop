import type { AppConfig } from './config';
import type { Secrets } from './crypto';
import type { Db } from './db';
import type { DirectoryApi } from './directory/api';
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
  /**
   * The RCCG directory API, the parish directory's source (server/directory/api.ts). Null when not
   * configured: the directory then serves only what was imported without it (the old list).
   */
  directory: DirectoryApi | null;
};

/** The environment namespace whose directory entries the site uses: the API's, or none (the old list). */
export const directoryNamespace = (services: Pick<Services, 'directory'>) => services.directory?.namespace ?? null;
