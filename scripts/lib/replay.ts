/**
 * Reads the raw device frames from a diagnostics file (`/v1/diagnostics`) so the fake camera can replay them.
 */
import fs from 'node:fs';

export interface ReplayFrame {
  t: number;
  frame: string;
}

export function loadReplayFrames(file: string, sourceId?: string): { source: string; frames: ReplayFrame[]; positionsIncluded: boolean } {
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
  return { source: source.id, frames, positionsIncluded: data.positionsIncluded === true };
}
