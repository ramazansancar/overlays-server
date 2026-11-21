import { defineDriver } from '../core/driver.ts';

export interface SimulatorOptions {
  lat: number;
  lon: number;
  radiusM: number;
  speedKmh: number;
  intervalMs: number;
  altitude: number;
  /** Report "no fix" for this many seconds first, like a receiver searching for satellites. */
  noFixSeconds: number;
  motion: boolean;
}

const EARTH_M_PER_DEG = 111_320;

/** Drives in a circle. For overlay development and for checking a setup without a camera. */
export const simulatorDriver = defineDriver<SimulatorOptions>({
  id: 'simulator',
  name: 'Simulator',
  description: 'Fake GPS driving in a circle (no hardware needed).',
  capabilities: ['gps', 'motion'],

  parseOptions: (o) => ({
    // Kızılay square, Ankara.
    lat: o.number('lat', 39.92077, { min: -90, max: 90 }),
    lon: o.number('lon', 32.85411, { min: -180, max: 180 }),
    radiusM: o.number('radiusM', 300, { min: 10 }),
    speedKmh: o.number('speedKmh', 40, { min: 0, max: 400 }),
    intervalMs: o.number('intervalMs', 1000, { min: 50, integer: true }),
    altitude: o.number('altitude', 890),
    noFixSeconds: o.number('noFixSeconds', 0, { min: 0 }),
    motion: o.boolean('motion', false),
  }),

  create(ctx, o) {
    let timer: NodeJS.Timeout | undefined;
    let angle = 0; // bearing of the car as seen from the center, radians
    let startedAt = 0;

    const tick = () => {
      const now = Date.now();
      if (now - startedAt < o.noFixSeconds * 1000) {
        ctx.publishNoFix({ satellites: 3 });
        return;
      }
      const speed = o.speedKmh / 3.6;
      angle = (angle + (speed * o.intervalMs) / 1000 / o.radiusM) % (2 * Math.PI);
      const lat = o.lat + (o.radiusM * Math.cos(angle)) / EARTH_M_PER_DEG;
      const lon = o.lon + (o.radiusM * Math.sin(angle)) / (EARTH_M_PER_DEG * Math.cos((o.lat * Math.PI) / 180));
      // Clockwise around the center: heading is the bearing plus 90°.
      const heading = ((angle * 180) / Math.PI + 90) % 360;
      ctx.publishFix({
        lat,
        lon,
        heading,
        speed,
        altitude: o.altitude + 10 * Math.sin(angle),
        satellites: 18,
        hdop: 0.7,
        timestamp: now,
      });
      if (o.motion) {
        // Centripetal acceleration while cornering, in g.
        ctx.publishMotion({ x: speed ** 2 / o.radiusM / 9.81, y: 0, z: 1, timestamp: now });
      }
    };

    return {
      start() {
        startedAt = Date.now();
        ctx.setLink('online');
        tick();
        timer = setInterval(tick, o.intervalMs);
      },
      stop() {
        clearInterval(timer);
      },
    };
  },
});
