/**
 * `/v1/diagnostics`: one JSON file a streamer can attach to an issue. It holds what is needed to understand (and
 * replay with the fake device) a problem: recent raw device messages, recent log lines, source states, the effective
 * config and the runtime. Wi-Fi credentials, serials and MACs are always masked; positions unless the user opts in.
 */
import os from 'node:os';
import type { AppConfig } from '../config.ts';
import type { Hub } from '../core/hub.ts';
import { PROTOCOL_VERSION, SERVER_NAME } from '../core/protocol.ts';
import type { LogBuffer } from '../lib/log.ts';
import { redact } from '../lib/redact.ts';
import { VERSION } from '../version.ts';

export const DIAGNOSTICS_FORMAT = 1;

export interface DiagnosticsInput {
  hub: Hub;
  config: AppConfig;
  logBuffer: LogBuffer;
  startedAt: number;
  keepPositions: boolean;
}

export function diagnosticsFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `overlays-server-diagnostics-${stamp}.json`;
}

export function buildDiagnostics(input: DiagnosticsInput) {
  const { hub, config, logBuffer, keepPositions } = input;
  const clean = (text: string) => redact(text, { keepPositions });
  const cleanJson = <T>(value: T): T => JSON.parse(clean(JSON.stringify(value))) as T;
  const now = Date.now();

  return {
    format: DIAGNOSTICS_FORMAT,
    generatedAt: new Date(now).toISOString(),
    positionsIncluded: keepPositions,
    server: {
      name: SERVER_NAME,
      version: VERSION,
      protocol: PROTOCOL_VERSION,
      uptimeSec: Math.round((now - input.startedAt) / 1000),
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      // UTC offset helps line up GPS (UTC) times with log times.
      utcOffsetMinutes: -new Date().getTimezoneOffset(),
    },
    config: cleanJson({ ...config, ...(config.token && { token: 'REDACTED' }) }),
    activeSource: hub.activeGpsSource ?? null,
    sources: hub.snapshots().map((s) => ({
      ...cleanJson(s),
      // Oldest first; `t` = arrival time (epoch ms). Replay with: pnpm dev:fake-camera -- --replay <file>.
      recentFrames: hub.recentFrames(s.id).map((f) => ({ t: f.t, frame: clean(f.frame) })),
    })),
    logs: logBuffer.snapshot().map(clean),
  };
}
