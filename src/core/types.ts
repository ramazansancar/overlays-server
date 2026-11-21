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
  /** GGA fix quality: 1 = GPS, 2 = DGPS, 4 = RTK fixed, 5 = RTK float, 6 = dead reckoning. */
  quality?: number;
  /** Height of the geoid above the WGS84 ellipsoid (m); altitude + this = ellipsoid height. */
  geoidSeparation?: number;
  /** RMC mode: A = autonomous, D = differential, E = estimated, ... */
  mode?: string;
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

/** A live video stream the device offers (for OBS, not for the browser). */
export interface DeviceStream {
  /** `front`, `rear`, ... */
  name: string;
  url: string;
}

/** What the device says about itself. Never put secrets (Wi-Fi passwords, serials, MACs, keys) in here. */
export interface DeviceInfo {
  vendor?: string;
  model?: string;
  firmware?: string;
  name?: string;
  /** Memory card. */
  storage?: { totalBytes: number; freeBytes: number };
  /** Number of camera sensors (2 = front + rear). */
  cameras?: number;
  streams?: DeviceStream[];
  /** Every other non-secret field the device reports, as is (names are device specific). */
  details?: Record<string, string | number | boolean>;
  /** Epoch ms when this was read. */
  updatedAt?: number;
}

/** Connection to the device. */
export type LinkState = 'starting' | 'connecting' | 'online' | 'offline' | 'stopped';

/** Position quality, independent of the link. `stale`: fixes were coming but stopped. */
export type GpsState = 'unknown' | 'no_fix' | 'fix' | 'stale';

/**
 * Anything else the device pushes (alerts, button presses, unknown message types), passed through untouched so
 * overlays can use it before the server learns its meaning.
 */
export interface DeviceEvent {
  /** Device specific name, e.g. the DDPAI `msgid`. */
  name: string;
  data: unknown;
  timestamp: number;
}

/** Kinds of data a driver can publish. */
export type Capability = 'gps' | 'motion' | 'device' | 'events';

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
