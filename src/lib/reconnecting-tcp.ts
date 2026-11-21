import net from 'node:net';
import { errorMessage, type Logger } from './log.ts';

export interface ReconnectingTcpOptions {
  host: string;
  port: number;
  /** Give up a connection attempt after this long. */
  connectTimeoutMs?: number;
  /** Drop and reconnect when nothing arrives for this long (0 = never). */
  idleTimeoutMs?: number;
  /** First retry delay; doubles on every failure up to `maxRetryMs`. */
  minRetryMs?: number;
  maxRetryMs?: number;
  log: Logger;
  onConnect?: (socket: net.Socket) => void;
  onData: (chunk: Buffer) => void;
  /** Called once per lost (or failed) connection, before the retry is scheduled. */
  onDisconnect?: (reason: string, wasConnected: boolean) => void;
}

/**
 * A TCP client that keeps reconnecting with exponential backoff until stopped.
 * Devices on a car's Wi-Fi come and go; nothing here ever throws to the caller.
 */
export class ReconnectingTcpClient {
  private socket: net.Socket | undefined;
  private retryTimer: NodeJS.Timeout | undefined;
  private retryMs: number;
  private running = false;
  private readonly opts: Required<Omit<ReconnectingTcpOptions, 'onConnect' | 'onDisconnect'>> &
    Pick<ReconnectingTcpOptions, 'onConnect' | 'onDisconnect'>;

  constructor(options: ReconnectingTcpOptions) {
    this.opts = {
      connectTimeoutMs: 4000,
      idleTimeoutMs: 6000,
      minRetryMs: 1000,
      maxRetryMs: 10_000,
      ...options,
    };
    this.retryMs = this.opts.minRetryMs;
  }

  get connected(): boolean {
    return this.socket?.readyState === 'open';
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.socket?.destroy();
    this.socket = undefined;
  }

  private connect(): void {
    const { host, port, log } = this.opts;
    let wasConnected = false;
    let closed = false;
    const socket = new net.Socket();
    this.socket = socket;
    socket.setNoDelay(true);

    const connectTimer = setTimeout(() => socket.destroy(new Error(`connect timeout (${host}:${port})`)), this.opts.connectTimeoutMs);

    socket.once('connect', () => {
      clearTimeout(connectTimer);
      wasConnected = true;
      if (this.opts.idleTimeoutMs > 0) socket.setTimeout(this.opts.idleTimeoutMs);
      log.debug(`connected to ${host}:${port}`);
      this.opts.onConnect?.(socket);
    });

    socket.on('data', (chunk: Buffer) => {
      // Healthy data resets the backoff, so the next drop retries quickly.
      this.retryMs = this.opts.minRetryMs;
      this.opts.onData(chunk);
    });

    socket.on('timeout', () => socket.destroy(new Error(`no data for ${this.opts.idleTimeoutMs} ms`)));

    let reason = 'closed';
    socket.on('error', (err) => {
      reason = errorMessage(err);
    });

    socket.once('close', () => {
      clearTimeout(connectTimer);
      if (closed) return;
      closed = true;
      if (this.socket === socket) this.socket = undefined;
      if (!this.running) return;
      this.opts.onDisconnect?.(reason, wasConnected);
      this.scheduleRetry();
    });

    socket.connect(port, host);
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, this.opts.maxRetryMs);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.running) this.connect();
    }, delay);
  }
}
