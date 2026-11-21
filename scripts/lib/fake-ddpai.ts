/**
 * A stand-in for a DDPAI dashcam: the TCP 6100 telemetry stream (same framing and message shapes as
 * a real N5 Pro) and the two read-only cmd.cgi calls the driver uses. For development and tests.
 */
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { nmeaChecksum } from '../../src/lib/nmea.ts';

/** Like the real camera: checksum computed for the `GN` talker, sentence sent as `GP`. */
export function ddpaiSentence(body: string): string {
  return '$' + body + '*' + nmeaChecksum('GN' + body.slice(2));
}

export interface FakeDdpaiOptions {
  host?: string;
  /** 0 = pick a free port. */
  telemetryPort?: number;
  httpPort?: number;
  /** Center of the fake drive (defaults: Kızılay, Ankara). */
  lat?: number;
  lon?: number;
  speedKmh?: number;
  /** Send `V` (no fix) sentences instead of positions. */
  noFix?: boolean;
  gpsIntervalMs?: number;
  gsensorIntervalMs?: number;
}

export interface FakeDdpai {
  telemetryPort: number;
  httpPort: number;
  /** Number of telemetry clients connected right now. */
  clients(): number;
  /** Drops every telemetry connection (simulates the camera Wi-Fi going away). */
  dropClients(): void;
  setNoFix(noFix: boolean): void;
  close(): Promise<void>;
}

const pad = (n: number, width: number) => String(Math.floor(n)).padStart(width, '0');

/** Decimal degrees to NMEA `ddmm.mmmm` / `dddmm.mmmm`. */
function toNmea(value: number, degreeDigits: number): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return pad(deg, degreeDigits) + min.toFixed(4).padStart(7, '0');
}

export function gpsFrame(at: Date, fix: { lat: number; lon: number; knots: number; course: number } | undefined): string {
  const time = `${pad(at.getUTCHours(), 2)}${pad(at.getUTCMinutes(), 2)}${pad(at.getUTCSeconds(), 2)}.00`;
  const date = `${pad(at.getUTCDate(), 2)}${pad(at.getUTCMonth() + 1, 2)}${pad(at.getUTCFullYear() % 100, 2)}`;
  let rmc: string;
  let gga: string;
  if (fix) {
    const lat = `${toNmea(fix.lat, 2)},${fix.lat >= 0 ? 'N' : 'S'}`;
    const lon = `${toNmea(fix.lon, 3)},${fix.lon >= 0 ? 'E' : 'W'}`;
    rmc = ddpaiSentence(`GPRMC,${time},A,${lat},${lon},${fix.knots.toFixed(2)},${fix.course.toFixed(2)},${date},,,A,V`);
    gga = ddpaiSentence(`GPGGA,${time},${lat},${lon},1,24,0.6,905.123,M,0.000,M,,`);
  } else {
    rmc = ddpaiSentence(`GPRMC,${time},V,,,,,,,${date},,,N,V`);
    gga = ddpaiSentence(`GPGGA,${time},,,,,0,03,,,M,,M,,`);
  }
  const data = JSON.stringify({ gpsdata: `${rmc}\n`, ggadata: `${gga}\n` });
  return JSON.stringify({ msgid: 'MSG_GpsData', data });
}

export function gsensorFrame(at: number): string {
  const data = JSON.stringify({ gsensordata: `$GSENSOR,-35,-98,1054,${at}` });
  return JSON.stringify({ msgid: 'MSG_GsensorData', data });
}

export async function startFakeDdpai(options: FakeDdpaiOptions = {}): Promise<FakeDdpai> {
  const host = options.host ?? '127.0.0.1';
  const centerLat = options.lat ?? 39.92077;
  const centerLon = options.lon ?? 32.85411;
  const speedKmh = options.speedKmh ?? 36;
  let noFix = options.noFix ?? false;
  const sockets = new Set<net.Socket>();
  let angle = 0;

  const broadcast = (frame: string) => {
    for (const s of sockets) s.write(`${frame}\0`);
  };

  const gpsTimer = setInterval(() => {
    const radius = 250;
    const ms = speedKmh / 3.6;
    angle += (ms * (options.gpsIntervalMs ?? 1000)) / 1000 / radius;
    const fix = {
      lat: centerLat + (radius * Math.cos(angle)) / 111_320,
      lon: centerLon + (radius * Math.sin(angle)) / (111_320 * Math.cos((centerLat * Math.PI) / 180)),
      knots: ms / (1852 / 3600),
      course: ((angle * 180) / Math.PI + 90) % 360,
    };
    broadcast(gpsFrame(new Date(), noFix ? undefined : fix));
  }, options.gpsIntervalMs ?? 1000);
  const gsensorTimer = setInterval(() => broadcast(gsensorFrame(Date.now())), options.gsensorIntervalMs ?? 62);

  const tcp = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => tcp.listen(options.telemetryPort ?? 0, host, resolve));

  const api = http.createServer((req, res) => {
    const cmd = new URL(req.url ?? '/', 'http://x').searchParams.get('cmd');
    const reply = (data: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ errcode: 0, data: JSON.stringify(data) }));
    };
    if (cmd === 'API_GetBaseInfo') {
      // The real camera also returns its Wi-Fi password here; the driver must never pass it on.
      return reply({ nickname: 'DDPAI_FAKE_0000', password: 'do-not-leak', model: 'DDPAI FAKE_Model', version: 'v0.0.0.1' });
    }
    if (cmd === 'API_GetGpsState') return reply({ gpsstate: noFix ? 0 : 2, signal: 1 });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ errcode: 1996488764, data: { errcode: 1996488764, data: [] } }));
  });
  await new Promise<void>((resolve) => api.listen(options.httpPort ?? 0, host, resolve));

  return {
    telemetryPort: (tcp.address() as AddressInfo).port,
    httpPort: (api.address() as AddressInfo).port,
    clients: () => sockets.size,
    dropClients: () => {
      for (const s of sockets) s.destroy();
    },
    setNoFix: (value) => {
      noFix = value;
    },
    close: async () => {
      clearInterval(gpsTimer);
      clearInterval(gsensorTimer);
      for (const s of sockets) s.destroy();
      api.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => tcp.close(() => r())),
        new Promise<void>((r) => api.close(() => r())),
      ]);
    },
  };
}
