import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LOG_LEVELS, type LogLevel } from './lib/log.ts';
import { ConfigError, OptionReader } from './lib/options.ts';

export interface SourceConfig {
  /** Unique name of this source; clients can subscribe to it (`?source=<id>`). */
  id: string;
  /** Driver id (`ddpai`, `simulator`, ...). */
  driver: string;
  enabled: boolean;
  /** Driver specific options, validated by the driver. */
  options: Record<string, unknown>;
}

export interface AppConfig {
  /** Interface to listen on. Keep 127.0.0.1 unless the overlay runs on another device. */
  host: string;
  port: number;
  /**
   * Web pages allowed to read the data. `https://site` exact, `http://localhost:*` any port, `*` anyone.
   * Without this any website open in a browser on this PC could read the live location.
   */
  allowedOrigins: string[];
  /** Optional shared secret: clients must send `?token=` (or `Authorization: Bearer`). */
  token?: string;
  /**
   * Extra Host names accepted while listening on loopback (DNS rebinding guard), for a reverse proxy in front of the
   * server: Tailscale Serve (`pi.tailnet-name.ts.net`), Caddy, Nginx. Not needed when listening on a LAN/VPN address.
   */
  allowedHosts: string[];
  /** Serve HTTPS / WSS directly (PEM files), e.g. a `tailscale cert` or Let's Encrypt certificate. */
  tls?: { certFile: string; keyFile: string };
  /** A GPS source that goes quiet this long is reported `stale`. */
  staleAfterMs: number;
  /** Source ids in preference order for the default GPS stream. */
  gpsPriority: string[];
  /** Upper bound for motion messages per client per second. */
  motionMaxHz: number;
  logLevel: LogLevel;
  /**
   * Write log files (CLI only): one per day in `logDir`, every level including debug, personal data masked.
   * A streamer sends these with a problem report.
   */
  logToFile: boolean;
  /** Default: `logs` next to the per-user config; `start.cmd` uses `logs` next to itself. */
  logDir: string;
  /** Days of log files to keep. */
  logKeepDays: number;
  /**
   * Keep each source's last position on disk so it survives restarts while GPS is lost (tunnels).
   * Stored in `stateFile` (default: next to the per-user config).
   */
  rememberLastPosition: boolean;
  stateFile: string;
  sources: SourceConfig[];
}

export const DEFAULT_PORT = 3456;

export const DEFAULT_ALLOWED_ORIGINS = [
  'https://overlays.ramazansancar.com.tr',
  'http://localhost:*',
  'http://127.0.0.1:*',
];

export const DEFAULT_SOURCES: SourceConfig[] = [{ id: 'ddpai', driver: 'ddpai', enabled: true, options: {} }];

const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

/** Validates a parsed config file (any missing key takes its default). */
export function parseConfig(raw: unknown, onWarning: (message: string) => void = () => {}): AppConfig {
  const o = new OptionReader(raw, 'config');
  o.raw('$schema');
  const token = o.string('token');
  const config: AppConfig = {
    host: o.string('host', '127.0.0.1'),
    port: o.port('port', DEFAULT_PORT),
    allowedOrigins: o.stringList('allowedOrigins', DEFAULT_ALLOWED_ORIGINS),
    ...(token && { token }),
    allowedHosts: o.stringList('allowedHosts', []).map((h) => h.trim().toLowerCase()).filter(Boolean),
    ...parseTls(o.raw('tls')),
    staleAfterMs: o.number('staleAfterMs', 5000, { min: 500, integer: true }),
    gpsPriority: o.stringList('gpsPriority', []),
    motionMaxHz: o.number('motionMaxHz', 10, { min: 0, max: 100 }),
    logLevel: o.oneOf('logLevel', LOG_LEVELS, 'info'),
    logToFile: o.boolean('logToFile', true),
    logDir: o.string('logDir', userLogDir()),
    logKeepDays: o.number('logKeepDays', 14, { min: 1, integer: true }),
    rememberLastPosition: o.boolean('rememberLastPosition', true),
    stateFile: o.string('stateFile', userStatePath()),
    sources: o.has('sources') ? parseSources(o.raw('sources')) : structuredClone(DEFAULT_SOURCES),
  };
  for (const key of o.unknownKeys()) onWarning(`config: unknown key "${key}" ignored`);
  return config;
}

function parseTls(raw: unknown): { tls?: { certFile: string; keyFile: string } } {
  if (raw === undefined || raw === null) return {};
  const o = new OptionReader(raw, 'config.tls');
  const certFile = o.string('certFile');
  const keyFile = o.string('keyFile');
  if (!certFile || !keyFile) throw new ConfigError('config.tls: needs both certFile and keyFile');
  return { tls: { certFile, keyFile } };
}

function parseSources(raw: unknown): SourceConfig[] {
  if (!Array.isArray(raw)) throw new ConfigError('config.sources: must be a list');
  const ids = new Set<string>();
  return raw.map((item, i) => {
    const o = new OptionReader(item, `config.sources[${i}]`);
    const driver = o.string('driver');
    if (!driver) throw new ConfigError(`config.sources[${i}].driver: required`);
    const id = o.string('id', driver);
    if (!SOURCE_ID.test(id)) throw new ConfigError(`config.sources[${i}].id: letters, digits, - and _ only`);
    if (ids.has(id)) throw new ConfigError(`config.sources[${i}].id: "${id}" is used twice`);
    ids.add(id);
    const options = o.raw('options') ?? {};
    if (typeof options !== 'object' || Array.isArray(options)) {
      throw new ConfigError(`config.sources[${i}].options: must be an object`);
    }
    return { id, driver, enabled: o.boolean('enabled', true), options: options as Record<string, unknown> };
  });
}

/** Per-user config file location (`%APPDATA%\overlays-server\config.json`, `~/.config/overlays-server/config.json`). */
export function userConfigPath(): string {
  const base =
    process.platform === 'win32'
      ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
      : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'));
  return path.join(base, 'overlays-server', 'config.json');
}

/** Per-user file for the remembered last positions. */
export function userStatePath(): string {
  return path.join(path.dirname(userConfigPath()), 'last-position.json');
}

/** Per-user folder for the log files. */
export function userLogDir(): string {
  return path.join(path.dirname(userConfigPath()), 'logs');
}

/**
 * Where to read the config from: an explicit path, `$OVERLAYS_SERVER_CONFIG`,
 * `overlays-server.config.json` in the working directory, then the per-user file.
 * Returns `undefined` when none exists (defaults are used).
 */
export function findConfigFile(explicit?: string): string | undefined {
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new ConfigError(`config file not found: ${explicit}`);
    return path.resolve(explicit);
  }
  const candidates = [
    process.env.OVERLAYS_SERVER_CONFIG,
    path.resolve('overlays-server.config.json'),
    userConfigPath(),
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p));
}

export function readConfigFile(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read ${file}: ${(err as Error).message}`);
  }
  try {
    // Notepad saves UTF-8 with a BOM.
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (err) {
    throw new ConfigError(`${file} is not valid JSON: ${(err as Error).message}`);
  }
}
