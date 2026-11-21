import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_PORT, findConfigFile, parseConfig, readConfigFile, userStatePath } from '../src/config.ts';
import { defineDriver } from '../src/core/driver.ts';
import { DriverRegistry } from '../src/core/registry.ts';
import { ConfigError, OptionReader } from '../src/lib/options.ts';

describe('parseConfig', () => {
  it('fills every default', () => {
    const c = parseConfig({});
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.port, DEFAULT_PORT);
    assert.deepEqual(c.allowedOrigins, DEFAULT_ALLOWED_ORIGINS);
    assert.equal(c.token, undefined);
    assert.equal(c.staleAfterMs, 5000);
    assert.equal(c.motionMaxHz, 10);
    assert.equal(c.logLevel, 'info');
    assert.equal(c.rememberLastPosition, true);
    assert.equal(c.stateFile, userStatePath());
    assert.deepEqual(c.sources, [{ id: 'ddpai', driver: 'ddpai', enabled: true, options: {} }]);
  });

  it('accepts numbers given as strings (env vars, CLI flags)', () => {
    assert.equal(parseConfig({ port: '4000' }).port, 4000);
  });

  it('rejects invalid values with a readable path', () => {
    const bad: [unknown, RegExp][] = [
      [{ port: 70000 }, /config\.port: must be <= 65535/],
      [{ port: 1.5 }, /config\.port: must be an integer/],
      [{ port: 'abc' }, /config\.port: must be a number/],
      [{ logLevel: 'loud' }, /config\.logLevel: must be one of/],
      [{ allowedOrigins: 'x' }, /config\.allowedOrigins: must be a list of strings/],
      [{ staleAfterMs: 10 }, /config\.staleAfterMs: must be >= 500/],
      [{ rememberLastPosition: 'yes' }, /must be true or false/],
      [{ sources: {} }, /config\.sources: must be a list/],
      [{ sources: [{}] }, /config\.sources\[0\]\.driver: required/],
      [{ sources: [{ driver: 'ddpai', id: 'has space' }] }, /letters, digits/],
      [{ sources: [{ driver: 'ddpai' }, { driver: 'ddpai' }] }, /"ddpai" is used twice/],
      [{ sources: [{ driver: 'ddpai', options: [] }] }, /options: must be an object/],
      ['not an object', /config: must be an object/],
    ];
    for (const [raw, message] of bad) assert.throws(() => parseConfig(raw), message, JSON.stringify(raw));
  });

  it('warns about unknown keys instead of failing', () => {
    const warnings: string[] = [];
    parseConfig({ prot: 1, $schema: 'x' }, (w) => warnings.push(w));
    assert.deepEqual(warnings, ['config: unknown key "prot" ignored']);
  });

  it('keeps a configured token and sources', () => {
    const c = parseConfig({ token: 't', sources: [{ id: 'a', driver: 'simulator', enabled: false, options: { speedKmh: 5 } }] });
    assert.equal(c.token, 't');
    assert.deepEqual(c.sources, [{ id: 'a', driver: 'simulator', enabled: false, options: { speedKmh: 5 } }]);
  });
});

describe('config files', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-cfg-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reads JSON with a UTF-8 BOM (Notepad) and reports broken JSON', () => {
    const bom = path.join(dir, 'bom.json');
    fs.writeFileSync(bom, '﻿{"port": 4001}');
    assert.deepEqual(readConfigFile(bom), { port: 4001 });
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, '{ "port": ');
    assert.throws(() => readConfigFile(broken), (e: Error) => e instanceof ConfigError && /is not valid JSON/.test(e.message));
    assert.throws(() => readConfigFile(path.join(dir, 'missing.json')), /cannot read/);
  });

  it('finds an explicit file, the env var file, then the working directory file', () => {
    const explicit = path.join(dir, 'explicit.json');
    fs.writeFileSync(explicit, '{}');
    assert.equal(findConfigFile(explicit), path.resolve(explicit));
    assert.throws(() => findConfigFile(path.join(dir, 'nope.json')), /config file not found/);

    const fromEnv = path.join(dir, 'env.json');
    fs.writeFileSync(fromEnv, '{}');
    const previous = process.env.OVERLAYS_SERVER_CONFIG;
    process.env.OVERLAYS_SERVER_CONFIG = fromEnv;
    try {
      assert.equal(findConfigFile(), fromEnv);
    } finally {
      if (previous === undefined) delete process.env.OVERLAYS_SERVER_CONFIG;
      else process.env.OVERLAYS_SERVER_CONFIG = previous;
    }
  });
});

describe('OptionReader', () => {
  it('validates types and tracks unknown keys', () => {
    const o = new OptionReader({ a: 'x', n: 5, b: true, list: ['p'], extra: 1 }, 'opts');
    assert.equal(o.string('a', ''), 'x');
    assert.equal(o.number('n', 0, { min: 1, max: 10 }), 5);
    assert.equal(o.boolean('b', false), true);
    assert.deepEqual(o.stringList('list', []), ['p']);
    assert.equal(o.string('missing', 'def'), 'def');
    assert.deepEqual(o.unknownKeys(), ['extra']);
    assert.throws(() => new OptionReader({ n: 'x' }, 'opts').number('n', 0), /opts\.n: must be a number/);
    assert.throws(() => new OptionReader({ s: 1 }, 'opts').string('s'), /opts\.s: must be a string/);
    assert.throws(() => new OptionReader([], 'opts'), /opts: must be an object/);
    assert.deepEqual(new OptionReader(null, 'opts').unknownKeys(), []);
  });
});

describe('DriverRegistry', () => {
  const driver = (id: string) =>
    defineDriver({ id, name: id, description: '', capabilities: ['gps'], parseOptions: () => ({}), create: () => ({ start() {}, stop() {} }) });

  it('registers, finds and lists drivers', () => {
    const r = new DriverRegistry([driver('a'), driver('b-2')]);
    assert.equal(r.get('a').id, 'a');
    assert.deepEqual(r.list().map((d) => d.id), ['a', 'b-2']);
  });

  it('rejects bad and duplicate ids and names the available drivers for unknown ones', () => {
    assert.throws(() => new DriverRegistry([driver('Bad Id')]), /invalid driver id/);
    assert.throws(() => new DriverRegistry([driver('a'), driver('a')]), /registered twice/);
    assert.throws(() => new DriverRegistry([driver('a')]).get('zzz'), (e: Error) => e instanceof ConfigError && /Available: a/.test(e.message));
  });
});
