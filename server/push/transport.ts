/**
 * Sends an already-encrypted Web Push request. The real transport:
 * - re-checks the endpoint against the allowlist;
 * - resolves DNS itself and refuses to connect if any address is not public, then connects to
 *   exactly the address it checked (no DNS-rebinding window);
 * - never follows redirects, and times out.
 * Tests use FakePushTransport instead, so no automated test ever reaches a real push service.
 */
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { checkPushEndpoint, isPublicAddress } from './endpoint';

export type PushHttpRequest = { endpoint: string; headers: Record<string, string | number>; body: Buffer | null };
export type PushHttpResponse = { status: number; retryAfterSeconds: number | null };

export interface PushTransport {
  send(request: PushHttpRequest): Promise<PushHttpResponse>;
}

export class PushNetworkError extends Error {
  constructor(
    readonly code: 'endpoint_not_allowed' | 'private_address' | 'timeout' | 'network',
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

function parseRetryAfter(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (!text) return null;
  const seconds = Number(text);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(3600, Math.round(seconds)));
  const date = Date.parse(text);
  return Number.isNaN(date) ? null : Math.max(0, Math.min(3600, Math.round((date - Date.now()) / 1000)));
}

/** DNS lookup that only ever hands the socket public addresses. */
export const publicOnlyLookup: LookupFunction = (hostname: string, options: LookupOptions, callback) => {
  dnsLookup(hostname, { ...options, all: true, verbatim: true }, (error, addresses) => {
    if (error) return (callback as (e: Error) => void)(error);
    const list = addresses as unknown as LookupAddress[];
    if (!list.length || list.some((entry) => !isPublicAddress(entry.address))) {
      return (callback as (e: Error) => void)(Object.assign(new Error('Push endpoint resolves to a non-public address'), { code: 'EPUSHPRIVATE' }));
    }
    if (options.all) return (callback as (e: null, a: LookupAddress[]) => void)(null, list);
    return (callback as (e: null, a: string, f: number) => void)(null, list[0]!.address, list[0]!.family);
  });
};

export class HttpsPushTransport implements PushTransport {
  constructor(
    private readonly extraHosts: readonly string[],
    private readonly timeoutMs = 10_000,
  ) {}

  send(request: PushHttpRequest): Promise<PushHttpResponse> {
    const check = checkPushEndpoint(request.endpoint, this.extraHosts);
    if (!check.ok) return Promise.reject(new PushNetworkError('endpoint_not_allowed', false));
    const url = new URL(request.endpoint);
    return new Promise((resolve, reject) => {
      const outgoing = httpsRequest(
        {
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: request.headers,
          lookup: publicOnlyLookup,
          servername: url.hostname,
          timeout: this.timeoutMs,
        },
        (response) => {
          response.resume(); // body not needed; status carries the meaning
          resolve({ status: response.statusCode ?? 0, retryAfterSeconds: parseRetryAfter(response.headers['retry-after']) });
        },
      );
      outgoing.on('timeout', () => outgoing.destroy(new PushNetworkError('timeout', true)));
      outgoing.on('error', (error: Error & { code?: string }) => {
        if (error instanceof PushNetworkError) return reject(error);
        reject(new PushNetworkError(error.code === 'EPUSHPRIVATE' ? 'private_address' : 'network', error.code !== 'EPUSHPRIVATE'));
      });
      outgoing.end(request.body ?? undefined);
    });
  }
}

/** Records requests and answers with scripted statuses. For tests and local development only. */
export class FakePushTransport implements PushTransport {
  readonly sent: PushHttpRequest[] = [];
  respond: (request: PushHttpRequest) => PushHttpResponse | Error = () => ({ status: 201, retryAfterSeconds: null });

  async send(request: PushHttpRequest): Promise<PushHttpResponse> {
    this.sent.push(request);
    const result = this.respond(request);
    if (result instanceof Error) throw result;
    return result;
  }
}
