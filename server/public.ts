/** Public, unauthenticated endpoints: feature flags, public announcements, analytics events. */
import type { FastifyInstance } from 'fastify';
import type { Announcement, PublicConfig } from '../src/shared/platform';
import { accountsEnabled } from './account/routes';
import { cleanProperties, isAnalyticsEvent, recordEvent } from './analytics';
import { checkOrigin } from './auth/guards';
import type { OutboxTransport } from './email';
import { iso, sendError } from './http';
import { parishDirectoryEnabled } from './parishes';
import type { Services } from './services';
import { getSettings } from './settings';

/** Events the browser may report (the rest are recorded by the server itself). */
const CLIENT_EVENTS = new Set([
  'install_prompt_available',
  'install_prompt_accepted',
  'install_prompt_dismissed',
  'app_installed',
  'standalone_launch',
  'notification_click',
]);

export async function publicRoutes(app: FastifyInstance, services: Services) {
  const { db, config } = services;

  app.get('/config', { config: { rateLimit: { max: 120, timeWindow: 60_000 } } }, async (): Promise<PublicConfig> => {
    const settings = await getSettings(db);
    return {
      accounts: { enabled: await accountsEnabled(services) },
      push: { enabled: Boolean(services.push), publicKey: services.push?.publicKey ?? null },
      supportEmail: settings.support_email,
      buildId: config.buildId,
      parishDirectory: { enabled: await parishDirectoryEnabled(db) },
    };
  });

  app.get('/announcements', { config: { rateLimit: { max: 120, timeWindow: 60_000 } } }, async (): Promise<{ items: Announcement[] }> => {
    const { rows } = await db.query<{ id: string; title: string; body: string; published_at: Date }>(
      `select id, title, body, published_at from announcements
        where status = 'published' and audience = 'public' order by published_at desc limit 50`,
    );
    return { items: rows.map((row) => ({ id: row.id, title: row.title, body: row.body, publishedAt: iso(row.published_at)! })) };
  });

  app.post('/events', { config: { rateLimit: { max: 60, timeWindow: 60_000 } } }, async (request, reply) => {
    if (!checkOrigin(services, request, reply)) return reply;
    const body = request.body as { name?: unknown; properties?: unknown } | null;
    if (!isAnalyticsEvent(body?.name) || !CLIENT_EVENTS.has(body.name)) return sendError(reply, 400, 'BAD_REQUEST', 'Unknown event.');
    await recordEvent(db, body.name, cleanProperties(body.properties));
    return reply.code(202).send({ ok: true });
  });

  // Local test adapter only: read the in-memory outbox. Never registered in production.
  if (config.env !== 'production' && services.email.kind === 'outbox') {
    app.get('/dev/outbox', async (_request, reply) => {
      const outbox = services.email as OutboxTransport;
      const esc = (value: string) => value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
      const items = [...outbox.messages]
        .reverse()
        .map((m) => {
          const link = /(https?:\/\/\S+)/.exec(m.text)?.[1] ?? '';
          return `<li><strong>${esc(m.subject)}</strong> → ${esc(m.to)} <small>${m.sentAt.toISOString()}</small><br><a href="${esc(link)}">${esc(link)}</a></li>`;
        })
        .join('');
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .send(
          `<!doctype html><title>Local outbox</title><body style="font:15px system-ui;max-width:760px;margin:32px auto;padding:0 16px"><h1>Local email outbox</h1><p>Development only: nothing here was really sent. Newest first.</p><ol>${items || '<p>No messages yet.</p>'}</ol></body>`,
        );
    });
  }
}
