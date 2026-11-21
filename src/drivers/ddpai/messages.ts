/**
 * DDPAI telemetry stream (TCP 6100), verified on an N5 Pro (DN2509, firmware v8.0.0.10):
 * NUL separated JSON frames `{"msgid": "...", "data": "<JSON string>"}`, the inner JSON encoded as a string.
 *
 *   MSG_GpsData      ~1 Hz   {"gpsdata": "$GPRMC,...*CS\n", "ggadata": "$GPGGA,...*CS\n"}
 *   MSG_GsensorData  ~16 Hz  {"gsensordata": "$GSENSOR,x,y,z,epochMs"}   x/y/z in milli-g
 */
import { parseGga, parseRmc, type GgaSentence, type NmeaParseOptions, type RmcSentence } from '../../lib/nmea.ts';
import type { GpsFix, MotionSample } from '../../core/types.ts';

export type DdpaiMessage =
  | { kind: 'gps'; rmc?: RmcSentence; gga?: GgaSentence }
  | { kind: 'gsensor'; sample: MotionSample }
  | { kind: 'other'; msgid: string; data: unknown };

/** The camera computes NMEA checksums for `$GN` and sends `$GP` (see ChecksumMode). */
const NMEA_OPTIONS: NmeaParseOptions = { checksum: 'any-talker' };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** Decodes one frame. Returns `undefined` for anything that is not a DDPAI message. */
export function decodeDdpaiFrame(frame: string): DdpaiMessage | undefined {
  const outer = record(parseJson(frame.trim()));
  if (!outer || typeof outer.msgid !== 'string') return undefined;
  const data = typeof outer.data === 'string' ? (parseJson(outer.data) ?? outer.data) : outer.data;
  const inner = record(data);

  switch (outer.msgid) {
    case 'MSG_GpsData': {
      if (!inner) return undefined;
      const rmc = typeof inner.gpsdata === 'string' ? parseRmc(inner.gpsdata, NMEA_OPTIONS) : undefined;
      const gga = typeof inner.ggadata === 'string' ? parseGga(inner.ggadata, NMEA_OPTIONS) : undefined;
      if (!rmc && !gga) return undefined;
      return { kind: 'gps', ...(rmc && { rmc }), ...(gga && { gga }) };
    }
    case 'MSG_GsensorData': {
      const sample = typeof inner?.gsensordata === 'string' ? parseGsensor(inner.gsensordata) : undefined;
      return sample ? { kind: 'gsensor', sample } : undefined;
    }
    default:
      return { kind: 'other', msgid: outer.msgid, data };
  }
}

/** `$GSENSOR,x,y,z,epochMs` (milli-g) to g. */
export function parseGsensor(line: string): MotionSample | undefined {
  const parts = line.trim().split(',');
  if (parts[0] !== '$GSENSOR' || parts.length < 5) return undefined;
  const [x, y, z, t] = parts.slice(1, 5).map(Number);
  if (![x, y, z, t].every((n) => Number.isFinite(n))) return undefined;
  return { x: x! / 1000, y: y! / 1000, z: z! / 1000, timestamp: t! };
}

/** A GPS message as a fix, or `undefined` while the receiver has no lock. */
export function gpsMessageToFix(msg: Extract<DdpaiMessage, { kind: 'gps' }>, now = Date.now()): GpsFix | undefined {
  const { rmc, gga } = msg;
  if (!rmc?.valid || rmc.lat === undefined || rmc.lon === undefined) return undefined;
  return {
    lat: rmc.lat,
    lon: rmc.lon,
    ...(rmc.speed !== undefined && { speed: rmc.speed }),
    ...(rmc.course !== undefined && { heading: rmc.course }),
    ...(gga?.altitude !== undefined && gga.quality > 0 && { altitude: gga.altitude }),
    ...(gga?.satellites !== undefined && { satellites: gga.satellites }),
    ...(gga?.hdop !== undefined && { hdop: gga.hdop }),
    timestamp: rmc.timestamp ?? now,
  };
}
