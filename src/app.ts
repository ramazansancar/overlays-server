import type { AddressInfo } from 'node:net';
import type { AppConfig } from './config.ts';
import type { AnyDriver, Source, SourceContext } from './core/driver.ts';
import { Hub } from './core/hub.ts';
import { LastPositionStore } from './core/last-position.ts';
import { DriverRegistry } from './core/registry.ts';
import { BUILTIN_DRIVERS } from './drivers/index.ts';
import { createLogger, errorMessage, LogBuffer, recordingLogger, type Logger } from './lib/log.ts';
import { ConfigError, OptionReader } from './lib/options.ts';
import { createHttpServer } from './transports/http-server.ts';

export interface StartOptions {
  config: AppConfig;
  /** Drivers to use; defaults to the built-in ones. Pass your own list to add third-party drivers. */
  drivers?: readonly AnyDriver[];
  log?: Logger;
}

export interface RunningServer {
  /** Base URL, e.g. `http://127.0.0.1:3456`. */
  url: string;
  port: number;
  hub: Hub;
  close(): Promise<void>;
}

interface Running {
  id: string;
  source: Source;
  ctx: SourceContext;
}

/** Builds every enabled source, starts the HTTP/WebSocket server, then starts the sources. */
export async function startServer(options: StartOptions): Promise<RunningServer> {
  const { config } = options;
  const logBuffer = new LogBuffer(500);
  const log = recordingLogger(options.log ?? createLogger(config.logLevel), logBuffer);
  const registry = new DriverRegistry(options.drivers ?? BUILTIN_DRIVERS);
  const hub = new Hub({ staleAfterMs: config.staleAfterMs, gpsPriority: config.gpsPriority, log });

  // Validate everything before opening a port.
  const plans = config.sources
    .filter((s) => s.enabled)
    .map((s) => {
      const driver = registry.get(s.driver);
      const reader = new OptionReader(s.options, `sources.${s.id}.options`);
      const parsed: unknown = driver.parseOptions(reader);
      for (const key of reader.unknownKeys()) log.warn(`sources.${s.id}.options: unknown key "${key}" ignored`);
      return { config: s, driver, options: parsed };
    });
  if (plans.length === 0) log.warn('no enabled sources in the config');

  const running: Running[] = plans.map((plan) => {
    const ctx = hub.register(
      { id: plan.config.id, driver: plan.driver.id, driverName: plan.driver.name, capabilities: plan.driver.capabilities },
      log.child(plan.config.id),
    );
    return { id: plan.config.id, ctx, source: plan.driver.create(ctx, plan.options) };
  });

  // Last positions from the previous run, then keep the file current.
  const positions = config.rememberLastPosition ? new LastPositionStore(config.stateFile, log.child('state')) : undefined;
  if (positions) {
    const remembered = positions.load();
    for (const r of running) {
      const p = remembered[r.id];
      if (p) hub.seedLastFix(r.id, p.fix, p.savedAt);
    }
    const seeded = running.filter((r) => remembered[r.id]).length;
    if (seeded) log.info(`last known position restored for ${seeded} source(s)`);
    hub.subscribe((e) => {
      if (e.kind === 'fix') positions.update(e.source, e.fix);
    });
    positions.start();
  }

  const { server, closeClients } = createHttpServer({
    hub,
    host: config.host,
    allowedOrigins: config.allowedOrigins,
    ...(config.token && { token: config.token }),
    motionMaxHz: config.motionMaxHz,
    log: log.child('http'),
    diagnostics: { config, logBuffer, startedAt: Date.now() },
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE') {
        reject(new ConfigError(`port ${config.port} is already in use (is overlays-server already running?)`));
      } else if (err.code === 'EACCES') {
        reject(new ConfigError(`no permission to listen on ${config.host}:${config.port}`));
      } else {
        reject(err);
      }
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });

  const port = (server.address() as AddressInfo).port;
  const hostForUrl = config.host.includes(':') ? `[${config.host}]` : config.host;
  hub.start();

  for (const r of running) {
    try {
      await r.source.start();
    } catch (err) {
      log.error(`${r.id}: failed to start: ${errorMessage(err)}`);
      r.ctx.setLink('offline', `failed to start: ${errorMessage(err)}`);
    }
  }

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      for (const r of running) {
        try {
          await r.source.stop();
        } catch (err) {
          log.warn(`${r.id}: stop failed: ${errorMessage(err)}`);
        }
      }
      hub.stop();
      positions?.stop();
      closeClients();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    })());

  return { url: `http://${hostForUrl}:${port}`, port, hub, close };
}
