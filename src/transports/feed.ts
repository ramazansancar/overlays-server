import type { Hub } from '../core/hub.ts';
import {
  eventMessage,
  fixMessage,
  motionMessage,
  PROTOCOL_VERSION,
  SERVER_NAME,
  statusMessage,
  type ServerMessage,
} from '../core/protocol.ts';
import { VERSION } from '../version.ts';

export interface FeedOptions {
  /** `auto` = whichever source is active, `*` = every source (status page), otherwise one source id. */
  subscription: string;
  motion: boolean;
  motionMaxHz: number;
  /** Pass device events (unknown / extra message types) through. */
  events: boolean;
}

const flag = (url: URL, name: string) => ['1', 'true', 'yes'].includes(url.searchParams.get(name) ?? '');

/**
 * Reads `?source=`, `?motion=1`, `?events=1` and `?all=1` (motion + events) from a client URL.
 * Returns an error text for unknown sources.
 */
export function feedOptionsFromUrl(url: URL, hub: Hub, motionMaxHz: number): FeedOptions | string {
  const subscription = url.searchParams.get('source') || 'auto';
  if (subscription !== 'auto' && subscription !== '*' && !hub.has(subscription)) return `unknown source "${subscription}"`;
  const all = flag(url, 'all');
  const motion = all || flag(url, 'motion');
  return { subscription, motion: motion && motionMaxHz > 0, motionMaxHz, events: all || flag(url, 'events') };
}

/**
 * One client's message stream, shared by the WebSocket and SSE transports: a snapshot first
 * (hello, every source's status, the current fix), then live events filtered by the subscription.
 *
 * `canSendOptional` lets a transport drop high-rate messages (motion) while its buffer is full.
 */
export function openFeed(
  hub: Hub,
  options: FeedOptions,
  send: (message: ServerMessage) => void,
  canSendOptional: () => boolean = () => true,
): () => void {
  const isAuto = options.subscription === 'auto';
  const isAll = options.subscription === '*';
  const follows = (source: string, active: boolean) => isAll || (isAuto ? active : source === options.subscription);
  const minMotionGapMs = options.motionMaxHz > 0 ? 1000 / options.motionMaxHz : Infinity;
  const lastMotionAt = new Map<string, number>();

  send({
    type: 'hello',
    server: SERVER_NAME,
    version: VERSION,
    protocol: PROTOCOL_VERSION,
    subscription: options.subscription,
    ...(hub.activeGpsSource && { activeSource: hub.activeGpsSource }),
  });
  const snapshots = hub.snapshots();
  for (const snapshot of snapshots) send(statusMessage(snapshot));
  if (isAll) {
    // Every source's last known position (even stale: the status says how old it is).
    for (const s of snapshots) if (s.lastFix) send(fixMessage(s.id, s.lastFix));
  } else {
    const current = snapshots.find((s) => follows(s.id, s.active));
    if (current?.lastFix && current.status.gps === 'fix') send(fixMessage(current.id, current.lastFix));
  }

  return hub.subscribe((event) => {
    switch (event.kind) {
      case 'status':
        send(statusMessage(event.snapshot));
        break;
      case 'fix':
        if (follows(event.source, event.active)) send(fixMessage(event.source, event.fix));
        break;
      case 'motion': {
        if (!options.motion) break;
        const active = hub.activeGpsSource === event.source;
        if (!follows(event.source, active)) break;
        const now = Date.now();
        if (now - (lastMotionAt.get(event.source) ?? 0) < minMotionGapMs || !canSendOptional()) break;
        lastMotionAt.set(event.source, now);
        send(motionMessage(event.source, event.sample));
        break;
      }
      case 'event': {
        if (!options.events) break;
        if (!isAuto && !follows(event.source, hub.activeGpsSource === event.source)) break;
        send(eventMessage(event.source, event.event));
        break;
      }
    }
  });
}
