/**
 * Remembers each source's last position on disk, so a server (or PC) restart while GPS is lost — a tunnel, an
 * underground car park — still has a position to show. Written at most every few seconds, atomically, and on close.
 * It is the user's own location in their own profile folder; `rememberLastPosition: false` turns it off.
 */
import fs from 'node:fs';
import path from 'node:path';
import { errorMessage, type Logger } from '../lib/log.ts';
import type { GpsFix } from './types.ts';

export interface StoredPosition {
  fix: GpsFix;
  /** Epoch ms when it was received. */
  savedAt: number;
}

export class LastPositionStore {
  private readonly file: string;
  private readonly log: Logger;
  private readonly intervalMs: number;
  private positions: Record<string, StoredPosition> = {};
  private dirty = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(file: string, log: Logger, intervalMs = 10_000) {
    this.file = file;
    this.log = log;
    this.intervalMs = intervalMs;
  }

  /** Reads the file; a missing or broken file just means "nothing remembered". */
  load(): Record<string, StoredPosition> {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { positions?: Record<string, StoredPosition> };
      for (const [id, p] of Object.entries(data.positions ?? {})) {
        if (p && typeof p.savedAt === 'number' && Number.isFinite(p.fix?.lat) && Number.isFinite(p.fix?.lon)) this.positions[id] = p;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') this.log.warn(`cannot read ${this.file}: ${errorMessage(err)}`);
    }
    return { ...this.positions };
  }

  update(id: string, fix: GpsFix, at = Date.now()): void {
    this.positions[id] = { fix, savedAt: at };
    this.dirty = true;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.flush(), this.intervalMs);
    this.timer.unref();
  }

  /** Writes now if anything changed (temp file + rename, so a crash never leaves half a file). */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ format: 1, positions: this.positions }, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log.warn(`cannot write ${this.file}: ${errorMessage(err)}`);
    }
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.flush();
  }
}
