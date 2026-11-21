import assert from 'node:assert/strict';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import type { SourceContext } from '../src/core/driver.ts';
import { Hub } from '../src/core/hub.ts';
import { ddpaiCommand, fetchDeviceInfo } from '../src/drivers/ddpai/http-api.ts';
import { simulatorDriver } from '../src/drivers/simulator.ts';
import { createLogger, LogBuffer, recordingLogger, silentLogger, type LogSink } from '../src/lib/log.ts';
import { OptionReader } from '../src/lib/options.ts';
import { ReconnectingTcpClient } from '../src/lib/reconnecting-tcp.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('logger', () => {
  it('filters by level, prefixes scopes and passes details', () => {
    const lines: [string, string, unknown[]][] = [];
    const sink: LogSink = (level, line, details) => lines.push([level, line, details]);
    const log = createLogger('info', sink);
    log.debug('hidden');
    log.info('shown', { a: 1 });
    log.child('ddpai').child('http').warn('scoped');
    assert.equal(lines.length, 2);
    assert.match(lines[0]![1], /INFO  shown$/);
    assert.deepEqual(lines[0]![2], [{ a: 1 }]);
    assert.match(lines[1]![1], /WARN  \[ddpai:http\] scoped$/);
  });

  it('LogBuffer keeps the last N lines; recordingLogger records even below the console level', () => {
    const buffer = new LogBuffer(3);
    const log = recordingLogger(createLogger('silent'), buffer);
    log.debug('one');
    log.child('x').info('two', { k: 'v' });
    log.warn('three', new Error('boom'));
    log.error('four');
    const lines = buffer.snapshot();
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /INFO  \[x\] two \{"k":"v"\}$/);
    assert.match(lines[1]!, /WARN  three boom$/);
    assert.match(lines[2]!, /ERROR four$/);
  });
});

/** A context that records what a source publishes. */
function recordingContext() {
  const hub = new Hub();
  const ctx: SourceContext = hub.register({ id: 's', driver: 'simulator', driverName: 'Simulator', capabilities: ['gps', 'motion'] });
  const motion: unknown[] = [];
  hub.subscribe((e) => e.kind === 'motion' && motion.push(e.sample));
  return { hub, ctx, motion };
}

describe('simulator driver', () => {
  it('drives in a circle at the configured speed', async () => {
    const { hub, ctx } = recordingContext();
    const options = simulatorDriver.parseOptions(new OptionReader({ intervalMs: 50, speedKmh: 36, radiusM: 100 }, 'o'));
    const source = simulatorDriver.create(ctx, options);
    source.start();
    await wait(130);
    source.stop();
    const fix = hub.snapshot('s')!.lastFix!;
    assert.equal(fix.speed, 10);
    assert.ok(fix.heading! >= 0 && fix.heading! < 360);
    const distanceFromCenter = Math.hypot((fix.lat - 39.92077) * 111_320, (fix.lon - 32.85411) * 111_320 * Math.cos((39.92077 * Math.PI) / 180));
    assert.ok(Math.abs(distanceFromCenter - 100) < 2, `radius ${distanceFromCenter}`);
  });

  it('reports no fix first when asked, and publishes motion when enabled', async () => {
    const { hub, ctx, motion } = recordingContext();
    const options = simulatorDriver.parseOptions(new OptionReader({ intervalMs: 50, noFixSeconds: 60, motion: true }, 'o'));
    const source = simulatorDriver.create(ctx, options);
    source.start();
    await wait(80);
    source.stop();
    assert.equal(hub.snapshot('s')!.status.gps, 'no_fix');
    assert.equal(hub.snapshot('s')!.status.satellites, 3);
    assert.equal(motion.length, 0, 'no motion before the first fix');

    const moving = recordingContext();
    const s2 = simulatorDriver.create(moving.ctx, simulatorDriver.parseOptions(new OptionReader({ intervalMs: 50, motion: true }, 'o')));
    s2.start();
    await wait(80);
    s2.stop();
    assert.ok(moving.motion.length > 0);
  });

  it('validates its options', () => {
    assert.throws(() => simulatorDriver.parseOptions(new OptionReader({ lat: 100 }, 'o')), /o\.lat: must be <= 90/);
    assert.throws(() => simulatorDriver.parseOptions(new OptionReader({ intervalMs: 1 }, 'o')), /o\.intervalMs: must be >= 50/);
  });
});

/** Tiny HTTP server answering every request with `handler`. */
async function httpServer(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('DDPAI HTTP API client', () => {
  it('unwraps the JSON-in-a-string reply and keeps non-JSON data as is', async () => {
    const s = await httpServer((req, res) => {
      const cmd = new URL(req.url!, 'http://x').searchParams.get('cmd');
      res.end(JSON.stringify({ errcode: 0, data: cmd === 'A' ? JSON.stringify({ x: 1 }) : 'plain text' }));
    });
    try {
      assert.deepEqual(await ddpaiCommand('127.0.0.1', s.port, 'A'), { x: 1 });
      assert.equal(await ddpaiCommand('127.0.0.1', s.port, 'B'), 'plain text');
    } finally {
      await s.close();
    }
  });

  it('turns HTTP errors, non-JSON replies and errcodes into errors', async () => {
    const s = await httpServer((req, res) => {
      const cmd = new URL(req.url!, 'http://x').searchParams.get('cmd');
      if (cmd === 'http500') {
        res.statusCode = 500;
        return res.end('x');
      }
      if (cmd === 'html') return res.end('<html>');
      res.end(JSON.stringify({ errcode: 1996488764, data: [] }));
    });
    try {
      await assert.rejects(ddpaiCommand('127.0.0.1', s.port, 'http500'), /http500: HTTP 500/);
      await assert.rejects(ddpaiCommand('127.0.0.1', s.port, 'html'), /reply is not JSON/);
      await assert.rejects(ddpaiCommand('127.0.0.1', s.port, 'X'), /errcode 1996488764/);
    } finally {
      await s.close();
    }
  });

  it('times out on a camera that never answers', async () => {
    const hang = net.createServer(() => {});
    await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r));
    const port = (hang.address() as AddressInfo).port;
    try {
      await assert.rejects(fetchDeviceInfo({ host: '127.0.0.1', httpPort: port, rtspPort: 554, timeoutMs: 200 }), /aborted|timeout/i);
    } finally {
      hang.close();
    }
  });
});

describe('ReconnectingTcpClient', () => {
  it('reconnects after a drop and after an idle stream, and stops for good', async () => {
    let connections = 0;
    const server = net.createServer((socket) => {
      connections++;
      if (connections === 1) socket.destroy(); // drop the first one at once
      // later ones stay silent: the idle timeout must recycle them
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const reasons: string[] = [];
    const client = new ReconnectingTcpClient({
      host: '127.0.0.1',
      port,
      idleTimeoutMs: 150,
      minRetryMs: 30,
      maxRetryMs: 60,
      log: silentLogger,
      onData: () => {},
      onDisconnect: (reason) => reasons.push(reason),
    });
    client.start();
    await wait(600);
    client.stop();
    const after = connections;
    await wait(200);
    server.close();
    assert.ok(after >= 3, `connections ${after}`);
    assert.equal(connections, after, 'no reconnect after stop()');
    assert.ok(reasons.some((r) => /no data for 150 ms/.test(r)), reasons.join(' | '));
  });

  it('backs off while the device is unreachable', async () => {
    const attempts: number[] = [];
    const client = new ReconnectingTcpClient({
      host: '127.0.0.1',
      port: 9, // nothing listens
      minRetryMs: 40,
      maxRetryMs: 160,
      log: silentLogger,
      onData: () => {},
      onDisconnect: () => attempts.push(Date.now()),
    });
    client.start();
    await wait(700);
    client.stop();
    assert.ok(attempts.length >= 3);
    const gaps = attempts.slice(1).map((t, i) => t - attempts[i]!);
    assert.ok(gaps.at(-1)! >= gaps[0]!, `gaps grow: ${gaps.join(',')}`);
  });
});
