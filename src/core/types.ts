/**
 * Data every source can produce. Field names and units match the overlay site's `Fix` type
 * (src/overlays/map/location.ts in stream-overlays), so a fix can be handed over unchanged.
 */
export interface GpsFix {
  lat: number;
  lon: number;
  /** Degrees from true north, 0-360. Left out while standing still (course is noise then). */
  heading?: number;
  /** Meters per second. */
  speed?: number;
  /** Meters above mean sea level. */
  altitude?: number;
  satellites?: number;
  hdop?: number;
  /** UTC epoch milliseconds of the fix (GPS time when the device sends it). */
  timestamp: number;
}

/** Acceleration in g, device axes. */
export interface MotionSample {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

/** What the device says about itself. Never put secrets (Wi-Fi passwords, keys) in here. */
export interface DeviceInfo {
  vendor?: string;
  model?: string;
  firmware?: string;
  name?: string;
}

/** Connection to the device. */
export type LinkState = 'starting' | 'connecting' | 'online' | 'offline' | 'stopped';

/** Position quality, independent of the link. `stale`: fixes were coming but stopped. */
export type GpsState = 'unknown' | 'no_fix' | 'fix' | 'stale';

/** Kinds of data a driver can publish. */
export type Capability = 'gps' | 'motion' | 'device';

export interface SourceStatus {
  link: LinkState;
  gps: GpsState;
  /** Human readable detail for the current state (last error, hint). */
  message?: string;
  /** Satellites in use, when known (also while searching for a fix). */
  satellites?: number;
  device?: DeviceInfo;
  /** Epoch ms of the last link/gps change. */
  since: number;
}
