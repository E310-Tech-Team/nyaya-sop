/**
 * Web Push sending: VAPID authentication (RFC 8292) and aes128gcm payload encryption
 * (RFC 8291) via the web-push library, over our own SSRF-safe transport.
 * "accepted" only ever means the push service accepted the message (HTTP 201/202): it says
 * nothing about whether it was shown, read or acted on.
 */
import { createHash } from 'node:crypto';
import webpush from 'web-push';
import type { AppConfig } from '../config';
import { PushNetworkError, type PushTransport } from './transport';

/** What the service worker receives (encrypted in transit). Keep it short and neutral. */
export type PushPayload = {
  v: 1;
  /** Message id: used as the notification tag, so repeats replace rather than stack. */
  id: string;
  title: string;
  body: string;
  /** Same-origin path from the allowlist (checked again by the service worker). */
  url: string;
  expiresAt: string;
};

export type SendOutcome =
  | { kind: 'accepted'; status: number }
  | { kind: 'gone'; status: number } // 404/410: subscription no longer exists
  | { kind: 'retry'; status: number; retryAfterSeconds: number | null; error: string }
  | { kind: 'failed'; status: number; error: string };

/**
 * VAPID JWTs are cached per push service and reused for 6 hours (they expire after 12):
 * Apple asks senders not to refresh them more than once an hour.
 */
class VapidSigner {
  readonly #cache = new Map<string, { header: string; createdAt: number }>();
  constructor(
    private readonly publicKey: string,
    private readonly privateKey: string,
    private readonly subject: string,
  ) {}

  authorization(endpoint: string): string {
    const audience = new URL(endpoint).origin;
    const cached = this.#cache.get(audience);
    if (cached && Date.now() - cached.createdAt < 6 * 3600_000) return cached.header;
    const expiration = Math.floor(Date.now() / 1000) + 12 * 3600;
    const { Authorization } = webpush.getVapidHeaders(audience, this.subject, this.publicKey, this.privateKey, 'aes128gcm', expiration);
    this.#cache.set(audience, { header: Authorization, createdAt: Date.now() });
    return Authorization;
  }
}

/** Push "Topic" header: lets the push service replace an undelivered earlier copy. ≤32 URL-safe chars. */
export const pushTopic = (messageId: string) => createHash('sha256').update(messageId).digest('base64url').slice(0, 32);

export class PushService {
  readonly publicKey: string;
  readonly #signer: VapidSigner;

  constructor(
    push: AppConfig['push'],
    private readonly transport: PushTransport,
  ) {
    if (!push.publicKey || !push.privateKey || !push.subject) throw new Error('VAPID keys are not configured');
    this.publicKey = push.publicKey;
    this.#signer = new VapidSigner(push.publicKey, push.privateKey, push.subject);
  }

  async send(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: PushPayload,
    options: { ttlSeconds: number; urgency?: 'normal' | 'high' | 'low' },
  ): Promise<SendOutcome> {
    let details: ReturnType<typeof webpush.generateRequestDetails>;
    try {
      details = webpush.generateRequestDetails(subscription, JSON.stringify(payload), {
        TTL: Math.max(0, Math.round(options.ttlSeconds)),
        headers: { Authorization: this.#signer.authorization(subscription.endpoint) },
        contentEncoding: 'aes128gcm',
        urgency: options.urgency ?? 'normal',
        topic: pushTopic(payload.id),
      });
    } catch {
      return { kind: 'failed', status: 0, error: 'invalid_subscription_keys' };
    }
    try {
      const response = await this.transport.send({
        endpoint: details.endpoint,
        headers: details.headers as Record<string, string | number>,
        body: (details.body as Buffer | null) ?? null,
      });
      const { status } = response;
      if (status === 201 || status === 202 || status === 200) return { kind: 'accepted', status };
      if (status === 404 || status === 410) return { kind: 'gone', status };
      if (status === 429 || status >= 500) {
        return { kind: 'retry', status, retryAfterSeconds: response.retryAfterSeconds, error: status === 429 ? 'rate_limited' : 'service_error' };
      }
      return { kind: 'failed', status, error: status === 413 ? 'payload_too_large' : status === 401 || status === 403 ? 'rejected_credentials' : 'rejected' };
    } catch (error) {
      if (error instanceof PushNetworkError) {
        return error.retryable ? { kind: 'retry', status: 0, retryAfterSeconds: null, error: error.code } : { kind: 'failed', status: 0, error: error.code };
      }
      return { kind: 'retry', status: 0, retryAfterSeconds: null, error: 'network' };
    }
  }
}
