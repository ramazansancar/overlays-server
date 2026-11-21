import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]']);
/** 127.0.0.0/8 as an IPv4 literal only: "127.0.0.1.attacker.example" is a DNS name, not loopback. */
const LOOPBACK_V4 = /^127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase()) || LOOPBACK_V4.test(host);
}

/**
 * DNS rebinding guard: while listening on loopback only requests addressed to a loopback name are
 * answered. Otherwise a malicious site could point its own domain at 127.0.0.1 and read us same-origin.
 */
export function hostHeaderAllowed(hostHeader: string | undefined, listenHost: string, allowedHosts: readonly string[] = []): boolean {
  if (!isLoopbackHost(listenHost)) return true;
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return false;
  }
  // A reverse proxy (Tailscale Serve, Caddy) forwards its own public name; only names listed in the config pass.
  return isLoopbackHost(hostname) || allowedHosts.includes(hostname);
}

/**
 * Origin allowlist. Patterns: an exact origin (`https://example.com`), any port
 * (`http://localhost:*`), `null` (file:// pages) or `*`.
 * Requests without an Origin header (curl, address bar) are not cross-site reads and are allowed.
 */
export function originAllowed(origin: string | undefined, patterns: readonly string[]): boolean {
  if (origin === undefined) return true;
  for (const pattern of patterns) {
    if (pattern === '*') return true;
    if (pattern === 'null' || origin === 'null') {
      if (pattern === origin) return true;
      continue;
    }
    if (pattern.endsWith(':*')) {
      const base = pattern.slice(0, -2);
      try {
        const want = new URL(base);
        const got = new URL(origin);
        if (want.protocol === got.protocol && want.hostname === got.hostname) return true;
      } catch {
        /* invalid pattern or origin */
      }
      continue;
    }
    try {
      if (new URL(pattern).origin === new URL(origin).origin) return true;
    } catch {
      /* invalid pattern or origin */
    }
  }
  return false;
}

/** Token from `?token=` or `Authorization: Bearer ...`, compared in constant time. */
export function tokenAllowed(req: IncomingMessage, url: URL, token: string | undefined): boolean {
  if (!token) return true;
  const header = req.headers.authorization;
  const given = url.searchParams.get('token') ?? (header?.startsWith('Bearer ') ? header.slice(7) : undefined);
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
