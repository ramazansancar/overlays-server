import { silentLogger, type Logger } from '../lib/log.ts';
import type { SourceContext } from './driver.ts';
import type { Capability, DeviceEvent, DeviceInfo, GpsFix, GpsState, LinkState, MotionSample, SourceStatus } from './types.ts';

export interface SourceInfo {
  id: string;
  driver: string;
  driverName: string;
  capabilities: readonly Capability[];
}

export interface SourceSnapshot extends SourceInfo {
  status: SourceStatus;
  lastFix?: GpsFix;
  /** Server clock when `lastFix` arrived. */
  lastFixAt?: number;
  lastMotion?: MotionSample;
  /** This source currently feeds the default (`auto`) GPS stream. */
  active: boolean;
}

export type HubEvent =
  | { kind: 'status'; snapshot: SourceSnapshot }
  | { kind: 'fix'; source: string; fix: GpsFix; active: boolean }
  | { kind: 'motion'; source: string; sample: MotionSample }
  | { kind: 'event'; source: string; event: DeviceEvent };

export type HubListener = (event: HubEvent) => void;

/** A raw device message kept for diagnostics. */
export interface RawFrame {
  /** Epoch ms when it arrived. */
  t: number;
  frame: string;
}

export interface HubOptions {
  /** Raw frames kept per source for diagnostics (default 2000, ~2 min of DDPAI data). */
  rawFrameCapacity?: number;
  /** A source that sent fixes and then went quiet for this long is `stale`. */
  staleAfterMs?: number;
  /** Source ids in preference order for the `auto` GPS stream; others follow in registration order. */
  gpsPriority?: string[];
  log?: Logger;
  now?: () => number;
}

/** Below this speed (m/s, ~1.8 km/h) the course from GPS is noise: heading is left out. */
const MIN_SPEED_FOR_HEADING = 0.5;

interface Entry {
  info: SourceInfo;
  status: SourceStatus;
  lastFix?: GpsFix;
  lastFixAt?: number;
  lastMotion?: MotionSample;
  raw: RawFrame[];
  abort: AbortController;
}

/**
 * Central state: one entry per source, the active GPS source, stale detection and fan-out.
 * Sources write through their `SourceContext`, transports read snapshots and subscribe to events.
 */
export class Hub {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<HubListener>();
  private readonly staleAfterMs: number;
  private readonly rawFrameCapacity: number;
  private readonly gpsPriority: string[];
  private readonly log: Logger;
  private readonly now: () => number;
  private activeId: string | undefined;
  private staleTimer: NodeJS.Timeout | undefined;

  constructor(options: HubOptions = {}) {
    this.staleAfterMs = options.staleAfterMs ?? 5000;
    this.rawFrameCapacity = options.rawFrameCapacity ?? 2000;
    this.gpsPriority = options.gpsPriority ?? [];
    this.log = options.log ?? silentLogger;
    this.now = options.now ?? Date.now;
  }

  /** Adds a source and returns the context its driver writes through. */
  register(info: SourceInfo, log: Logger = this.log.child(info.id)): SourceContext {
    if (this.entries.has(info.id)) throw new Error(`source id "${info.id}" is used twice`);
    const entry: Entry = {
      info,
      status: { link: 'starting', gps: 'unknown', since: this.now() },
      raw: [],
      abort: new AbortController(),
    };
    this.entries.set(info.id, entry);
    const id = info.id;
    return {
      id,
      log,
      signal: entry.abort.signal,
      setLink: (state, message) => this.setLink(id, state, message),
      setDevice: (device) => this.setDevice(id, device),
      publishFix: (fix) => this.publishFix(id, fix),
      publishNoFix: (detail) => this.publishNoFix(id, detail),
      publishMotion: (sample) => this.publishMotion(id, sample),
      publishEvent: (event) => this.publishEvent(id, event),
      recordRaw: (frame) => {
        if (this.rawFrameCapacity <= 0) return;
        entry.raw.push({ t: this.now(), frame });
        if (entry.raw.length > this.rawFrameCapacity) entry.raw.splice(0, entry.raw.length - this.rawFrameCapacity);
      },
    };
  }

  /** Aborts the source's signal and marks it stopped. */
  unregister(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.abort.abort();
    this.setLink(id, 'stopped');
  }

  start(): void {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(() => this.checkStale(), Math.min(1000, Math.max(100, this.staleAfterMs / 4)));
    this.staleTimer.unref();
  }

  stop(): void {
    clearInterval(this.staleTimer);
    this.staleTimer = undefined;
    for (const id of this.entries.keys()) this.unregister(id);
  }

  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get activeGpsSource(): string | undefined {
    return this.activeId;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  snapshot(id: string): SourceSnapshot | undefined {
    const entry = this.entries.get(id);
    return entry && this.toSnapshot(entry);
  }

  snapshots(): SourceSnapshot[] {
    return [...this.entries.values()].map((e) => this.toSnapshot(e));
  }

  /**
   * Gives a source a last known position from an earlier run (see LastPositionStore). It is served to clients as
   * `lastKnown` until the device reports a live fix; the GPS state is not changed.
   */
  seedLastFix(id: string, fix: GpsFix, receivedAt: number): void {
    const entry = this.entries.get(id);
    if (!entry || entry.lastFix) return;
    const clean = normalizeFix(fix);
    if (!clean) return;
    entry.lastFix = clean;
    entry.lastFixAt = receivedAt;
  }

  /** Recent raw device messages of a source, oldest first (for diagnostics). */
  recentFrames(id: string): RawFrame[] {
    return [...(this.entries.get(id)?.raw ?? [])];
  }

  // --- writes from sources ----------------------------------------------------------------

  private setLink(id: string, link: LinkState, message?: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.status.link === 'stopped' && link !== 'stopped') return;
    let gps: GpsState = entry.status.gps;
    if (link !== 'online') gps = gps === 'fix' || gps === 'stale' ? 'stale' : 'unknown';
    this.updateStatus(entry, { link, gps, message });
  }

  private setDevice(id: string, device: DeviceInfo): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const prev = entry.status.device;
    if (JSON.stringify(prev) === JSON.stringify(device)) return;
    if (prev?.model !== device.model || prev?.firmware !== device.firmware || prev?.name !== device.name) {
      const what = [device.vendor, device.model ?? device.name].filter(Boolean).join(' ') || 'unknown model';
      this.log.info(`${id}: device ${what}${device.firmware ? `, firmware ${device.firmware}` : ''}`);
      this.log.debug(`${id}: device info`, device);
    }
    entry.status = { ...entry.status, device };
    this.emit({ kind: 'status', snapshot: this.toSnapshot(entry) });
  }

  private publishFix(id: string, raw: GpsFix): void {
    const entry = this.entries.get(id);
    if (!entry || entry.status.link === 'stopped') return;
    const fix = normalizeFix(raw);
    if (!fix) {
      this.log.debug(`${id}: dropped invalid fix`, raw);
      return;
    }
    entry.lastFix = fix;
    entry.lastFixAt = this.now();
    this.updateStatus(entry, { link: 'online', gps: 'fix', message: undefined, satellites: fix.satellites });
    this.emit({ kind: 'fix', source: id, fix, active: this.activeId === id });
  }

  private publishNoFix(id: string, detail: { satellites?: number; hdop?: number } = {}): void {
    const entry = this.entries.get(id);
    if (!entry || entry.status.link === 'stopped') return;
    this.updateStatus(entry, { link: 'online', gps: 'no_fix', message: undefined, satellites: detail.satellites });
  }

  private publishMotion(id: string, sample: MotionSample): void {
    const entry = this.entries.get(id);
    if (!entry || entry.status.link === 'stopped') return;
    if (![sample.x, sample.y, sample.z, sample.timestamp].every(Number.isFinite)) return;
    entry.lastMotion = sample;
    this.emit({ kind: 'motion', source: id, sample });
  }

  private publishEvent(id: string, event: DeviceEvent): void {
    const entry = this.entries.get(id);
    if (!entry || entry.status.link === 'stopped' || !event.name) return;
    this.emit({ kind: 'event', source: id, event });
  }

  // --- internals ----------------------------------------------------------------------------

  private updateStatus(entry: Entry, patch: Partial<Omit<SourceStatus, 'since' | 'device'>>): void {
    const prev = entry.status;
    const next: SourceStatus = { ...prev, ...patch };
    if (patch.message === undefined && 'message' in patch) delete next.message;
    if (patch.satellites === undefined && 'satellites' in patch) delete next.satellites;
    const stateChanged = next.link !== prev.link || next.gps !== prev.gps;
    if (!stateChanged && next.message === prev.message && next.satellites === prev.satellites) return;
    if (stateChanged) next.since = this.now();
    entry.status = next;
    if (next.link !== prev.link || next.message !== prev.message) {
      const detail = next.message ? ` (${next.message})` : '';
      this.log.info(`${entry.info.id}: link ${next.link}${detail}`);
    }
    if (next.gps !== prev.gps) this.log.info(`${entry.info.id}: gps ${next.gps}`);
    const before = this.activeId;
    this.recomputeActive();
    this.emit({ kind: 'status', snapshot: this.toSnapshot(entry) });
    if (before !== this.activeId) {
      // The other side of the switch also changed its `active` flag.
      for (const id of [before, this.activeId]) {
        const other = id && id !== entry.info.id ? this.entries.get(id) : undefined;
        if (other) this.emit({ kind: 'status', snapshot: this.toSnapshot(other) });
      }
    }
  }

  private recomputeActive(): void {
    const ordered = this.priorityOrder();
    const withFix = ordered.find((e) => e.status.gps === 'fix');
    // Without any fix keep the previous choice (or the first GPS source) so clients know whom to wait for.
    const next = withFix ?? (this.activeId && this.entries.has(this.activeId) ? this.entries.get(this.activeId) : ordered[0]);
    const nextId = next?.info.id;
    if (nextId !== this.activeId) {
      if (nextId) this.log.info(`active GPS source: ${nextId}`);
      this.activeId = nextId;
    }
  }

  private priorityOrder(): Entry[] {
    const gpsEntries = [...this.entries.values()].filter(
      (e) => e.info.capabilities.includes('gps') && e.status.link !== 'stopped',
    );
    const rank = (e: Entry) => {
      const i = this.gpsPriority.indexOf(e.info.id);
      return i === -1 ? this.gpsPriority.length : i;
    };
    return gpsEntries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map((x) => x.e);
  }

  private checkStale(): void {
    const now = this.now();
    for (const entry of this.entries.values()) {
      if (entry.status.gps === 'fix' && entry.lastFixAt !== undefined && now - entry.lastFixAt > this.staleAfterMs) {
        this.updateStatus(entry, { gps: 'stale' });
      }
    }
  }

  private toSnapshot(entry: Entry): SourceSnapshot {
    return {
      ...entry.info,
      status: entry.status,
      ...(entry.lastFix && { lastFix: entry.lastFix, lastFixAt: entry.lastFixAt }),
      ...(entry.lastMotion && { lastMotion: entry.lastMotion }),
      active: this.activeId === entry.info.id,
    };
  }

  private emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        this.log.error('hub listener failed', err);
      }
    }
  }
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};
const finite = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/** Validates a fix and trims it to sensible precision. Returns `undefined` for impossible values. */
export function normalizeFix(fix: GpsFix): GpsFix | undefined {
  const { lat, lon } = fix;
  if (!finite(lat) || !finite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  // 0,0 is what many receivers report before their first lock.
  if (lat === 0 && lon === 0) return undefined;
  const out: GpsFix = { lat: round(lat, 7), lon: round(lon, 7), timestamp: finite(fix.timestamp) ? fix.timestamp : Date.now() };
  if (finite(fix.speed) && fix.speed >= 0) out.speed = round(fix.speed, 2);
  const moving = out.speed === undefined || out.speed >= MIN_SPEED_FOR_HEADING;
  if (finite(fix.heading) && moving) out.heading = round(((fix.heading % 360) + 360) % 360, 1);
  if (finite(fix.altitude)) out.altitude = round(fix.altitude, 1);
  if (finite(fix.satellites) && fix.satellites >= 0) out.satellites = Math.round(fix.satellites);
  if (finite(fix.hdop) && fix.hdop >= 0) out.hdop = round(fix.hdop, 2);
  if (finite(fix.quality) && fix.quality >= 0) out.quality = Math.round(fix.quality);
  if (finite(fix.geoidSeparation)) out.geoidSeparation = round(fix.geoidSeparation, 1);
  if (typeof fix.mode === 'string' && /^[A-Z]$/.test(fix.mode)) out.mode = fix.mode;
  return out;
}
