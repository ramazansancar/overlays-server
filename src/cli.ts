#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { startServer } from './app.ts';
import { findConfigFile, parseConfig, readConfigFile, userConfigPath, type AppConfig } from './config.ts';
import { BUILTIN_DRIVERS } from './drivers/index.ts';
import { createLogger, errorMessage, LOG_LEVELS, type LogLevel } from './lib/log.ts';
import { ConfigError } from './lib/options.ts';
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
      --ddpai-host <ip>    DDPAI camera address (default 193.168.0.1)
      --simulate           Use the built-in simulator instead of the configured sources
      --log-level <level>  ${LOG_LEVELS.join(' | ')} (default info)
      --print-config       Print the effective config and exit
      --list-drivers       List available drivers and exit
  -v, --version            Print the version
  -h, --help               Show this help

Environment: OVERLAYS_SERVER_PORT, OVERLAYS_SERVER_HOST, OVERLAYS_SERVER_LOG_LEVEL, OVERLAYS_SERVER_CONFIG.
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
      'ddpai-host': { type: 'string' },
      simulate: { type: 'boolean' },
      'log-level': { type: 'string' },
      'print-config': { type: 'boolean' },
      'list-drivers': { type: 'boolean' },
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
    ...(args.port && { port: args.port }),
    ...(args.host && { host: args.host }),
    ...(args.token && { token: args.token }),
    ...(args['log-level'] && { logLevel: args['log-level'] }),
  };
  const config = parseConfig({ ...raw, ...overrides }, warn);
  if (args.origin?.length) config.allowedOrigins = [...config.allowedOrigins, ...args.origin];
  if (args.simulate) {
    config.sources = [{ id: 'simulator', driver: 'simulator', enabled: true, options: {} }];
  }
  if (args['ddpai-host']) {
    const ddpai = config.sources.filter((s) => s.driver === 'ddpai');
    if (ddpai.length === 0) throw new ConfigError('--ddpai-host given but no ddpai source is configured');
    for (const s of ddpai) s.options = { ...s.options, host: args['ddpai-host'] };
  }
  return { config, file };
}

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

  const log = createLogger(config.logLevel as LogLevel);
  for (const w of warnings) log.warn(w);
  log.info(`overlays-server ${VERSION} (node ${process.version})`);
  log.info(file ? `config: ${file}` : 'config: defaults (no config file found)');

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
  return -1; // keep running
}

main().then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err) => {
    if (err instanceof ConfigError) {
      console.error(`error: ${err.message}`);
    } else {
      console.error(err);
    }
    process.exitCode = 1;
  },
);
