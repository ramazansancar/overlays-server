import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hub, normalizeFix, type HubEvent } from '../src/core/hub.ts';

const info = (id: string) => ({ id, driver: 'test', driverName: 'Test', capabilities: ['gps'] as const });

describe('Hub', () => {
  it('tracks link and gps state and fans out fixes', () => {
    const hub = new Hub();
    const events: HubEvent[] = [];
    hub.subscribe((e) => events.push(e));
    const ctx = hub.register(info('a'));
    ctx.setLink('online');
    ctx.publishNoFix({ satellites: 3 });
    assert.equal(hub.snapshot('a')?.status.gps, 'no_fix');
    assert.equal(hub.snapshot('a')?.status.satellites, 3);
    ctx.publishFix({ lat: 39.9, lon: 32.8, speed: 10, heading: 90, timestamp: 1 });
    const snap = hub.snapshot('a')!;
    assert.equal(snap.status.gps, 'fix');
    assert.equal(snap.active, true);
    const fix = events.find((e) => e.kind === 'fix');
    assert.ok(fix && fix.kind === 'fix' && fix.active);
  });

  it('goes stale when fixes stop', () => {
    let now = 0;
    const hub = new Hub({ staleAfterMs: 1000, now: () => now });
    const ctx = hub.register(info('a'));
    ctx.publishFix({ lat: 1, lon: 1, timestamp: 0 });
    now = 2000;
    (hub as unknown as { checkStale(): void }).checkStale();
    assert.equal(hub.snapshot('a')?.status.gps, 'stale');
  });

  it('marks gps stale when the link drops', () => {
    const hub = new Hub();
    const ctx = hub.register(info('a'));
    ctx.publishFix({ lat: 1, lon: 1, timestamp: 0 });
    ctx.setLink('offline', 'gone');
    assert.deepEqual([hub.snapshot('a')?.status.link, hub.snapshot('a')?.status.gps], ['offline', 'stale']);
    assert.equal(hub.snapshot('a')?.status.message, 'gone');
  });

  it('fails over to the next GPS source by priority', () => {
    const hub = new Hub({ gpsPriority: ['cam', 'backup'] });
    const backup = hub.register(info('backup'));
    const cam = hub.register(info('cam'));
    backup.publishFix({ lat: 1, lon: 1, timestamp: 0 });
    assert.equal(hub.activeGpsSource, 'backup');
    cam.publishFix({ lat: 2, lon: 2, timestamp: 0 });
    assert.equal(hub.activeGpsSource, 'cam', 'preferred source takes over');
    cam.setLink('offline');
    assert.equal(hub.activeGpsSource, 'backup', 'falls back while cam is down');
  });

  it('ignores writes after stop', () => {
    const hub = new Hub();
    const ctx = hub.register(info('a'));
    hub.stop();
    ctx.publishFix({ lat: 1, lon: 1, timestamp: 0 });
    assert.equal(hub.snapshot('a')?.lastFix, undefined);
    assert.equal(ctx.signal.aborted, true);
  });
});

describe('normalizeFix', () => {
  it('rejects impossible positions', () => {
    assert.equal(normalizeFix({ lat: 91, lon: 0, timestamp: 0 }), undefined);
    assert.equal(normalizeFix({ lat: 0, lon: 0, timestamp: 0 }), undefined);
    assert.equal(normalizeFix({ lat: Number.NaN, lon: 1, timestamp: 0 }), undefined);
  });

  it('drops heading while standing still and rounds', () => {
    const still = normalizeFix({ lat: 39.123456789, lon: 32.1, speed: 0.1, heading: 56.67, timestamp: 0 })!;
    assert.equal(still.heading, undefined);
    assert.equal(still.lat, 39.1234568);
    const moving = normalizeFix({ lat: 1, lon: 1, speed: 5, heading: -10, timestamp: 0 })!;
    assert.equal(moving.heading, 350);
  });
});
