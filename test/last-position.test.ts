import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import WebSocket from 'ws';
import { startFakeDdpai, type FakeDdpai } from '../scripts/lib/fake-ddpai.ts';
import { startServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { LastPositionStore } from '../src/core/last-position.ts';
import type { ServerMessage } from '../src/core/protocol.ts';
import { silentLogger } from '../src/lib/log.ts';

const ORIGIN = 'https://overlays.ramazansancar.com.tr';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function firstMessages(url: string, count: number): Promise<ServerMessage[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin: ORIGIN });
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
    ws.on('error', reject);
  });
}

describe('last known position (GPS lost, restarts)', () => {
  let dir: string;
  let stateFile: string;

  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-last-'));
    stateFile = path.join(dir, 'last-position.json');
  });

  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('the store survives a round trip and ignores a broken file', () => {
    const store = new LastPositionStore(stateFile, silentLogger);
    store.update('cam', { lat: 41.01, lon: 28.97, heading: 90, timestamp: 1000 }, 2000);
    store.stop();
    assert.deepEqual(new LastPositionStore(stateFile, silentLogger).load(), {
      cam: { fix: { lat: 41.01, lon: 28.97, heading: 90, timestamp: 1000 }, savedAt: 2000 },
    });
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{not json');
    assert.deepEqual(new LastPositionStore(broken, silentLogger).load(), {});
  });

  it('serves the remembered position, marked lastKnown, while the camera is unreachable', async () => {
    const config = parseConfig({
      port: 0,
      logLevel: 'silent',
      stateFile,
      // Nothing listens here: like a camera that is off / out of reach.
      sources: [{ id: 'cam', driver: 'ddpai', options: { host: '127.0.0.1', telemetryPort: 9, deviceInfo: false } }],
    });
    const server = await startServer({ config, log: silentLogger });
    try {
      const msgs = await firstMessages(`${server.url.replace('http', 'ws')}/v1/ws`, 3);
      const fix = msgs.find((m) => m.type === 'fix');
      assert.ok(fix?.type === 'fix', `got ${msgs.map((m) => m.type).join(',')}`);
      assert.equal(fix.lastKnown, true);
      assert.equal(fix.lat, 41.01);
      const status = msgs.find((m) => m.type === 'status');
      assert.ok(status?.type === 'status' && status.gps !== 'fix');
    } finally {
      await server.close();
    }
  });

  it('keeps serving the last position when the GPS loses its fix (tunnel), and remembers live fixes', async () => {
    const fake: FakeDdpai = await startFakeDdpai({ gpsIntervalMs: 100, gsensorIntervalMs: 50 });
    const config = parseConfig({
      port: 0,
      logLevel: 'silent',
      stateFile,
      sources: [{ id: 'cam', driver: 'ddpai', options: { host: '127.0.0.1', telemetryPort: fake.telemetryPort, httpPort: fake.httpPort } }],
    });
    const server = await startServer({ config, log: silentLogger });
    const wsUrl = `${server.url.replace('http', 'ws')}/v1/ws`;
    try {
      await wait(600);
      const live = (await firstMessages(wsUrl, 4)).find((m) => m.type === 'fix');
      assert.ok(live?.type === 'fix' && !live.lastKnown, 'live fix while the camera has a lock');
      assert.ok(Math.abs(live.lat - 39.92) < 0.01, 'live position, not the remembered one');

      fake.setNoFix(true); // entering the tunnel
      await wait(500);
      const inTunnel = await firstMessages(wsUrl, 4);
      const fix = inTunnel.find((m) => m.type === 'fix');
      assert.ok(fix?.type === 'fix' && fix.lastKnown === true, 'a client connecting in the tunnel still gets a position');
      assert.ok(Math.abs(fix.lat - 39.92) < 0.01);
      assert.ok(inTunnel.some((m) => m.type === 'status' && m.gps === 'no_fix'));
    } finally {
      await server.close();
      await fake.close();
    }
    const saved = new LastPositionStore(stateFile, silentLogger).load();
    assert.ok(Math.abs(saved.cam!.fix.lat - 39.92) < 0.01, 'the live position replaced the old one on disk');
  });

  it('rememberLastPosition: false keeps nothing', async () => {
    const off = path.join(dir, 'off.json');
    const server = await startServer({
      config: parseConfig({ port: 0, logLevel: 'silent', stateFile: off, rememberLastPosition: false, sources: [{ driver: 'simulator' }] }),
      log: silentLogger,
    });
    await wait(300);
    await server.close();
    assert.equal(fs.existsSync(off), false);
  });
});
