/**
 * Attacks that must fail and the real-world setups that must keep working, against a running server.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import type { ServerMessage } from '../src/core/protocol.ts';
import { silentLogger } from '../src/lib/log.ts';

const SITE = 'https://overlays.ramazansancar.com.tr';
const EVIL = 'https://evil.example';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(url: string, init: { method?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Opens a WebSocket; resolves with the first messages or rejects with the HTTP status of a refused upgrade. */
function wsOpen(url: string, headers: Record<string, string> = {}, count = 2): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    const got: ServerMessage[] = [];
    const timer = setTimeout(() => {
      ws.terminate();
      resolve(got);
    }, 1500);
    ws.on('message', (d) => {
      got.push(JSON.parse(String(d)) as ServerMessage);
      if (got.length >= count) {
        clearTimeout(timer);
        ws.close();
        resolve(got);
      }
    });
    ws.on('unexpected-response', (_req, res) => {
      clearTimeout(timer);
      reject(new Error(`HTTP ${res.statusCode}`));
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

describe('security: loopback server (default setup)', () => {
  let server: RunningServer;
  let base: string;
  let wsBase: string;

  before(async () => {
    server = await startServer({
      config: parseConfig({ port: 0, logLevel: 'silent', rememberLastPosition: false, sources: [{ driver: 'simulator', options: { intervalMs: 100 } }] }),
      log: silentLogger,
    });
    base = server.url;
    wsBase = `${base.replace('http', 'ws')}/v1/ws`;
    await new Promise((r) => setTimeout(r, 250));
  });
  after(() => server.close());

  it('listens on loopback only', async () => {
    assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
  });

  // ---- usage scenarios that must keep working
  it('scenario: the overlay site connects over WebSocket and gets live fixes', async () => {
    const msgs = await wsOpen(wsBase, { Origin: SITE }, 4);
    assert.equal(msgs[0]?.type, 'hello');
    assert.ok(msgs.some((m) => m.type === 'fix'));
  });

  it('scenario: the overlay site reads /health and diagnostics with CORS', async () => {
    for (const path of ['/health', '/v1/state', '/v1/diagnostics']) {
      const r = await request(base + path, { headers: { Origin: SITE } });
      assert.equal(r.status, 200, path);
      assert.equal(r.headers['access-control-allow-origin'], SITE, path);
      assert.equal(r.headers.vary, 'Origin');
    }
  });

  it('scenario: CORS / Private Network preflight from the overlay site', async () => {
    const r = await request(`${base}/health`, {
      method: 'OPTIONS',
      headers: { Origin: SITE, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Private-Network': 'true' },
    });
    assert.equal(r.status, 204);
    assert.equal(r.headers['access-control-allow-origin'], SITE);
    assert.equal(r.headers['access-control-allow-private-network'], 'true');
    assert.match(String(r.headers['access-control-allow-methods']), /GET/);
  });

  it('scenario: status page and local tools via localhost, 127.0.0.1 and [::1] names', async () => {
    const port = new URL(base).port;
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, `127.0.0.2:${port}`]) {
      const r = await request(`${base}/`, { headers: { Host: host } });
      assert.equal(r.status, 200, host);
    }
    const page = await request(`${base}/`);
    assert.match(String(page.headers['content-type']), /text\/html/);
    assert.equal(page.headers['x-frame-options'], 'DENY', 'status page cannot be framed by another site');
    // The status page's own WebSocket (same origin) works.
    const msgs = await wsOpen(`${wsBase}?source=*`, { Origin: base }, 3);
    assert.equal(msgs[0]?.type, 'hello');
  });

  it('scenario: local dev site (http://localhost:5173) is allowed', async () => {
    const msgs = await wsOpen(wsBase, { Origin: 'http://localhost:5173' });
    assert.equal(msgs[0]?.type, 'hello');
  });

  // ---- attacks that must fail
  it('attack: another website cannot open the WebSocket', async () => {
    await assert.rejects(wsOpen(wsBase, { Origin: EVIL }), /HTTP 403/);
    await assert.rejects(wsOpen(wsBase, { Origin: 'null' }), /HTTP 403/, 'sandboxed iframe / file:// origin');
    await assert.rejects(wsOpen(wsBase, { Origin: 'http://overlays.ramazansancar.com.tr' }), /HTTP 403/, 'http instead of https');
    await assert.rejects(wsOpen(wsBase, { Origin: 'https://overlays.ramazansancar.com.tr.evil.example' }), /HTTP 403/);
    await assert.rejects(wsOpen(wsBase, { Origin: 'https://localhost:5173' }), /HTTP 403/, 'different scheme than allowed');
  });

  it('attack: another website gets no data and no CORS headers (cannot even detect the server)', async () => {
    for (const path of ['/health', '/v1/state', '/v1/stream', '/v1/diagnostics']) {
      const r = await request(base + path, { headers: { Origin: EVIL } });
      assert.equal(r.status, 403, path);
      assert.equal(r.headers['access-control-allow-origin'], undefined, path);
      assert.ok(!/"lat"/.test(r.body), path);
    }
    const pre = await request(`${base}/health`, { method: 'OPTIONS', headers: { Origin: EVIL, 'Access-Control-Request-Method': 'GET' } });
    assert.equal(pre.status, 403);
    assert.equal(pre.headers['access-control-allow-origin'], undefined);
  });

  it('attack: DNS rebinding (attacker domain resolving to 127.0.0.1) is refused', async () => {
    const port = new URL(base).port;
    for (const host of [`evil.example:${port}`, `127.0.0.1.evil.example:${port}`, `localhost.evil.example:${port}`, `127.evil:${port}`]) {
      const r = await request(`${base}/v1/state`, { headers: { Host: host } });
      assert.equal(r.status, 421, host);
      await assert.rejects(wsOpen(wsBase, { Host: host }), /HTTP 421/, host);
    }
    // Same-origin request from the rebound page carries its own origin: still refused by Host.
    const r = await request(`${base}/v1/diagnostics`, { headers: { Host: `evil.example:${port}`, Origin: `http://evil.example:${port}` } });
    assert.equal(r.status, 421);
  });

  it('attack: missing Host header is refused', async () => {
    const port = Number(new URL(base).port);
    const raw = await new Promise<string>((resolve) => {
      const s = net.connect(port, '127.0.0.1', () => s.write('GET /v1/state HTTP/1.0\r\n\r\n'));
      let out = '';
      s.on('data', (c) => (out += c));
      s.on('end', () => resolve(out));
    });
    assert.match(raw, /^HTTP\/1\.1 421/);
  });

  it('attack: only GET/HEAD/OPTIONS; unknown paths and WebSocket paths are 404', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      assert.equal((await request(`${base}/v1/state`, { method })).status, 405, method);
    }
    assert.equal((await request(`${base}/../../etc/passwd`)).status, 404);
    assert.equal((await request(`${base}/%2e%2e/%2e%2e/windows/win.ini`)).status, 404);
    assert.equal((await request(`${base}/v1/stream?source=nope`)).status, 404);
    await assert.rejects(wsOpen(`${base.replace('http', 'ws')}/other`), /HTTP 404/);
    await assert.rejects(wsOpen(`${wsBase}?source=nope`), /HTTP 404/);
  });

  it('attack: oversized or garbage WebSocket messages close the socket, the server keeps running', async () => {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(wsBase);
      ws.on('open', () => {
        ws.send('{"not": "a command"}');
        ws.send(Buffer.alloc(16)); // binary garbage
        ws.send('x'.repeat(64 * 1024)); // over maxPayload (4 KB)
      });
      ws.on('close', (code) => {
        assert.equal(code, 1009, 'message too big');
        resolve();
      });
      ws.on('error', () => {});
    });
    assert.equal((await request(`${base}/health`)).status, 200);
  });

  it('attack: responses cannot be sniffed as another content type', async () => {
    const r = await request(`${base}/v1/state`);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['cache-control'], 'no-store');
  });
});

describe('security: token and LAN setup (e.g. Raspberry Pi)', () => {
  let server: RunningServer;
  let base: string;

  before(async () => {
    server = await startServer({
      config: parseConfig({
        host: '0.0.0.0',
        port: 0,
        token: 's3cret',
        logLevel: 'silent',
        rememberLastPosition: false,
        sources: [{ driver: 'simulator', options: { intervalMs: 100 } }],
      }),
      log: silentLogger,
    });
    base = server.url.replace('0.0.0.0', '127.0.0.1');
    await new Promise((r) => setTimeout(r, 250));
  });
  after(() => server.close());

  it('scenario: reachable by its LAN address (Host check off when not on loopback)', async () => {
    const port = new URL(base).port;
    const r = await request(`${base}/health`, { headers: { Host: `192.168.1.50:${port}` } });
    assert.equal(r.status, 200);
  });

  it('scenario: the overlay with the right token (query or Bearer) gets data', async () => {
    const wsUrl = `${base.replace('http', 'ws')}/v1/ws`;
    const msgs = await wsOpen(`${wsUrl}?token=s3cret`, { Origin: SITE }, 3);
    assert.equal(msgs[0]?.type, 'hello');
    assert.equal((await request(`${base}/v1/state`, { headers: { Authorization: 'Bearer s3cret' } })).status, 200);
  });

  it('attack: no token, wrong token, wrong length, token in the wrong header', async () => {
    const wsUrl = `${base.replace('http', 'ws')}/v1/ws`;
    await assert.rejects(wsOpen(wsUrl, { Origin: SITE }), /HTTP 401/);
    await assert.rejects(wsOpen(`${wsUrl}?token=s3creT`, { Origin: SITE }), /HTTP 401/);
    await assert.rejects(wsOpen(`${wsUrl}?token=s3cret-and-more`, { Origin: SITE }), /HTTP 401/);
    const wrongHeaders: Record<string, string>[] = [{}, { Authorization: 'Basic s3cret' }, { Authorization: 's3cret' }, { 'X-Token': 's3cret' }];
    for (const headers of wrongHeaders) {
      assert.equal((await request(`${base}/v1/state`, { headers })).status, 401, JSON.stringify(headers));
      assert.equal((await request(`${base}/v1/diagnostics`, { headers })).status, 401, JSON.stringify(headers));
    }
  });

  it('health and the status page stay open without a token but reveal no position or token', async () => {
    const health = await request(`${base}/health`);
    assert.equal(health.status, 200);
    assert.ok(!/"lat"|s3cret/.test(health.body));
    const page = await request(`${base}/`);
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes('s3cret'));
  });

  it('the diagnostics file never contains the token', async () => {
    const r = await request(`${base}/v1/diagnostics?token=s3cret&positions=1`);
    assert.equal(r.status, 200);
    assert.ok(!r.body.includes('s3cret'));
  });
});
