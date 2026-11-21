/**
 * Programmatic API. `npx overlays-server` covers normal use; import this to embed the server
 * or to run it with your own drivers:
 *
 *   import { startServer, parseConfig, BUILTIN_DRIVERS, defineDriver } from 'overlays-server';
 *   const myDriver = defineDriver({ id: 'my-gps', ... });
 *   await startServer({ config: parseConfig({ sources: [{ driver: 'my-gps' }] }), drivers: [...BUILTIN_DRIVERS, myDriver] });
 */
export { startServer, type RunningServer, type StartOptions } from './app.ts';
export {
  DEFAULT_ALLOWED_ORIGINS,
  DEFAULT_PORT,
  findConfigFile,
  parseConfig,
  readConfigFile,
  userConfigPath,
  type AppConfig,
  type SourceConfig,
} from './config.ts';
export { defineDriver, type AnyDriver, type Driver, type Source, type SourceContext } from './core/driver.ts';
export { Hub, normalizeFix, type HubEvent, type SourceInfo, type SourceSnapshot } from './core/hub.ts';
export * from './core/protocol.ts';
export { DriverRegistry } from './core/registry.ts';
export type * from './core/types.ts';
export { BUILTIN_DRIVERS } from './drivers/index.ts';
export { ddpaiDriver, type DdpaiOptions } from './drivers/ddpai/index.ts';
export { simulatorDriver, type SimulatorOptions } from './drivers/simulator.ts';
export { DelimitedDecoder } from './lib/delimited.ts';
export { createLogger, type Logger, type LogLevel } from './lib/log.ts';
export * as nmea from './lib/nmea.ts';
export { ConfigError, OptionReader } from './lib/options.ts';
export { ReconnectingTcpClient, type ReconnectingTcpOptions } from './lib/reconnecting-tcp.ts';
export { VERSION } from './version.ts';
