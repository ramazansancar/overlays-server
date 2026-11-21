import type { Logger } from '../lib/log.ts';
import type { OptionReader } from '../lib/options.ts';
import type { Capability, DeviceEvent, DeviceInfo, GpsFix, LinkState, MotionSample } from './types.ts';

/**
 * What a running source gets from the server. Drivers only talk to the outside world through this,
 * so the hub can track state, detect stale data and fan out to clients without knowing the device.
 */
export interface SourceContext {
  /** Instance id from the config (e.g. `ddpai`, `front-cam`). */
  readonly id: string;
  readonly log: Logger;
  /** Aborted when the source is stopped; pass it to fetch() / timers. */
  readonly signal: AbortSignal;

  setLink(state: LinkState, message?: string): void;
  setDevice(info: DeviceInfo): void;
  /** A valid position. */
  publishFix(fix: GpsFix): void;
  /** The device is talking but has no position (no satellite lock yet). */
  publishNoFix(detail?: { satellites?: number; hdop?: number }): void;
  publishMotion(sample: MotionSample): void;
  /** Any other device message, passed to clients that asked for events. */
  publishEvent(event: DeviceEvent): void;
}

/** A running instance of a driver. */
export interface Source {
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
}

/**
 * A device type. To support a new camera / GPS, write one of these and add it to `src/drivers/index.ts`.
 *
 * `parseOptions` gets the `options` object of a config entry and turns it into typed options
 * (throw `ConfigError` for bad values). `create` builds the source; it must not connect yet:
 * the server calls `start()` when it is ready.
 */
export interface Driver<Options = unknown> {
  /** Value of `driver` in the config. Lowercase, no spaces. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capabilities: readonly Capability[];
  parseOptions(options: OptionReader): Options;
  create(ctx: SourceContext, options: Options): Source;
}

/** Identity helper that keeps the options type of a driver checked. */
export function defineDriver<Options>(driver: Driver<Options>): Driver<Options> {
  return driver;
}

/** Any driver, options type erased (for registries and lists). */
export type AnyDriver = Driver<any>;
