/**
 * The command line as users run it: a real `node src/cli.ts` process (and start.cmd on Windows).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net, { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { VERSION } from '../src/version.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
/** Log files of the CLI runs go here, not to the user's profile. */
const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-cli-logs-'));
after(() => fs.rmSync(LOG_DIR, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, OVERLAYS_SERVER_CONFIG: '', OVERLAYS_SERVER_LOG_DIR: LOG_DIR, ...env },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Starts the CLI and resolves once it prints the status page URL. */
function startCli(args: string[], env: Record<string, string> = {}): Promise<{ child: ChildProcess; url: string; output: () => string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, OVERLAYS_SERVER_CONFIG: '', OVERLAYS_SERVER_LOG_DIR: LOG_DIR, ...env } });
    let output = '';
    const timer = setTimeout(() => reject(new Error(`no start within 15 s:\n${output}`)), 15_000);
    const onData = (chunk: Buffer) => {
      output += chunk;
      const m = /status page:\s+(\S+)\//.exec(output);
      if (m) {
        clearTimeout(timer);
        resolve({ child, url: m[1]!, output: () => output });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`exited with ${code}:\n${output}`));
    });
  });
}

describe('CLI', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-cli-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('--version, --help, --list-drivers', () => {
    assert.equal(run(['--version']).out.trim(), VERSION);
    assert.equal(run(['-v']).out.trim(), VERSION);
    const help = run(['--help']);
    assert.equal(help.code, 0);
    for (const flag of ['--config', '--port', '--simulate', '--probe', '--allowed-host', '--tls-cert', '--ddpai-host', '--log-dir', '--no-log-file']) assert.ok(help.out.includes(flag), flag);
    const drivers = run(['--list-drivers']).out;
    assert.match(drivers, /^ddpai\s/m);
    assert.match(drivers, /^simulator\s/m);
  });

  it('--print-config merges file, env and flags (later wins) and masks the token', () => {
    const file = path.join(dir, 'cfg.json');
    fs.writeFileSync(file, JSON.stringify({ port: 4100, logLevel: 'warn', sources: [{ id: 'cam', driver: 'ddpai' }] }));
    const r = run(['--config', file, '--print-config', '--host', '0.0.0.0', '--token', 'secret123', '--origin', 'https://my.example', '--ddpai-host', '10.0.0.9', '--ddpai-http-port', '8081'], {
      OVERLAYS_SERVER_PORT: '4200',
    });
    assert.equal(r.code, 0, r.err);
    const c = JSON.parse(r.out);
    assert.equal(c.port, 4200, 'env overrides the file');
    assert.equal(c.host, '0.0.0.0', 'flag');
    assert.equal(c.logLevel, 'warn', 'file');
    assert.equal(c.token, '***');
    assert.ok(!r.out.includes('secret123'));
    assert.ok(c.allowedOrigins.includes('https://my.example'));
    assert.deepEqual(c.sources[0].options, { host: '10.0.0.9', httpPort: '8081' });
    assert.equal(run(['--print-config', '--port', '4300'], { OVERLAYS_SERVER_PORT: '4200' }).out.includes('"port": 4300'), true, 'flag beats env');
  });

  it('--simulate replaces the sources; `pnpm start -- --flag` style "--" is accepted', () => {
    const c = JSON.parse(run(['--', '--simulate', '--print-config']).out);
    assert.deepEqual(c.sources.map((s: { driver: string }) => s.driver), ['simulator']);
  });

  it('fails with clear messages and exit codes', () => {
    const unknownFlag = run(['--nope']);
    assert.equal(unknownFlag.code, 2);
    assert.match(unknownFlag.err, /Unknown option '--nope'/);

    const missing = run(['--config', path.join(dir, 'missing.json')]);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /^error: config file not found/m);

    const bad = path.join(dir, 'bad.json');
    fs.writeFileSync(bad, '{"port": "x"}');
    assert.match(run(['--config', bad]).err, /config\.port: must be a number/);

    const noDdpai = run(['--simulate', '--ddpai-host', '1.2.3.4']);
    assert.match(noDdpai.err, /no ddpai source is configured/);

    assert.match(run(['--probe', '127.0.0.1', '--probe-ports', '80,abc']).err, /--probe-ports/);
  });

  it('runs: serves the status page and stops on request', async () => {
    const { child, url, output } = await startCli(['--simulate', '--port', '0', '--log-level', 'info']);
    try {
      const health = (await (await fetch(`${url}/health`)).json()) as { ok: boolean; version: string };
      assert.equal(health.ok, true);
      assert.equal(health.version, VERSION);
      assert.match(output(), /config: defaults \(no config file found\)|config: /);
      assert.match(output(), /overlay feed:\s+ws:\/\/127\.0\.0\.1:\d+\/v1\/ws/);
      assert.match(output(), /log files:\s+\S/);
    } finally {
      child.kill();
    }
    const logFile = fs.readdirSync(LOG_DIR).find((f) => /^overlays-server-\d{4}-\d{2}-\d{2}\.log$/.test(f));
    assert.ok(logFile, 'a log file was written');
    const text = fs.readFileSync(path.join(LOG_DIR, logFile), 'utf8');
    assert.ok(text.includes(`===== overlays-server ${VERSION} started: node v`), text);
    assert.match(text, /INFO {2}status page:/);
  });

  it('--no-log-file writes none; --log-dir picks the folder', async () => {
    const none = path.join(dir, 'none');
    const own = path.join(dir, 'own');
    for (const [args, folder] of [[['--no-log-file'], none], [['--log-dir', own], own]] as const) {
      const { child } = await startCli(['--simulate', '--port', '0', ...args], { OVERLAYS_SERVER_LOG_DIR: none });
      child.kill();
      await new Promise((r) => child.once('exit', r));
      assert.equal(fs.existsSync(folder), folder === own, folder);
    }
  });

  it('a second instance on the same port explains what is going on', async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r));
    const port = (blocker.address() as AddressInfo).port;
    try {
      const r = run(['--simulate', '--port', String(port)]);
      assert.equal(r.code, 1);
      assert.match(r.err, new RegExp(`port ${port} is already in use \\(is overlays-server already running\\?\\)`));
    } finally {
      blocker.close();
    }
  });

  it('--probe prints a Markdown report and exits', () => {
    const r = run(['--probe', '127.0.0.1', '--probe-ports', '9']);
    assert.equal(r.code, 1, 'no open ports');
    assert.match(r.out, /### overlays-server probe/);
    assert.match(r.err, /probe: scanning 1 ports/);
  });
});

describe('start.cmd (Windows)', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const cmd = (args: string[], cwd: string, env: Record<string, string> = {}) =>
    spawnSync('cmd.exe', ['/d', '/c', path.join(cwd, 'start.cmd'), ...args], {
      cwd,
      encoding: 'utf8',
      input: '\r\n', // the trailing "pause"
      timeout: 60_000,
      env: { ...process.env, ...env },
    });

  it('starts the server (update skipped with OVERLAYS_SERVER_NO_UPDATE)', () => {
    const r = cmd(['--version'], ROOT, { OVERLAYS_SERVER_NO_UPDATE: '1' });
    assert.match(r.stdout, new RegExp(VERSION.replace(/\./g, '\\.')));
    assert.ok(!/git pull/.test(r.stdout));
  });

  it('keeps the log files in logs\\ next to itself', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, OVERLAYS_SERVER_NO_UPDATE: '1', OVERLAYS_SERVER_CONFIG: '' };
    delete env.OVERLAYS_SERVER_LOG_DIR;
    const r = spawnSync('cmd.exe', ['/d', '/c', path.join(ROOT, 'start.cmd'), '--print-config'], { cwd: ROOT, encoding: 'utf8', input: '\r\n', timeout: 60_000, env });
    const json = r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1);
    assert.equal((JSON.parse(json) as { logDir: string }).logDir, path.join(ROOT, 'logs'));
  });

  it('pulls an update, restarts itself with the new start.cmd and skips npm install when deps did not change', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ovs-start-'));
    try {
      const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' });
      const origin = path.join(base, 'origin');
      const streamer = path.join(base, 'streamer');
      git(base, 'clone', '-q', ROOT, 'origin');
      // CI checks pull requests out on a detached HEAD; the streamer's clone must be on a branch to pull.
      git(origin, 'checkout', '-q', '-B', 'master');
      git(base, 'clone', '-q', origin, 'streamer');
      // Offline: reuse this checkout's dependencies instead of npm install.
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(streamer, 'node_modules'), 'junction');

      // A new release whose start.cmd prints a marker.
      const startFile = path.join(origin, 'start.cmd');
      fs.writeFileSync(startFile, fs.readFileSync(startFile, 'utf8').replace(':run\r\nnode', ':run\r\necho NEW-START-CMD\r\nnode'));
      git(origin, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qam', 'release');

      const r = cmd(['--version'], streamer);
      assert.match(r.stdout, /Guncellendi: [0-9a-f]{7} -> [0-9a-f]{7}/, r.stdout);
      assert.match(r.stdout, /NEW-START-CMD/, 'the updated start.cmd ran after the pull');
      assert.ok(!/Bagimliliklar kuruluyor/.test(r.stdout), 'no npm install: package.json unchanged');
      assert.match(r.stdout, new RegExp(VERSION.replace(/\./g, '\\.')));

      const again = cmd(['--version'], streamer);
      assert.match(again.stdout, /Guncel\./);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});
