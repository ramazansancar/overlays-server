import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { startFakeDdpai, type FakeDdpai } from '../scripts/lib/fake-ddpai.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import type { ServerMessage } from '../src/core/protocol.ts';
import { silentLogger } from '../src/lib/log.ts';
import { redact } from '../src/lib/redact.ts';

const ORIGIN = 'https://overlays.ramazansancar.com.tr';

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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('diagnostics, health and the all-sources stream', () => {
  let fake: FakeDdpai;
  let server: RunningServer;

  before(async () => {
    fake = await startFakeDdpai({ gpsIntervalMs: 100, gsensorIntervalMs: 20 });
    const config = parseConfig({
      port: 0,
      logLevel: 'silent',
      token: 'tok',
      sources: [
        { id: 'cam', driver: 'ddpai', options: { host: '127.0.0.1', telemetryPort: fake.telemetryPort, httpPort: fake.httpPort } },
        { id: 'sim', driver: 'simulator', options: { intervalMs: 100 } },
      ],
    });
    server = await startServer({ config, log: silentLogger });
    await wait(600);
  });

  after(async () => {
    await server.close();
    await fake.close();
  });

  it('/health answers without a token and carries no position', async () => {
    const res = await get(`${server.url}/health`, { Origin: ORIGIN });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as { ok: boolean; protocol: number; sources: { id: string; link: string }[] };
    assert.equal(body.ok, true);
    assert.equal(body.protocol, 1);
    assert.deepEqual(body.sources.map((s) => s.id), ['cam', 'sim']);
    assert.ok(!/"lat"|"lon"/.test(res.body));
  });

  it('diagnostics need the token, mask positions and secrets by default', async () => {
    assert.equal((await get(`${server.url}/v1/diagnostics`)).status, 401);
    const res = await get(`${server.url}/v1/diagnostics?token=tok`);
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-disposition']), /attachment; filename="overlays-server-diagnostics-\d{8}-\d{6}\.json"/);
    const d = JSON.parse(res.body) as {
      format: number;
      positionsIncluded: boolean;
      config: { token: string };
      sources: { id: string; recentFrames: { t: number; frame: string }[]; lastFix?: { lat: unknown } }[];
      logs: string[];
    };
    assert.equal(d.format, 1);
    assert.equal(d.positionsIncluded, false);
    assert.equal(d.config.token, 'REDACTED');
    const cam = d.sources.find((s) => s.id === 'cam')!;
    assert.ok(cam.recentFrames.length > 5, 'raw frames recorded');
    assert.ok(cam.recentFrames.some((f) => f.frame.includes('xxxx.xxxx,N')), 'NMEA positions masked');
    assert.equal(cam.lastFix?.lat, 'x');
    assert.ok(d.logs.some((l) => l.includes('link online')), 'log lines included');
    assert.ok(!res.body.includes('do-not-leak'), 'no device secrets');
  });

  it('diagnostics keep positions when asked, never secrets', async () => {
    const res = await get(`${server.url}/v1/diagnostics?token=tok&positions=1`);
    const d = JSON.parse(res.body) as { positionsIncluded: boolean; sources: { id: string; lastFix?: { lat: unknown } }[] };
    assert.equal(d.positionsIncluded, true);
    assert.equal(typeof d.sources.find((s) => s.id === 'cam')?.lastFix?.lat, 'number');
    assert.ok(!res.body.includes('do-not-leak'));
    assert.ok(!res.body.includes('"tok"'), 'token not in the file');
  });

  it('source=* streams fixes of every source (status page)', async () => {
    const msgs = await new Promise<ServerMessage[]>((resolve, reject) => {
      const ws = new WebSocket(`${server.url.replace('http', 'ws')}/v1/ws?source=*&token=tok`, { origin: ORIGIN });
      const got: ServerMessage[] = [];
      const timer = setTimeout(() => reject(new Error('timeout')), 4000);
      ws.on('message', (data) => {
        got.push(JSON.parse(String(data)) as ServerMessage);
        const sources = new Set(got.filter((m) => m.type === 'fix').map((m) => (m as { source: string }).source));
        if (sources.has('cam') && sources.has('sim')) {
          clearTimeout(timer);
          ws.close();
          resolve(got);
        }
      });
      ws.on('error', reject);
    });
    const status = msgs.find((m) => m.type === 'status');
    assert.ok(status?.type === 'status' && typeof status.driverName === 'string');
  });

  it('the fake camera replays recorded frames', async () => {
    const res = await get(`${server.url}/v1/diagnostics?token=tok&positions=1`);
    const frames = (JSON.parse(res.body) as { sources: { id: string; recentFrames: { t: number; frame: string }[] }[] }).sources.find(
      (s) => s.id === 'cam',
    )!.recentFrames;
    const replayCam = await startFakeDdpai({ replay: frames });
    const replayServer = await startServer({
      config: parseConfig({
        port: 0,
        logLevel: 'silent',
        sources: [{ id: 'replay', driver: 'ddpai', options: { host: '127.0.0.1', telemetryPort: replayCam.telemetryPort, deviceInfo: false } }],
      }),
      log: silentLogger,
    });
    try {
      await wait(1200);
      const state = JSON.parse((await get(`${replayServer.url}/v1/state`)).body) as { sources: { status: { gps: string } }[] };
      assert.equal(state.sources[0]?.status.gps, 'fix');
    } finally {
      await replayServer.close();
      await replayCam.close();
    }
  });
});

describe('replay of a file without positions', () => {
  it('rebuilds a track from speed and course so every GPS frame parses again', async () => {
    const { fillMaskedPositions } = await import('../scripts/lib/replay.ts');
    const { gpsFrame } = await import('../scripts/lib/fake-ddpai.ts');
    const { decodeDdpaiFrame, gpsMessageToFix } = await import('../src/drivers/ddpai/messages.ts');
    const t0 = Date.UTC(2026, 10, 21, 10, 0, 0);
    // Northbound at 36 km/h (19.44 kn), one fix per second, then masked like a diagnostics download.
    const recorded = [0, 1, 2].map((i) => ({
      t: t0 + i * 1000,
      frame: redact(gpsFrame(new Date(t0 + i * 1000), { lat: 41, lon: 29 + i * 0.0001, knots: 19.44, course: 0 })),
    }));
    assert.ok(recorded.every((f) => f.frame.includes('xxxx')));
    const { frames, synthesized } = fillMaskedPositions(recorded);
    assert.equal(synthesized, 3);
    const fixes = frames.map((f) => gpsMessageToFix(decodeDdpaiFrame(f.frame) as Parameters<typeof gpsMessageToFix>[0]));
    assert.ok(fixes.every((x) => x !== undefined), 'all frames parse (checksums recomputed)');
    assert.ok(Math.abs(fixes[0]!.lat - 39.92077) < 0.001, 'starts at the neutral point, not the recorded place');
    const moved = (fixes[2]!.lat - fixes[0]!.lat) * 111_320;
    assert.ok(moved > 18 && moved < 22, `moved ~20 m north in 2 s at 36 km/h, got ${moved.toFixed(1)}`);
    assert.ok(Math.abs(fixes[1]!.speed! - 10) < 0.05);
  });
});

describe('redact keepPositions', () => {
  it('keeps coordinates but still removes secrets', () => {
    const text = '{"lat":39.9,"password":"p"} $GPRMC,1,A,3955.0000,N,03250.0000,E';
    const out = redact(text, { keepPositions: true });
    assert.ok(out.includes('39.9') && out.includes('3955.0000,N'));
    assert.ok(!out.includes('"p"'));
  });
});
