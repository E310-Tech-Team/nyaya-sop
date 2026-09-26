/**
 * SSRF protection for Web Push. Push endpoints are URLs chosen by the browser, so before we
 * store one, and again before every send, it must be:
 * - https on the default port, with no credentials and no IP-literal host;
 * - on a known push service (below), plus any hosts added with PUSH_ENDPOINT_HOSTS;
 * and when we connect, every address the host resolves to must be public (transport.ts).
 */
import { BlockList, isIP } from 'node:net';

/** Push services used by current browsers. */
export const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome and other Chromium browsers (incl. Chrome/Edge on Android)
  'updates.push.services.mozilla.com', // Firefox
  '*.push.apple.com', // Safari on macOS 13+, iOS/iPadOS 16.4+ Home Screen web apps
  '*.notify.windows.com', // Edge on Windows (WNS)
] as const;

export type EndpointCheck = { ok: true; host: string } | { ok: false; reason: string };

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".push.apple.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

export function checkPushEndpoint(raw: unknown, extraHosts: readonly string[] = []): EndpointCheck {
  if (typeof raw !== 'string' || raw.length < 12 || raw.length > 2048) return { ok: false, reason: 'invalid_length' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not_https' };
  if (url.username || url.password) return { ok: false, reason: 'credentials_in_url' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'non_default_port' };
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, ''))) return { ok: false, reason: 'ip_literal' };
  if (![...DEFAULT_PUSH_HOSTS, ...extraHosts].some((pattern) => hostMatches(host, pattern))) {
    return { ok: false, reason: 'host_not_allowed' };
  }
  return { ok: true, host };
}

// ── Public-address check (used at connect time) ──────────────────────────────

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['100::', 64], // discard
  ['2001::', 32], // Teredo
  ['2001:db8::', 32], // documentation
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

/** Expands an IPv6 address to 8 groups of numbers. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split('%')[0]!;
  // Trailing dotted IPv4 (::ffff:1.2.3.4) → two hex groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const octets = dotted[1]!.split('.').map(Number);
    text = text.slice(0, -dotted[1]!.length) + `${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const parse = (part: string) => (part ? part.split(':').map((group) => Number.parseInt(group, 16)) : []);
  const start = parse(head);
  const end = tail === undefined ? [] : parse(tail);
  const groups = tail === undefined ? start : [...start, ...Array(8 - start.length - end.length).fill(0), ...end];
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

const embeddedIPv4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const groups = ipv6Groups(address);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
    if (g5 === 0 && g6 === 0 && g7 <= 1) return false; // :: and ::1
    return isPublicAddress(embeddedIPv4(g6, g7));
  }
  // NAT64 (64:ff9b::/96) embeds an IPv4 address in the last 32 bits.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return isPublicAddress(embeddedIPv4(g6, g7));
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return false; // local-use NAT64
  // 6to4 (2002::/16) embeds an IPv4 address in bits 16–47.
  if (g0 === 0x2002) return isPublicAddress(embeddedIPv4(g1, g2));
  return !blocked.check(address, 'ipv6');
}
