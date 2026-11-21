import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { startFakeDdpai } from '../scripts/lib/fake-ddpai.ts';
import { startServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { LogFile, logFileName } from '../src/lib/log-file.ts';
import { createLogger, recordingLogger, silentLogger } from '../src/lib/log.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('log files', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-logs-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const sub = (name: string) => path.join(dir, name);
  const read = (folder: string, day: Date) => fs.readFileSync(path.join(folder, logFileName(day)), 'utf8');

  it('writes every level (debug too) with the scope, one file per day', () => {
    const folder = sub('levels');
    const day = new Date(2026, 10, 21, 16, 33, 30, 5);
    const file = new LogFile({ dir: folder, keepDays: 14, now: () => day });
    const log = recordingLogger(silentLogger, file).child('http');
    log.debug('websocket error: x');
    log.info('overlay connected', { origin: 'https://example.com' });
    const text = read(folder, day);
    assert.match(text, /^16:33:30\.005 DEBUG \[http\] websocket error: x$/m);
    assert.match(text, /^16:33:30\.005 INFO {2}\[http\] overlay connected \{"origin":"https:\/\/example.com"\}$/m);
    assert.equal(file.path, path.join(folder, 'overlays-server-2026-11-21.log'));
  });

  it('masks positions, secrets, MACs and the home folder', () => {
    const folder = sub('mask');
    const day = new Date(2026, 10, 21, 12);
    const file = new LogFile({ dir: folder, keepDays: 14, now: () => day });
    file.push('debug', '{"msgid":"MSG_X","data":"{\\"lat\\":39.92,\\"lon\\":32.85,\\"ssid\\":\\"MyWifi\\",\\"mac\\":\\"aa:bb:cc:dd:ee:ff\\"}"}');
    file.push('info', `config: ${path.join(os.homedir(), 'AppData', 'overlays-server', 'config.json')}`);
    const text = read(folder, day);
    for (const secret of ['39.92', '32.85', 'MyWifi', 'aa:bb:cc:dd:ee:ff']) assert.ok(!text.includes(secret), secret);
    assert.ok(!text.toLowerCase().includes(os.homedir().toLowerCase()), 'home folder masked');
    assert.match(text, /config: ~[\\/]AppData/);
  });

  it('starts a new file after midnight and deletes files older than keepDays', () => {
    const folder = sub('rotate');
    fs.mkdirSync(folder, { recursive: true });
    for (const name of ['overlays-server-2026-11-01.log', 'overlays-server-2026-11-19.log', 'notes.txt']) {
      fs.writeFileSync(path.join(folder, name), 'old\n');
    }
    let now = new Date(2026, 10, 21, 23, 59, 59);
    const file = new LogFile({ dir: folder, keepDays: 3, now: () => now });
    file.push('info', 'before midnight');
    now = new Date(2026, 10, 22, 0, 0, 1);
    file.push('info', 'after midnight');
    assert.match(read(folder, new Date(2026, 10, 21)), /before midnight/);
    assert.match(read(folder, new Date(2026, 10, 22)), /after midnight/);
    // keepDays 3 on the 22nd: the 20th to the 22nd stay.
    assert.deepEqual(fs.readdirSync(folder).sort(), ['notes.txt', 'overlays-server-2026-11-21.log', 'overlays-server-2026-11-22.log']);
  });

  it('stops at the daily size limit and says so once', () => {
    const folder = sub('limit');
    const day = new Date(2026, 10, 21, 12);
    const file = new LogFile({ dir: folder, keepDays: 14, maxBytesPerDay: 200, now: () => day });
    for (let i = 0; i < 20; i++) file.push('debug', `line ${i} ${'x'.repeat(20)}`);
    const text = read(folder, day);
    assert.ok(Buffer.byteLength(text) < 300, `${Buffer.byteLength(text)} bytes`);
    assert.equal(text.match(/size limit reached/g)?.length, 1);
  });

  it('keeps running when the folder cannot be written, and reports it once', () => {
    const blocker = sub('not-a-folder');
    fs.writeFileSync(blocker, 'file in the way');
    const errors: string[] = [];
    const file = new LogFile({ dir: path.join(blocker, 'logs'), keepDays: 14, onError: (m) => errors.push(m) });
    file.push('info', 'a');
    file.push('info', 'b');
    assert.equal(errors.length, 1);
    assert.match(errors[0]!, /cannot write the log file/);
  });

  it('ddpai: unknown message types reach the log with their distinct payloads, a few per type', async () => {
    const state = (n: number) => JSON.stringify({ msgid: 'MSG_StateReport', data: JSON.stringify({ state: n }) });
    const frames = [state(1), state(1), state(2), state(3), state(2)].map((frame, i) => ({ t: i * 20, frame }));
    const camera = await startFakeDdpai({ replay: frames });
    const lines: string[] = [];
    const server = await startServer({
      config: parseConfig({
        port: 0,
        rememberLastPosition: false,
        sources: [{ id: 'cam', driver: 'ddpai', options: { host: '127.0.0.1', telemetryPort: camera.telemetryPort, deviceInfo: false } }],
      }),
      log: createLogger('debug', (_level, line) => lines.push(line)),
    });
    try {
      await wait(700);
    } finally {
      await server.close();
      await camera.close();
    }
    assert.equal(lines.filter((l) => /new message type MSG_StateReport/.test(l)).length, 1, lines.join('\n'));
    const samples = lines.filter((l) => /MSG_StateReport sample/.test(l));
    assert.equal(samples.length, 3, samples.join('\n'));
    assert.match(samples[2]!, /sample 3\/20: .*\\"state\\":3/);
  });
});
