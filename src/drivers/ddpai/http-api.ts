/**
 * Read-only calls to the camera's HTTP API (`/vcam/cmd.cgi?cmd=...`).
 * Replies look like `{"errcode":0,"data":"<JSON string>"}`.
 *
 * Careful: API_GetBaseInfo also returns the camera's Wi-Fi password in plain text. Only the
 * whitelisted fields below ever leave this module; the raw reply is never logged.
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

/** Model and firmware from API_GetBaseInfo, nothing else. */
export function pickDeviceInfo(data: unknown): DeviceInfo {
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const model = text(d.model)?.replace(/^DDPAI\s+/i, '');
  const firmware = text(d.version);
  return { vendor: 'DDPAI', ...(model && { model }), ...(firmware && { firmware }) };
}

export async function fetchDeviceInfo(
  host: string,
  port: number,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DeviceInfo> {
  return pickDeviceInfo(await ddpaiCommand(host, port, 'API_GetBaseInfo', options));
}
