/**
 * Reads the raw device frames from a diagnostics file (`/v1/diagnostics`) so the fake camera can replay them.
 *
 * Files downloaded without positions have the NMEA coordinates masked (`xxxx.xxxx`), which no parser accepts. For
 * those, a stand-in track is rebuilt by dead reckoning from the recorded speed and course, starting at a neutral
 * point, and the checksums are recomputed the way the camera does it. Everything else (timing, speed, heading,
 * satellites, HDOP, altitude, G-sensor) stays exactly as recorded.
 */
import fs from 'node:fs';
import { ddpaiSentence, toNmea } from './fake-ddpai.ts';

export interface ReplayFrame {
  t: number;
  frame: string;
}

export interface LoadedReplay {
  source: string;
  frames: ReplayFrame[];
  positionsIncluded: boolean;
  /** GPS frames whose masked coordinates were replaced by the stand-in track. */
  synthesizedPositions: number;
}

/** Start of the stand-in track: Kızılay square, Ankara (not the streamer's location). */
const START = { lat: 39.92077, lon: 32.85411 };
const KNOT_IN_MS = 1852 / 3600;
const M_PER_DEG_LAT = 111_320;

export function loadReplayFrames(file: string, sourceId?: string): LoadedReplay {
  const text = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as {
    format?: number;
    positionsIncluded?: boolean;
    sources?: { id: string; recentFrames?: ReplayFrame[] }[];
  };
  if (!Array.isArray(data.sources)) throw new Error(`${file} is not an overlays-server diagnostics file`);
  const candidates = data.sources.filter((s) => s.recentFrames && s.recentFrames.length > 0);
  const source = sourceId ? candidates.find((s) => s.id === sourceId) : candidates[0];
  if (!source) {
    const ids = candidates.map((s) => s.id).join(', ') || 'none';
    throw new Error(sourceId ? `no frames for source "${sourceId}" (sources with frames: ${ids})` : `${file} contains no raw frames`);
  }
  const frames = source.recentFrames!.filter((f) => typeof f.t === 'number' && typeof f.frame === 'string').sort((a, b) => a.t - b.t);
  const { frames: filled, synthesized } = fillMaskedPositions(frames);
  return { source: source.id, frames: filled, positionsIncluded: data.positionsIncluded === true, synthesizedPositions: synthesized };
}

/** Replaces masked NMEA coordinates in DDPAI GPS frames with a dead-reckoned track (see the module comment). */
export function fillMaskedPositions(frames: ReplayFrame[], start = START): { frames: ReplayFrame[]; synthesized: number } {
  let lat = start.lat;
  let lon = start.lon;
  let lastT: number | undefined;
  let synthesized = 0;

  const out = frames.map((f) => {
    if (!f.frame.includes('MSG_GpsData') || !f.frame.includes('xxxx')) return f;
    let outer: { msgid: string; data: string };
    let inner: { gpsdata?: string; ggadata?: string };
    try {
      outer = JSON.parse(f.frame) as typeof outer;
      inner = JSON.parse(outer.data) as typeof inner;
    } catch {
      return f;
    }
    const rmc = splitBody(inner.gpsdata);
    // Advance along the recorded course at the recorded speed.
    if (rmc && rmc[2] === 'A') {
      const dt = lastT === undefined ? 0 : Math.min((f.t - lastT) / 1000, 5);
      const speed = (Number(rmc[7]) || 0) * KNOT_IN_MS;
      const course = ((Number(rmc[8]) || 0) * Math.PI) / 180;
      lat += (speed * dt * Math.cos(course)) / M_PER_DEG_LAT;
      lon += (speed * dt * Math.sin(course)) / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
    }
    lastT = f.t;
    const latField = [toNmea(lat, 2), lat >= 0 ? 'N' : 'S'];
    const lonField = [toNmea(lon, 3), lon >= 0 ? 'E' : 'W'];
    const fill = (fields: string[] | undefined, at: number) => {
      if (!fields || !fields[at]?.includes('x')) return undefined;
      fields.splice(at, 4, ...latField, ...lonField);
      return `${ddpaiSentence(fields.join(','))}\n`;
    };
    const gpsdata = fill(rmc, 3);
    const ggadata = fill(splitBody(inner.ggadata), 2);
    if (!gpsdata && !ggadata) return f;
    synthesized++;
    const data = JSON.stringify({ ...inner, ...(gpsdata && { gpsdata }), ...(ggadata && { ggadata }) });
    return { t: f.t, frame: JSON.stringify({ ...outer, data }) };
  });
  return { frames: out, synthesized };
}

/** `$GPRMC,...*CS\n` → fields of the body (talker included, checksum dropped). */
function splitBody(sentence: string | undefined): string[] | undefined {
  if (!sentence) return undefined;
  const line = sentence.trim();
  if (!line.startsWith('$')) return undefined;
  const star = line.lastIndexOf('*');
  return (star === -1 ? line.slice(1) : line.slice(1, star)).split(',');
}
