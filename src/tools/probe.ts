/**
 * `overlays-server --probe <host>`: looks at a device on the network and prints a Markdown report for
 * a GitHub issue, so support for new cameras can be added without having the device:
 * open ports, HTTP / RTSP server names, DDPAI-style model and firmware, and samples of any data the
 * device pushes on its own (telemetry streams). Personal data is masked (see lib/redact.ts).
 * Read-only: only connects, reads, and sends harmless GET / OPTIONS requests.
 */
import net from 'node:net';
import { errorMessage } from '../lib/log.ts';
import { redact } from '../lib/redact.ts';
import { VERSION } from '../version.ts';

export const DEFAULT_PROBE_PORTS = [21, 23, 80, 443, 554, 1935, 3000, 5000, 6000, 6100, 6200, 7000, 8000, 8080, 8554, 8888, 9000];

export interface ProbeOptions {
  ports?: number[];
  /** How long to wait for unsolicited data on each open port. */
  listenMs?: number;
  connectTimeoutMs?: number;
  onProgress?: (message: string) => void;
}

export interface PortReport {
  port: number;
  kind: 'stream' | 'http' | 'rtsp' | 'silent';
  server?: string;
  status?: string;
  bytes?: number;
  delimiter?: 'NUL' | 'newline' | 'none';
  frames?: number;
  /** DDPAI-style `msgid`s or NMEA sentence types seen, with counts. */
  messageTypes?: Record<string, number>;
  samples?: string[];
  note?: string;
}

export interface ProbeReport {
  host: string;
  startedAt: string;
  openPorts: number[];
  closedPorts: number[];
  ports: PortReport[];
  device?: { api: string; fields: Record<string, string>; keys: string[] };
}

function connect(host: string, port: number, timeoutMs: number): Promise<net.Socket | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

/** Reads whatever arrives within `ms` (optionally after sending `request`), up to `maxBytes`. */
async function exchange(host: string, port: number, opts: { request?: string; ms: number; timeoutMs: number; maxBytes?: number }) {
  const socket = await connect(host, port, opts.timeoutMs);
  if (!socket) return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  const max = opts.maxBytes ?? 64 * 1024;
  return new Promise<Buffer>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(done, opts.ms);
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= max) done();
    });
    socket.on('error', done);
    socket.on('close', done);
    if (opts.request) socket.write(opts.request);
  });
}

function headerValue(head: string, name: string): string | undefined {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(head);
  return match?.[1]?.trim();
}

function describeStream(data: Buffer): Omit<PortReport, 'port' | 'kind'> {
  const nul = data.includes(0x00);
  const delimiter = nul ? 'NUL' : data.includes(0x0a) ? 'newline' : 'none';
  const text = data.toString('utf8');
  const frames = (delimiter === 'NUL' ? text.split('\0') : delimiter === 'newline' ? text.split(/\r?\n/) : [text])
    .map((f) => f.trim())
    .filter(Boolean);
  const types: Record<string, number> = {};
  const firstOfType = new Map<string, string>();
  for (const frame of frames) {
    const type =
      /"msgid"\s*:\s*"([^"]+)"/.exec(frame)?.[1] ??
      /^\$([A-Z]{2}[A-Z]{3}),/.exec(frame)?.[1] ??
      /"(?:type|cmd|event)"\s*:\s*"([^"]+)"/.exec(frame)?.[1] ??
      '(other)';
    types[type] = (types[type] ?? 0) + 1;
    if (!firstOfType.has(type)) firstOfType.set(type, frame);
  }
  const samples = [...firstOfType.values()].slice(0, 6).map((f) => {
    const clean = redact(f).replace(/[^\x20-\x7e]/g, '.');
    return clean.length > 400 ? `${clean.slice(0, 400)}… (${clean.length} chars)` : clean;
  });
  return { bytes: data.length, delimiter, frames: frames.length, messageTypes: types, samples };
}

async function probePort(host: string, port: number, o: Required<Omit<ProbeOptions, 'onProgress' | 'ports'>>): Promise<PortReport> {
  // 1) Does the device talk on its own? (telemetry streams like DDPAI's 6100)
  const passive = await exchange(host, port, { ms: o.listenMs, timeoutMs: o.connectTimeoutMs });
  if (passive && passive.length > 0) return { port, kind: 'stream', ...describeStream(passive) };

  // 2) RTSP?
  if (port === 554 || port === 8554) {
    const reply = await exchange(host, port, {
      request: `OPTIONS rtsp://${host}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: overlays-server-probe\r\n\r\n`,
      ms: 1500,
      timeoutMs: o.connectTimeoutMs,
    });
    const head = reply?.toString('latin1') ?? '';
    if (head.startsWith('RTSP/')) {
      return { port, kind: 'rtsp', status: head.split('\r\n')[0], ...(headerValue(head, 'Server') && { server: headerValue(head, 'Server') }) };
    }
  }

  // 3) HTTP?
  const reply = await exchange(host, port, {
    request: `GET / HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: overlays-server-probe\r\n\r\n`,
    ms: 1500,
    timeoutMs: o.connectTimeoutMs,
    maxBytes: 4096,
  });
  const head = reply?.toString('latin1') ?? '';
  if (head.startsWith('HTTP/')) {
    return { port, kind: 'http', status: head.split('\r\n')[0], ...(headerValue(head, 'Server') && { server: headerValue(head, 'Server') }) };
  }
  return { port, kind: 'silent', note: 'open, but sent nothing and did not answer HTTP/RTSP' };
}

const DEVICE_FIELDS = /^(model|version|firmware|fw.*|hw.*|hardware.*|mcu.?version|product.*|brand|vendor|type)$/i;

/** DDPAI-style `/vcam/cmd.cgi?cmd=API_GetBaseInfo`: model/firmware values, other keys by name only. */
async function probeDdpaiApi(host: string, port: number): Promise<ProbeReport['device'] | undefined> {
  for (const path of ['/vcam/cmd.cgi?cmd=API_GetBaseInfo', '/cmd.cgi?cmd=API_GetBaseInfo']) {
    try {
      const res = await fetch(`http://${host}:${port}${path}`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) continue;
      const body = (await res.json()) as { errcode?: unknown; data?: unknown };
      if (body.errcode !== 0) continue;
      const data = (typeof body.data === 'string' ? JSON.parse(body.data) : body.data) as Record<string, unknown>;
      if (!data || typeof data !== 'object') continue;
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) {
        if (DEVICE_FIELDS.test(k) && (typeof v === 'string' || typeof v === 'number')) fields[k] = String(v);
      }
      return { api: path, fields, keys: Object.keys(data) };
    } catch {
      /* not this API */
    }
  }
  return undefined;
}

export async function probeDevice(host: string, options: ProbeOptions = {}): Promise<ProbeReport> {
  const ports = options.ports ?? DEFAULT_PROBE_PORTS;
  const o = { listenMs: options.listenMs ?? 4000, connectTimeoutMs: options.connectTimeoutMs ?? 1500 };
  const progress = options.onProgress ?? (() => {});
  const report: ProbeReport = { host, startedAt: new Date().toISOString(), openPorts: [], closedPorts: [], ports: [] };

  progress(`scanning ${ports.length} ports on ${host}…`);
  const open = await Promise.all(
    ports.map(async (port) => {
      const socket = await connect(host, port, o.connectTimeoutMs);
      socket?.destroy();
      return socket ? port : undefined;
    }),
  );
  report.openPorts = open.filter((p): p is number => p !== undefined);
  report.closedPorts = ports.filter((p) => !report.openPorts.includes(p));
  if (report.openPorts.length === 0) return report;

  progress(`open: ${report.openPorts.join(', ')}. Listening ${o.listenMs / 1000} s on each…`);
  report.ports = await Promise.all(report.openPorts.map((port) => probePort(host, port, o)));

  for (const p of report.ports.filter((x) => x.kind === 'http')) {
    const device = await probeDdpaiApi(host, p.port);
    if (device) {
      report.device = device;
      break;
    }
  }
  return report;
}

export function formatProbeReport(r: ProbeReport): string {
  const lines: string[] = [];
  lines.push(`### overlays-server probe`, '');
  lines.push(`- overlays-server ${VERSION}, node ${process.version}, ${process.platform}`);
  lines.push(`- Target: \`${r.host}\``);
  lines.push(`- Open ports: ${r.openPorts.length ? r.openPorts.map((p) => `\`${p}\``).join(', ') : 'none'}`);
  if (r.openPorts.length === 0) {
    lines.push('', 'No open ports found. Is this PC connected to the device\'s Wi-Fi, and is the address right?');
    return lines.join('\n');
  }
  if (r.device) {
    lines.push('', `**Device info** (\`${r.device.api}\`)`, '');
    for (const [k, v] of Object.entries(r.device.fields)) lines.push(`- ${k}: \`${v}\``);
    lines.push(`- other fields (names only): ${r.device.keys.filter((k) => !(k in r.device!.fields)).join(', ')}`);
  }
  lines.push('', '| Port | Kind | Details |', '| --- | --- | --- |');
  for (const p of r.ports) {
    const details =
      p.kind === 'stream'
        ? `${p.bytes} bytes, ${p.frames} frames, delimiter: ${p.delimiter}; types: ${Object.entries(p.messageTypes ?? {})
            .map(([t, n]) => `${t}×${n}`)
            .join(', ')}`
        : [p.status, p.server && `server: ${p.server}`, p.note].filter(Boolean).join('; ');
    lines.push(`| ${p.port} | ${p.kind} | ${details.replace(/\|/g, '\\|')} |`);
  }
  for (const p of r.ports.filter((x) => x.samples?.length)) {
    lines.push('', `**Samples from port ${p.port}** (one per message type, personal data masked)`, '', '```text');
    lines.push(...p.samples!);
    lines.push('```');
  }
  lines.push('', '_Check the samples above before posting: positions, Wi-Fi names/passwords, serials and MACs should show as x / REDACTED._');
  return lines.join('\n');
}

/** CLI entry: prints the report to stdout, progress to stderr (so `> file` / `| clip` get only the report). */
export async function runProbe(host: string, options: ProbeOptions = {}): Promise<number> {
  try {
    const report = await probeDevice(host, { ...options, onProgress: (m) => console.error(`probe: ${m}`) });
    console.log(formatProbeReport(report));
    return report.openPorts.length ? 0 : 1;
  } catch (err) {
    console.error(`probe failed: ${errorMessage(err)}`);
    return 1;
  }
}
