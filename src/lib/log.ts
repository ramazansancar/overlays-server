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

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code && !err.message.includes(code) ? `${code} ${err.message}` : err.message;
  }
  return String(err);
}
