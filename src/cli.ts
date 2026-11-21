#!/usr/bin/env node
import os from 'node:os';
import { parseArgs } from 'node:util';
import { startServer } from './app.ts';
import { findConfigFile, parseConfig, readConfigFile, userConfigPath, userLogDir, type AppConfig } from './config.ts';
import { BUILTIN_DRIVERS } from './drivers/index.ts';
import { LogFile } from './lib/log-file.ts';
import { createLogger, errorMessage, LOG_LEVELS, recordingLogger, type LogLevel } from './lib/log.ts';
import { ConfigError } from './lib/options.ts';
import { runProbe } from './tools/probe.ts';
import { REPO_URL, VERSION } from './version.ts';

const HELP = `overlays-server ${VERSION}
Local telemetry bridge for stream overlays (live dashcam GPS -> browser source).

Usage: overlays-server [options]

Options:
  -c, --config <file>      Config file (JSON). Default search: $OVERLAYS_SERVER_CONFIG,
                           ./overlays-server.config.json, ${userConfigPath()}
  -p, --port <port>        Port to listen on (default 3456)
      --host <address>     Interface to listen on (default 127.0.0.1)
      --origin <origin>    Extra allowed web origin (repeatable), e.g. https://example.com
      --token <secret>     Require ?token=<secret> from clients
      --allowed-host <name> Extra Host name behind a reverse proxy (repeatable), e.g. pi.tailnet.ts.net
      --tls-cert <file>    Serve HTTPS/WSS with this PEM certificate (needs --tls-key)
      --tls-key <file>     PEM private key for --tls-cert
      --ddpai-host <ip>    DDPAI camera address (default 193.168.0.1)
      --ddpai-http-port <port>  DDPAI HTTP API port (default 80)
      --simulate           Use the built-in simulator instead of the configured sources
      --log-level <level>  ${LOG_LEVELS.join(' | ')} (default info)
      --log-dir <folder>   Folder for the daily log files (default ${userLogDir()})
      --no-log-file        Do not write log files
      --print-config       Print the effective config and exit
      --list-drivers       List available drivers and exit
      --probe <host>       Inspect a device (ports, model, data samples) and print a report
                           for a GitHub issue, then exit. Personal data is masked.
      --probe-ports <list> Ports for --probe, comma separated (default: common camera ports)
  -v, --version            Print the version
  -h, --help               Show this help

Environment: OVERLAYS_SERVER_PORT, OVERLAYS_SERVER_HOST, OVERLAYS_SERVER_LOG_LEVEL, OVERLAYS_SERVER_LOG_DIR,
OVERLAYS_SERVER_CONFIG.
Docs: ${REPO_URL}
`;

function parseCli() {
  // `pnpm start -- --flag` passes the `--` through.
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  return parseArgs({
    args,
    allowPositionals: false,
    options: {
      config: { type: 'string', short: 'c' },
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      origin: { type: 'string', multiple: true },
      token: { type: 'string' },
      'allowed-host': { type: 'string', multiple: true },
      'tls-cert': { type: 'string' },
      'tls-key': { type: 'string' },
      'ddpai-host': { type: 'string' },
      'ddpai-http-port': { type: 'string' },
      simulate: { type: 'boolean' },
      'log-level': { type: 'string' },
      'log-dir': { type: 'string' },
      'no-log-file': { type: 'boolean' },
      'print-config': { type: 'boolean' },
      'list-drivers': { type: 'boolean' },
      probe: { type: 'string' },
      'probe-ports': { type: 'string' },
      version: { type: 'boolean', short: 'v' },
      help: { type: 'boolean', short: 'h' },
    },
  }).values;
}

type CliValues = ReturnType<typeof parseCli>;

/** Config file, then environment, then command line flags (later wins). */
function buildConfig(args: CliValues, warn: (m: string) => void): { config: AppConfig; file: string | undefined } {
  const file = findConfigFile(args.config ?? undefined);
  const raw = (file ? readConfigFile(file) : {}) as Record<string, unknown>;
  const env = process.env;
  const overrides: Record<string, unknown> = {
    ...(env.OVERLAYS_SERVER_PORT && { port: env.OVERLAYS_SERVER_PORT }),
    ...(env.OVERLAYS_SERVER_HOST && { host: env.OVERLAYS_SERVER_HOST }),
    ...(env.OVERLAYS_SERVER_LOG_LEVEL && { logLevel: env.OVERLAYS_SERVER_LOG_LEVEL }),
    ...(env.OVERLAYS_SERVER_LOG_DIR && { logDir: env.OVERLAYS_SERVER_LOG_DIR }),
    ...(args.port && { port: args.port }),
    ...(args.host && { host: args.host }),
    ...(args.token && { token: args.token }),
    ...((args['tls-cert'] || args['tls-key']) && { tls: { certFile: args['tls-cert'], keyFile: args['tls-key'] } }),
    ...(args['log-level'] && { logLevel: args['log-level'] }),
    ...(args['log-dir'] && { logDir: args['log-dir'] }),
    ...(args['no-log-file'] && { logToFile: false }),
  };
  const config = parseConfig({ ...raw, ...overrides }, warn);
  if (args.origin?.length) config.allowedOrigins = [...config.allowedOrigins, ...args.origin];
  if (args['allowed-host']?.length) config.allowedHosts = [...config.allowedHosts, ...args['allowed-host'].map((h) => h.toLowerCase())];
  if (args.simulate) {
    config.sources = [{ id: 'simulator', driver: 'simulator', enabled: true, options: {} }];
  }
  if (args['ddpai-host'] || args['ddpai-http-port']) {
    const ddpai = config.sources.filter((s) => s.driver === 'ddpai');
    if (ddpai.length === 0) throw new ConfigError('--ddpai-host / --ddpai-http-port given but no ddpai source is configured');
    for (const s of ddpai) {
      s.options = {
        ...s.options,
        ...(args['ddpai-host'] && { host: args['ddpai-host'] }),
        ...(args['ddpai-http-port'] && { httpPort: args['ddpai-http-port'] }),
      };
    }
  }
  return { config, file };
}

/** Set once the server runs with log files: fatal errors go there too. */
let logFile: LogFile | undefined;

async function main(): Promise<number> {
  let args: CliValues;
  try {
    args = parseCli();
  } catch (err) {
    console.error(`${errorMessage(err)}\n\n${HELP}`);
    return 2;
  }
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  if (args.version) {
    console.log(VERSION);
    return 0;
  }
  if (args.probe) {
    const ports = args['probe-ports']?.split(',').map((p) => Number(p.trim()));
    if (ports && ports.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
      throw new ConfigError('--probe-ports: comma separated port numbers, e.g. 80,554,6100');
    }
    return runProbe(args.probe, ports ? { ports } : {});
  }
  if (args['list-drivers']) {
    for (const d of BUILTIN_DRIVERS) console.log(`${d.id.padEnd(12)} ${d.name} — ${d.description}`);
    return 0;
  }

  const warnings: string[] = [];
  const { config, file } = buildConfig(args, (m) => warnings.push(m));
  if (args['print-config']) {
    console.log(JSON.stringify({ ...config, ...(config.token && { token: '***' }) }, null, 2));
    return 0;
  }

  const consoleLog = createLogger(config.logLevel as LogLevel);
  if (config.logToFile) {
    logFile = new LogFile({
      dir: config.logDir,
      keepDays: config.logKeepDays,
      onError: (m) => consoleLog.warn(m),
    });
    logFile.push('info', `===== overlays-server ${VERSION} started: node ${process.version}, ${process.platform} ${os.release()} ${process.arch}, UTC${utcOffset()} =====`);
    process.on('uncaughtException', (err) => {
      logFile?.push('error', `crashed: ${err.stack ?? err.message}`);
      console.error(err);
      process.exit(1);
    });
  }
  const log = logFile ? recordingLogger(consoleLog, logFile) : consoleLog;
  for (const w of warnings) log.warn(w);
  log.info(`overlays-server ${VERSION} (node ${process.version})`);
  log.info(file ? `config: ${file}` : 'config: defaults (no config file found)');
  if (logFile) log.info(`log files:     ${logFile.dir}`);

  const server = await startServer({ config, log });
  log.info(`status page:   ${server.url}/`);
  log.info(`overlay feed:  ${server.url.replace(/^http/, 'ws')}/v1/ws`);

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    log.info(`${signal}: shutting down`);
    const force = setTimeout(() => process.exit(1), 3000);
    force.unref();
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  // Windows: the console window was closed (Node is killed a few seconds later).
  process.on('SIGHUP', () => shutdown('SIGHUP (window closed)'));
  return -1; // keep running
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err) => {
    logFile?.push('error', err instanceof Error && !(err instanceof ConfigError) ? (err.stack ?? err.message) : errorMessage(err));
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  },
);

function utcOffset(): string {
  const minutes = -new Date().getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
