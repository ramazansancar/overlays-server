/**
 * Wire protocol v1 between overlays-server and overlays (WebSocket messages and SSE events).
 * Every message is a JSON object with a `type`. Clients must ignore unknown types and fields:
 * new ones may be added without bumping the version; removing or changing one bumps it.
 */
import type { SourceSnapshot } from './hub.ts';
import type { DeviceInfo, GpsFix, GpsState, LinkState, MotionSample } from './types.ts';

export const PROTOCOL_VERSION = 1;
export const SERVER_NAME = 'overlays-server';

export interface HelloMessage {
  type: 'hello';
  server: typeof SERVER_NAME;
  version: string;
  protocol: typeof PROTOCOL_VERSION;
  /** Which GPS stream this connection gets: `auto` (active source) or a source id. */
  subscription: string;
  /** Source currently feeding `auto`. */
  activeSource?: string;
}

export interface StatusMessage {
  type: 'status';
  source: string;
  driver: string;
  link: LinkState;
  gps: GpsState;
  active: boolean;
  message?: string;
  satellites?: number;
  device?: DeviceInfo;
  /** Epoch ms of the last link/gps change. */
  since: number;
}

export interface FixMessage extends GpsFix {
  type: 'fix';
  source: string;
}

export interface MotionMessage extends MotionSample {
  type: 'motion';
  source: string;
}

export type ServerMessage = HelloMessage | StatusMessage | FixMessage | MotionMessage;

export function statusMessage(s: SourceSnapshot): StatusMessage {
  return {
    type: 'status',
    source: s.id,
    driver: s.driver,
    link: s.status.link,
    gps: s.status.gps,
    active: s.active,
    ...(s.status.message !== undefined && { message: s.status.message }),
    ...(s.status.satellites !== undefined && { satellites: s.status.satellites }),
    ...(s.status.device && { device: s.status.device }),
    since: s.status.since,
  };
}

export function fixMessage(source: string, fix: GpsFix): FixMessage {
  return { type: 'fix', source, ...fix };
}

export function motionMessage(source: string, sample: MotionSample): MotionMessage {
  return { type: 'motion', source, ...sample };
}
