export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export interface Logger {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
  /** Same level and output, with an extra `[scope]` prefix. */
  child(scope: string): Logger;
}

export type LogSink = (level: Exclude<LogLevel, 'silent'>, line: string, details: unknown[]) => void;

const consoleSink: LogSink = (level, line, details) => {
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(line, ...details);
};

function time(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function createLogger(level: LogLevel = 'info', sink: LogSink = consoleSink, scope?: string): Logger {
  const min = RANK[level];
  const prefix = scope ? `[${scope}] ` : '';
  const emit =
    (lvl: Exclude<LogLevel, 'silent'>) =>
    (message: string, ...details: unknown[]) => {
      if (RANK[lvl] < min) return;
      sink(lvl, `${time()} ${lvl.toUpperCase().padEnd(5)} ${prefix}${message}`, details);
    };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (child) => createLogger(level, sink, scope ? `${scope}:${child}` : child),
  };
}

export const silentLogger: Logger = createLogger('silent');

/** Where a recording logger copies its lines: the in-memory buffer, a log file. */
export interface LogRecorder {
  push(level: string, message: string): void;
}

/** The last N log lines in memory, for the diagnostics download. */
export class LogBuffer implements LogRecorder {
  private readonly lines: string[] = [];
  readonly capacity: number;

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  push(level: string, message: string): void {
    const d = new Date();
    this.lines.push(`${d.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`);
    if (this.lines.length > this.capacity) this.lines.splice(0, this.lines.length - this.capacity);
  }

  snapshot(): string[] {
    return [...this.lines];
  }
}

/**
 * Wraps a logger so every line it prints is also kept in `buffer`. Lines below the base logger's level are recorded
 * too, so a diagnostics or log file has more than the console.
 */
export function recordingLogger(base: Logger, buffer: LogRecorder, scope?: string): Logger {
  const prefix = scope ? `[${scope}] ` : '';
  const wrap =
    (level: 'debug' | 'info' | 'warn' | 'error') =>
    (message: string, ...details: unknown[]) => {
      const extra = details.length ? ` ${details.map((d) => (d instanceof Error ? d.message : safeJson(d))).join(' ')}` : '';
      buffer.push(level, `${prefix}${message}${extra}`);
      base[level](message, ...details);
    };
  return {
    debug: wrap('debug'),
    info: wrap('info'),
    warn: wrap('warn'),
    error: wrap('error'),
    child: (child) => recordingLogger(base.child(child), buffer, scope ? `${scope}:${child}` : child),
  };
}

function safeJson(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code && !err.message.includes(code) ? `${code} ${err.message}` : err.message;
  }
  return String(err);
}
