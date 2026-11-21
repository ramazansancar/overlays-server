import type { Hub } from '../core/hub.ts';
import {
  fixMessage,
  motionMessage,
  PROTOCOL_VERSION,
  SERVER_NAME,
  statusMessage,
  type ServerMessage,
} from '../core/protocol.ts';
import { VERSION } from '../version.ts';

export interface FeedOptions {
  /** `auto` = whichever source is active, otherwise one source id. */
  subscription: string;
  motion: boolean;
  motionMaxHz: number;
}

/** Reads `?source=` and `?motion=` from a client URL. Returns an error text for unknown sources. */
export function feedOptionsFromUrl(url: URL, hub: Hub, motionMaxHz: number): FeedOptions | string {
  const subscription = url.searchParams.get('source') || 'auto';
  if (subscription !== 'auto' && !hub.has(subscription)) return `unknown source "${subscription}"`;
  const motion = ['1', 'true', 'yes'].includes(url.searchParams.get('motion') ?? '');
  return { subscription, motion: motion && motionMaxHz > 0, motionMaxHz };
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
  const follows = (source: string, active: boolean) => (isAuto ? active : source === options.subscription);
  const minMotionGapMs = options.motionMaxHz > 0 ? 1000 / options.motionMaxHz : Infinity;
  let lastMotionAt = 0;

  send({
    type: 'hello',
    server: SERVER_NAME,
    version: VERSION,
    protocol: PROTOCOL_VERSION,
    subscription: options.subscription,
    ...(hub.activeGpsSource && { activeSource: hub.activeGpsSource }),
  });
  for (const snapshot of hub.snapshots()) send(statusMessage(snapshot));
  const current = hub.snapshots().find((s) => follows(s.id, s.active));
  if (current?.lastFix && current.status.gps === 'fix') send(fixMessage(current.id, current.lastFix));

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
        if (now - lastMotionAt < minMotionGapMs || !canSendOptional()) break;
        lastMotionAt = now;
        send(motionMessage(event.source, event.sample));
        break;
      }
    }
  });
}
