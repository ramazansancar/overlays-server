/**
 * Read-only calls to the camera's HTTP API (`/vcam/cmd.cgi?cmd=...`).
 * Replies look like `{"errcode":0,"data":"<JSON string>"}`.
 *
 * Careful: API_GetBaseInfo also returns the camera's Wi-Fi password, serial numbers and MAC addresses in plain text.
 * Those never leave this module (see SECRET_FIELD); the raw reply is never logged.
 */
import type { DeviceInfo } from '../../core/types.ts';

export class DdpaiApiError extends Error {
  override name = 'DdpaiApiError';
}

export async function ddpaiCommand(
  host: string,
  port: number,
  cmd: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 3000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const url = `http://${host}:${port}/vcam/cmd.cgi?cmd=${encodeURIComponent(cmd)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new DdpaiApiError(`${cmd}: HTTP ${res.status}`);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new DdpaiApiError(`${cmd}: reply is not JSON`);
  }
  const reply = body as { errcode?: unknown; data?: unknown };
  if (reply.errcode !== 0) throw new DdpaiApiError(`${cmd}: errcode ${String(reply.errcode)}`);
  if (typeof reply.data === 'string') {
    try {
      return JSON.parse(reply.data);
    } catch {
      return reply.data;
    }
  }
  return reply.data;
}

/**
 * Fields that identify the camera or its owner, or unlock it. Matched by name so unknown firmwares that add e.g.
 * `wifi_pwd` or `bt_mac` stay covered. Seen on N5 Pro: password, nickname (Wi-Fi name), ordernum, uuid, sn, macaddr,
 * chipsn, btmacaddr, random, upgrade_key.
 */
const SECRET_FIELD = /pass|pwd|psk|ssid|token|secret|key|serial|(^|_)sn$|chipsn|uuid|imei|mac|nick|order|random|account|user|phone|mail/i;

export interface DeviceInfoOptions {
  /** Camera address, for the RTSP URLs. */
  host: string;
  rtspPort: number;
}

/**
 * Everything usable from API_GetBaseInfo: model, firmware, memory card, camera count, RTSP streams, and every other
 * non-secret field under `details`.
 */
export function pickDeviceInfo(data: unknown, options: DeviceInfoOptions, now = Date.now()): DeviceInfo {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const count = (v: unknown) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const model = text(d.model)?.replace(/^DDPAI\s+/i, '');
  const firmware = text(d.version);

  // Memory card size and free space. Unit inferred from an N5 Pro with a 512 GB card: sdcapacity 499939456 → KiB
  // (476.8 GiB). 0 / missing when no card is inserted.
  const capacityKiB = count(d.sdcapacity);
  const spareKiB = count(d.sdspare);
  const storage =
    capacityKiB && spareKiB !== undefined ? { totalBytes: capacityKiB * 1024, freeBytes: Math.min(spareKiB, capacityKiB) * 1024 } : undefined;

  const cameras = count(d.sensor_cnt);
  const host = options.host.includes(':') ? `[${options.host}]` : options.host;
  const rtsp = (channel: string) => `rtsp://${host}:${options.rtspPort}/liveRTSP/${channel}`;
  // av4 = front, av5 = rear (live preview sub-streams; the full resolution recording is not streamed).
  const streams = [{ name: 'front', url: rtsp('av4') }, ...(cameras !== undefined && cameras >= 2 ? [{ name: 'rear', url: rtsp('av5') }] : [])];

  const details: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(d)) {
    if (key === 'model' || key === 'version' || SECRET_FIELD.test(key)) continue;
    if (typeof value === 'number' || typeof value === 'boolean') details[key] = value;
    else if (typeof value === 'string' && value.length <= 120) details[key] = value;
  }

  return {
    vendor: 'DDPAI',
    ...(model && { model }),
    ...(firmware && { firmware }),
    ...(storage && { storage }),
    ...(cameras !== undefined && { cameras }),
    streams,
    details,
    updatedAt: now,
  };
}

export async function fetchDeviceInfo(
  options: DeviceInfoOptions & { httpPort: number; signal?: AbortSignal; timeoutMs?: number },
): Promise<DeviceInfo> {
  const data = await ddpaiCommand(options.host, options.httpPort, 'API_GetBaseInfo', options);
  return pickDeviceInfo(data, options);
}
