/**
 * Log files a streamer can send with an issue: one file per day in a folder (`overlays-server-2026-11-21.log`),
 * every level including `debug`, personal data masked (positions, Wi-Fi credentials, serials, MACs, the user's home
 * folder). Files older than `keepDays` are deleted. Writes are synchronous, so the lines before a crash are on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from './redact.ts';

export interface LogFileOptions {
  dir: string;
  /** Keep this many days of files (today included). */
  keepDays: number;
  /** A day's file stops growing past this size (a device flooding the log), until the next day. Default 20 MB. */
  maxBytesPerDay?: number;
  /** Called once if the folder cannot be written; the server keeps running and logging to the console. */
  onError?: (message: string) => void;
  now?: () => Date;
}

const FILE_NAME = /^overlays-server-(\d{4})-(\d{2})-(\d{2})\.log$/;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n: number, width = 2) => String(n).padStart(width, '0');
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

export function logFileName(day: Date): string {
  return `overlays-server-${localDay(day)}.log`;
}

export class LogFile {
  readonly dir: string;
  private readonly keepDays: number;
  private readonly maxBytes: number;
  private readonly onError: (message: string) => void;
  private readonly now: () => Date;
  private readonly home: RegExp | undefined;
  private day = '';
  private file = '';
  private bytes = 0;
  private full = false;
  private failed = false;

  constructor(options: LogFileOptions) {
    this.dir = path.resolve(options.dir);
    this.keepDays = Math.max(1, Math.floor(options.keepDays));
    this.maxBytes = options.maxBytesPerDay ?? 20 * 1024 * 1024;
    this.onError = options.onError ?? (() => {});
    this.now = options.now ?? (() => new Date());
    const home = os.homedir();
    // C:\Users\<name> carries the Windows user name: shown as ~ in the file.
    this.home = home.length > 3 ? new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : undefined;
  }

  /** Today's file. */
  get path(): string {
    return this.file || path.join(this.dir, logFileName(this.now()));
  }

  push(level: string, message: string): void {
    if (this.failed) return;
    const now = this.now();
    try {
      this.roll(now);
      if (this.full) return;
      const line = `${clock(now)} ${level.toUpperCase().padEnd(5)} ${this.clean(message)}${os.EOL}`;
      const size = Buffer.byteLength(line);
      if (this.bytes + size > this.maxBytes) {
        this.full = true;
        fs.appendFileSync(this.file, `${clock(now)} WARN  log file size limit reached, nothing more is written today${os.EOL}`);
        return;
      }
      fs.appendFileSync(this.file, line);
      this.bytes += size;
    } catch (err) {
      this.failed = true;
      this.onError(`cannot write the log file in ${this.dir}: ${(err as Error).message}. Logging to the console only.`);
    }
  }

  private clean(text: string): string {
    const out = redact(text);
    return this.home ? out.replace(this.home, '~') : out;
  }

  /** Opens the day's file (a new one after midnight) and deletes the expired ones. */
  private roll(now: Date): void {
    const day = localDay(now);
    if (day === this.day) return;
    fs.mkdirSync(this.dir, { recursive: true });
    this.day = day;
    this.file = path.join(this.dir, logFileName(now));
    this.bytes = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    this.full = false;
    this.prune(now);
  }

  private prune(now: Date): void {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const name of fs.readdirSync(this.dir)) {
      const m = FILE_NAME.exec(name);
      if (!m) continue;
      const fileDay = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      // Round: a day across a DST change is 23 or 25 hours.
      if (Math.round((today - fileDay) / DAY_MS) >= this.keepDays) {
        try {
          fs.unlinkSync(path.join(this.dir, name));
        } catch {
          // Open in an editor, read-only: try again tomorrow.
        }
      }
    }
  }
}
