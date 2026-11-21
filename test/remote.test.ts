/**
 * Setups where the overlay is not on the same PC: Raspberry Pi on the LAN, VPN (Tailscale / WireGuard), reverse
 * proxy (Tailscale Serve, Caddy), public address with TLS.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createLogger, silentLogger, type LogSink } from '../src/lib/log.ts';
import { hostHeaderAllowed } from '../src/transports/security.ts';

const SITE = 'https://overlays.ramazansancar.com.tr';
const sim = [{ driver: 'simulator', options: { intervalMs: 100 } }];

/** GET with explicit headers (fetch() silently drops a custom Host header). */
function get(url: string, headers: Record<string, string>): Promise<{ status: number; acao: string | undefined }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, acao: res.headers['access-control-allow-origin'] as string | undefined }));
      })
      .on('error', reject);
  });
}

describe('reverse proxy in front of a loopback server (Tailscale Serve, Caddy)', () => {
  it('accepts only the configured proxy names besides loopback', () => {
    const allowed = ['pi.tailnet-abc.ts.net', 'overlay.example.com'];
    assert.ok(hostHeaderAllowed('pi.tailnet-abc.ts.net', '127.0.0.1', allowed));
    assert.ok(hostHeaderAllowed('PI.TAILNET-ABC.TS.NET:443', '127.0.0.1', allowed), 'case and port do not matter');
    assert.ok(hostHeaderAllowed('overlay.example.com', '127.0.0.1', allowed));
    assert.ok(!hostHeaderAllowed('evil.example', '127.0.0.1', allowed));
    assert.ok(!hostHeaderAllowed('pi.tailnet-abc.ts.net.evil.example', '127.0.0.1', allowed));
  });

  it('a proxied request with the proxy Host name is served end to end', async () => {
    const server = await startServer({
      config: parseConfig({ port: 0, logLevel: 'silent', rememberLastPosition: false, allowedHosts: ['Pi.Tailnet-ABC.ts.net'], sources: sim }),
      log: silentLogger,
    });
    try {
      const proxied = await get(`${server.url}/health`, { Host: 'pi.tailnet-abc.ts.net', Origin: SITE });
      assert.equal(proxied.status, 200);
      assert.equal(proxied.acao, SITE);
      assert.equal((await get(`${server.url}/health`, { Host: 'other.ts.net' })).status, 421);
      assert.equal((await get(`${server.url}/health`, { Host: 'pi.tailnet-abc.ts.net.evil.example' })).status, 421);
    } finally {
      await server.close();
    }
  });
});

describe('listening on a LAN / VPN address', () => {
  it('warns when there is no token, stays quiet with one', async () => {
    const lines: string[] = [];
    const sink: LogSink = (_level, line) => lines.push(line);
    const open = await startServer({
      config: parseConfig({ host: '0.0.0.0', port: 0, logLevel: 'warn', rememberLastPosition: false, sources: sim }),
      log: createLogger('warn', sink),
    });
    await open.close();
    assert.ok(lines.some((l) => /without a token/.test(l)), lines.join('\n'));

    lines.length = 0;
    const closed = await startServer({
      config: parseConfig({ host: '0.0.0.0', port: 0, token: 't', logLevel: 'warn', rememberLastPosition: false, sources: sim }),
      log: createLogger('warn', sink),
    });
    await closed.close();
    assert.ok(!lines.some((l) => /without a token/.test(l)));
  });
});

/** Self-signed certificate for 127.0.0.1 / localhost, made with openssl (skipped when openssl is missing). */
function makeCertificate(dir: string): { cert: string; key: string } | undefined {
  const cert = path.join(dir, 'cert.pem');
  const key = path.join(dir, 'key.pem');
  try {
    execFileSync(
      'openssl',
      ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', key, '-out', cert],
      { stdio: 'ignore' },
    );
    return { cert, key };
  } catch {
    return undefined;
  }
}

describe('TLS: HTTPS / WSS served directly (public address, tailscale cert)', () => {
  let dir: string;
  let files: { cert: string; key: string } | undefined;
  let server: RunningServer | undefined;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-tls-'));
    files = makeCertificate(dir);
    if (!files) return;
    server = await startServer({
      config: parseConfig({
        port: 0,
        logLevel: 'silent',
        rememberLastPosition: false,
        tls: { certFile: files.cert, keyFile: files.key },
        sources: sim,
      }),
      log: silentLogger,
    });
    await new Promise((r) => setTimeout(r, 250));
  });

  after(async () => {
    await server?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves https:// and wss:// with the given certificate', async (t) => {
    if (!server || !files) return t.skip('openssl not available');
    assert.match(server.url, /^https:\/\//);
    const ca = fs.readFileSync(files.cert);
    const body = await new Promise<string>((resolve, reject) => {
      https
        .get(`${server!.url}/health`, { ca, headers: { Origin: SITE } }, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(b));
        })
        .on('error', reject);
    });
    assert.equal(JSON.parse(body).ok, true);

    const first = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${server!.url.replace('https', 'wss')}/v1/ws`, { ca, origin: SITE });
      ws.on('message', (d) => {
        ws.close();
        resolve(JSON.parse(String(d)).type);
      });
      ws.on('error', reject);
    });
    assert.equal(first, 'hello');
  });

  it('a plain HTTP client gets nothing from the TLS port', async (t) => {
    if (!server) return t.skip('openssl not available');
    await assert.rejects(fetch(server.url.replace('https', 'http') + '/health', { signal: AbortSignal.timeout(2000) }));
  });

  it('reports unreadable certificate files clearly', async () => {
    await assert.rejects(
      startServer({ config: parseConfig({ port: 0, logLevel: 'silent', tls: { certFile: path.join(dir, 'nope.pem'), keyFile: 'x' }, sources: sim }), log: silentLogger }),
      /cannot read the TLS certificate/,
    );
    assert.throws(() => parseConfig({ tls: { certFile: 'a' } }), /needs both certFile and keyFile/);
  });
});
