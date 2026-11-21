import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { defineDriver } from '../src/core/driver.ts';
import { BUILTIN_DRIVERS } from '../src/drivers/index.ts';
import { createLogger, silentLogger, type LogSink } from '../src/lib/log.ts';

const base = { port: 0, logLevel: 'silent', rememberLastPosition: false };

describe('startServer', () => {
  it('a driver that throws on start does not take the server down; its status says why', async () => {
    const broken = defineDriver({
      id: 'broken',
      name: 'Broken',
      description: '',
      capabilities: ['gps'],
      parseOptions: () => ({}),
      create: () => ({
        start() {
          throw new Error('device exploded');
        },
        stop() {},
      }),
    });
    const server = await startServer({
      config: parseConfig({ ...base, sources: [{ id: 'bad', driver: 'broken' }, { id: 'sim', driver: 'simulator', options: { intervalMs: 100 } }] }),
      drivers: [...BUILTIN_DRIVERS, broken],
      log: silentLogger,
    });
    try {
      await new Promise((r) => setTimeout(r, 250));
      const state = (await (await fetch(`${server.url}/v1/state`)).json()) as { activeSource: string; sources: { id: string; status: { link: string; message?: string } }[] };
      const bad = state.sources.find((s) => s.id === 'bad')!;
      assert.equal(bad.status.link, 'offline');
      assert.match(bad.status.message!, /failed to start: device exploded/);
      assert.equal(state.activeSource, 'sim', 'the working source takes over');
    } finally {
      await server.close();
    }
  });

  it('runs third-party drivers given through the API', async () => {
    const custom = defineDriver({
      id: 'my-gps',
      name: 'My GPS',
      description: '',
      capabilities: ['gps'],
      parseOptions: (o) => ({ lat: o.number('lat', 0) }),
      create: (ctx, o) => ({
        start() {
          ctx.publishFix({ lat: o.lat, lon: 29, speed: 1, timestamp: Date.now() });
        },
        stop() {},
      }),
    });
    const server = await startServer({ config: parseConfig({ ...base, sources: [{ driver: 'my-gps', options: { lat: 41 } }] }), drivers: [custom], log: silentLogger });
    try {
      const state = (await (await fetch(`${server.url}/v1/state`)).json()) as { sources: { lastFix: { lat: number } }[] };
      assert.equal(state.sources[0]!.lastFix.lat, 41);
    } finally {
      await server.close();
    }
  });

  it('validates the whole config before opening a port', async () => {
    await assert.rejects(startServer({ config: parseConfig({ ...base, sources: [{ driver: 'nope' }] }), log: silentLogger }), /unknown driver "nope"/);
    await assert.rejects(
      startServer({ config: parseConfig({ ...base, sources: [{ driver: 'ddpai', options: { telemetryPort: 99999 } }] }), log: silentLogger }),
      /sources\.ddpai\.options\.telemetryPort: must be <= 65535/,
    );
  });

  it('warns about unknown driver options and an empty source list, and skips disabled sources', async () => {
    const lines: string[] = [];
    const sink: LogSink = (_l, line) => lines.push(line);
    const s1 = await startServer({ config: parseConfig({ ...base, sources: [{ driver: 'simulator', options: { sped: 5 } }] }), log: createLogger('warn', sink) });
    await s1.close();
    assert.ok(lines.some((l) => /unknown key "sped"/.test(l)));
    const s2 = await startServer({ config: parseConfig({ ...base, sources: [{ driver: 'simulator', enabled: false }] }), log: createLogger('warn', sink) });
    const state = (await (await fetch(`${s2.url}/v1/state`)).json()) as { sources: unknown[] };
    await s2.close();
    assert.deepEqual(state.sources, []);
    assert.ok(lines.some((l) => /no enabled sources/.test(l)));
  });

  it('close() is idempotent', async () => {
    const server = await startServer({ config: parseConfig({ ...base, sources: [{ driver: 'simulator' }] }), log: silentLogger });
    await Promise.all([server.close(), server.close()]);
    await server.close();
  });
});
