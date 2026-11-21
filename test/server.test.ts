import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { startFakeDdpai, type FakeDdpai } from '../scripts/lib/fake-ddpai.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import type { ServerMessage } from '../src/core/protocol.ts';
import { silentLogger } from '../src/lib/log.ts';

const ORIGIN = 'https://overlays.ramazansancar.com.tr';

/** Collects WebSocket messages until `done` returns true. */
function collect(url: string, origin: string | undefined, done: (msgs: ServerMessage[]) => boolean, timeoutMs = 4000) {
  return new Promise<ServerMessage[]>((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : {});
    const msgs: ServerMessage[] = [];
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`timeout, got: ${msgs.map((m) => m.type).join(',')}`));
    }, timeoutMs);
    ws.on('message', (data) => {
      msgs.push(JSON.parse(String(data)) as ServerMessage);
      if (done(msgs)) {
        clearTimeout(timer);
        ws.close();
        resolve(msgs);
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function get(url: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      })
      .on('error', reject);
  });
}

describe('server with a fake DDPAI camera', () => {
  let fake: FakeDdpai;
  let server: RunningServer;
  let wsUrl: string;

  before(async () => {
    fake = await startFakeDdpai({ gpsIntervalMs: 100, gsensorIntervalMs: 20, eventIntervalMs: 150 });
    const config = parseConfig({
      port: 0,
      logLevel: 'silent',
      rememberLastPosition: false,
      sources: [
        {
          id: 'cam',
          driver: 'ddpai',
          options: { host: '127.0.0.1', telemetryPort: fake.telemetryPort, httpPort: fake.httpPort },
        },
      ],
    });
    server = await startServer({ config, log: silentLogger });
    wsUrl = `${server.url.replace('http', 'ws')}/v1/ws`;
  });

  after(async () => {
    await server.close();
    await fake.close();
  });

  it('streams hello, status and fixes over WebSocket', async () => {
    const msgs = await collect(wsUrl, ORIGIN, (m) => m.filter((x) => x.type === 'fix').length >= 2);
    assert.equal(msgs[0]?.type, 'hello');
    const fix = msgs.find((m) => m.type === 'fix');
    assert.ok(fix && fix.type === 'fix');
    assert.equal(fix.source, 'cam');
    assert.ok(Math.abs(fix.lat - 39.92) < 0.01 && Math.abs(fix.lon - 32.85) < 0.01);
    assert.ok(fix.speed! > 9 && fix.speed! < 11, `speed ${fix.speed} m/s`);
    assert.ok(msgs.some((m) => m.type === 'status' && m.link === 'online'));
  });

  it('reports full device info without any secret', async () => {
    const msgs = await collect(wsUrl, ORIGIN, (m) => m.some((x) => x.type === 'status' && x.device !== undefined));
    const status = msgs.find((m) => m.type === 'status' && m.device);
    const device = status?.type === 'status' ? status.device : undefined;
    assert.equal(device?.model, 'FAKE_Model');
    assert.equal(device?.firmware, 'v0.0.0.1');
    assert.equal(device?.cameras, 2);
    assert.equal(device?.streams?.[1]?.url, 'rtsp://127.0.0.1:554/liveRTSP/av5');
    assert.ok(device?.storage && device.storage.freeBytes < device.storage.totalBytes);
    assert.equal(device?.details?.adas_type, 2);
    assert.ok(!JSON.stringify(msgs).includes('do-not-leak'));
  });

  it('passes unknown device messages through as events when asked', async () => {
    const msgs = await collect(`${wsUrl}?events=1`, ORIGIN, (m) => m.some((x) => x.type === 'event'));
    const event = msgs.find((m) => m.type === 'event');
    assert.ok(event?.type === 'event' && event.name === 'MSG_FakeEvent' && event.source === 'cam');
    assert.equal((event.data as { note: string }).note, 'not a real DDPAI message');
    const plain = await collect(wsUrl, ORIGIN, (m) => m.filter((x) => x.type === 'fix').length >= 4);
    assert.ok(!plain.some((m) => m.type === 'event'), 'no events without ?events=1');
  });

  it('?all=1 sends motion and events', async () => {
    const msgs = await collect(`${wsUrl}?all=1`, ORIGIN, (m) => m.some((x) => x.type === 'event') && m.some((x) => x.type === 'motion'));
    assert.ok(msgs.length > 0);
  });

  it('sends motion only when asked, throttled', async () => {
    const msgs = await collect(`${wsUrl}?motion=1`, ORIGIN, (m) => m.filter((x) => x.type === 'motion').length >= 3);
    const motion = msgs.find((m) => m.type === 'motion');
    assert.ok(motion && motion.type === 'motion' && motion.z === 1.054);
    const plain = await collect(wsUrl, ORIGIN, (m) => m.filter((x) => x.type === 'fix').length >= 3);
    assert.ok(!plain.some((m) => m.type === 'motion'));
  });

  it('refuses WebSockets from other origins', async () => {
    await assert.rejects(collect(wsUrl, 'https://evil.example', () => true), /403/);
  });

  it('serves state, health, SSE and the status page', async () => {
    const state = await get(`${server.url}/v1/state`, { Origin: ORIGIN });
    assert.equal(state.status, 200);
    assert.equal(state.headers['access-control-allow-origin'], ORIGIN);
    const body = JSON.parse(state.body) as { activeSource: string; sources: { id: string }[] };
    assert.equal(body.activeSource, 'cam');
    assert.ok(!state.body.includes('do-not-leak'));

    assert.equal((await get(`${server.url}/health`)).status, 200);
    assert.equal((await get(`${server.url}/v1/state`, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await get(`${server.url}/v1/state`, { Host: 'evil.example' })).status, 421);
    assert.match((await get(`${server.url}/`)).body, /overlays-server/);

    const sse = await new Promise<string>((resolve, reject) => {
      const req = http.get(`${server.url}/v1/stream`, { headers: { Origin: ORIGIN } }, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream; charset=utf-8');
        let text = '';
        res.on('data', (c) => {
          text += c;
          if (text.includes('event: fix')) {
            req.destroy();
            resolve(text);
          }
        });
      });
      req.on('error', reject);
    });
    assert.match(sse, /event: hello/);
  });

  it('reconnects after the camera drops the connection', async () => {
    fake.dropClients();
    const msgs = await collect(
      wsUrl,
      ORIGIN,
      (m) => {
        const offline = m.findIndex((x) => x.type === 'status' && x.link !== 'online');
        return offline !== -1 && m.slice(offline).some((x) => x.type === 'fix');
      },
      8000,
    );
    assert.ok(msgs.length > 0);
  });

  it('reports no_fix while the camera has no satellite lock', async () => {
    fake.setNoFix(true);
    try {
      const msgs = await collect(wsUrl, ORIGIN, (m) => m.some((x) => x.type === 'status' && x.gps === 'no_fix'));
      const status = msgs.findLast((m) => m.type === 'status');
      assert.ok(status?.type === 'status' && status.satellites === 3);
    } finally {
      fake.setNoFix(false);
    }
  });
});
