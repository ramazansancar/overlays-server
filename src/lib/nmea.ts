/**
 * Minimal NMEA-0183 parsing for the sentences dashcams send: RMC (position, speed, course, date)
 * and GGA (satellites, HDOP, altitude). Any talker id is accepted ($GP, $GN, $GL, ...).
 */

const KNOT_IN_MS = 1852 / 3600;

export interface RmcSentence {
  /** `true` when the receiver reports a valid fix (status `A`). */
  valid: boolean;
  lat?: number;
  lon?: number;
  /** Meters per second. */
  speed?: number;
  /** Course over ground, degrees from true north. */
  course?: number;
  /** UTC epoch milliseconds, when both date and time are present. */
  timestamp?: number;
  /** Mode indicator (NMEA 2.3+): A autonomous, D differential, E estimated, N not valid, ... */
  mode?: string;
}

export interface GgaSentence {
  /** 0 = no fix, 1 = GPS, 2 = DGPS, ... */
  quality: number;
  satellites?: number;
  hdop?: number;
  /** Meters above mean sea level. */
  altitude?: number;
  /** Geoid height above the WGS84 ellipsoid, meters. */
  geoidSeparation?: number;
}

/**
 * How strictly to check the `*hh` checksum.
 * - `strict`: must match the sentence as received.
 * - `any-talker`: may also match the same sentence with another talker id. Some firmwares compute it
 *   for one talker and then rewrite the id: DDPAI N5 Pro (v8.0.0.10) checksums `$GN...` but sends `$GP...`.
 * - `ignore`: no check.
 */
export type ChecksumMode = 'strict' | 'any-talker' | 'ignore';

export interface NmeaParseOptions {
  checksum?: ChecksumMode;
}

const TALKERS = ['GP', 'GN', 'GL', 'GA', 'GB', 'BD', 'GQ'];

/** XOR of every character between `$` and `*`, as two upper-case hex digits. */
export function nmeaChecksum(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
  return sum.toString(16).toUpperCase().padStart(2, '0');
}

/** Builds a complete sentence (`$` + body + `*` + checksum) from its body. */
export function withChecksum(body: string): string {
  return '$' + body + '*' + nmeaChecksum(body);
}

function checksumMatches(body: string, given: string, mode: ChecksumMode): boolean {
  if (mode === 'ignore' || given === nmeaChecksum(body)) return true;
  if (mode !== 'any-talker' || body.length < 5) return false;
  const own = body.slice(0, 2);
  const rest = body.slice(2);
  return TALKERS.some((talker) => talker !== own && given === nmeaChecksum(talker + rest));
}

/**
 * Splits a sentence into its fields after checking the checksum.
 * Returns `undefined` for anything that is not a well-formed sentence or whose checksum does not match.
 * Sentences without a checksum are accepted.
 */
export function splitSentence(sentence: string, options: NmeaParseOptions = {}): string[] | undefined {
  const line = sentence.trim();
  if (!line.startsWith('$')) return undefined;
  const star = line.lastIndexOf('*');
  let body: string;
  if (star === -1) {
    body = line.slice(1);
  } else {
    body = line.slice(1, star);
    const given = line.slice(star + 1).toUpperCase();
    if (given.length !== 2 || !checksumMatches(body, given, options.checksum ?? 'strict')) return undefined;
  }
  return body.split(',');
}

/** Sentence type without the talker id: `GPRMC` → `RMC`. */
function sentenceType(fields: string[]): string | undefined {
  const head = fields[0];
  return head && head.length === 5 ? head.slice(2) : undefined;
}

/** `ddmm.mmmm` / `dddmm.mmmm` plus hemisphere to signed decimal degrees. */
export function nmeaCoordinate(value: string | undefined, hemisphere: string | undefined): number | undefined {
  if (!value || !hemisphere) return undefined;
  const dot = value.indexOf('.');
  const degreeDigits = (dot === -1 ? value.length : dot) - 2;
  if (degreeDigits < 1) return undefined;
  const degrees = Number(value.slice(0, degreeDigits));
  const minutes = Number(value.slice(degreeDigits));
  if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes >= 60) return undefined;
  const decimal = degrees + minutes / 60;
  if (hemisphere === 'S' || hemisphere === 'W') return -decimal;
  if (hemisphere === 'N' || hemisphere === 'E') return decimal;
  return undefined;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `hhmmss(.sss)` + `ddmmyy` (UTC) to epoch milliseconds. */
export function nmeaTimestamp(time: string | undefined, date: string | undefined): number | undefined {
  if (!time || time.length < 6 || !date || date.length !== 6) return undefined;
  const hh = Number(time.slice(0, 2));
  const mm = Number(time.slice(2, 4));
  const ss = Number(time.slice(4));
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const yy = Number(date.slice(4, 6));
  if ([hh, mm, ss, day, month, yy].some((n) => !Number.isFinite(n))) return undefined;
  if (hh > 23 || mm > 59 || ss >= 61 || day < 1 || day > 31 || month < 1 || month > 12) return undefined;
  const whole = Math.floor(ss);
  const ms = Math.round((ss - whole) * 1000);
  return Date.UTC(2000 + yy, month - 1, day, hh, mm, whole, ms);
}

/** Parses an RMC sentence. Returns `undefined` if it is not RMC or is malformed. */
export function parseRmc(sentence: string, options?: NmeaParseOptions): RmcSentence | undefined {
  const f = splitSentence(sentence, options);
  if (!f || sentenceType(f) !== 'RMC') return undefined;
  const [, time, status, lat, ns, lon, ew, knots, course, date] = f;
  const timestamp = nmeaTimestamp(time, date);
  if (status !== 'A') return { valid: false, ...(timestamp !== undefined && { timestamp }) };
  const latitude = nmeaCoordinate(lat, ns);
  const longitude = nmeaCoordinate(lon, ew);
  if (latitude === undefined || longitude === undefined) return { valid: false };
  const speedKnots = optionalNumber(knots);
  const cog = optionalNumber(course);
  const mode = f[12]?.trim();
  return {
    valid: true,
    lat: latitude,
    lon: longitude,
    ...(speedKnots !== undefined && { speed: speedKnots * KNOT_IN_MS }),
    ...(cog !== undefined && { course: cog }),
    ...(timestamp !== undefined && { timestamp }),
    ...(mode && /^[A-Z]$/.test(mode) && { mode }),
  };
}

/** Parses a GGA sentence. Returns `undefined` if it is not GGA or is malformed. */
export function parseGga(sentence: string, options?: NmeaParseOptions): GgaSentence | undefined {
  const f = splitSentence(sentence, options);
  if (!f || sentenceType(f) !== 'GGA') return undefined;
  const quality = optionalNumber(f[6]) ?? 0;
  const satellites = optionalNumber(f[7]);
  const hdop = optionalNumber(f[8]);
  const altitude = optionalNumber(f[9]);
  const geoidSeparation = optionalNumber(f[11]);
  return {
    quality,
    ...(satellites !== undefined && { satellites }),
    ...(hdop !== undefined && { hdop }),
    ...(altitude !== undefined && { altitude }),
    ...(geoidSeparation !== undefined && { geoidSeparation }),
  };
}
