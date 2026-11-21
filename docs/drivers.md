# Drivers

A **driver** supports one kind of device. The server runs any number of **sources**, each an instance of a driver
with its own options (two cameras = two `ddpai` sources with different ids and hosts).

Built-in drivers:

| id | Device | Capabilities |
| --- | --- | --- |
| `ddpai` | DDPAI dashcams over their Wi-Fi ([details](devices/ddpai.md)) | gps, motion, device |
| `simulator` | Fake GPS driving in a circle | gps, motion |

List them with `overlays-server --list-drivers`.

## Adding a driver

1. Create `src/drivers/<id>/index.ts` (or `src/drivers/<id>.ts` for a small one).
2. Export a `defineDriver({...})`.
3. Add it to `BUILTIN_DRIVERS` in `src/drivers/index.ts`.
4. Add tests (parser unit tests + ideally a fake device in `scripts/lib/`) and a page in `docs/devices/`.

### The contract

```ts
import { defineDriver } from '../../core/driver.ts';

export interface MyGpsOptions {
  host: string;
  port: number;
}

export const myGpsDriver = defineDriver<MyGpsOptions>({
  id: 'my-gps',                         // value of "driver" in the config
  name: 'My GPS',
  description: 'NMEA over TCP from My GPS devices.',
  capabilities: ['gps'],                // 'gps' | 'motion' | 'device'

  // Validate the source's "options" object. Throw ConfigError (the reader does) on bad values.
  parseOptions: (o) => ({
    host: o.string('host', '192.168.1.50'),
    port: o.port('port', 10110),
  }),

  // Build the source. Do not connect here; start() is called once the server is listening.
  create(ctx, options) {
    return {
      start() {
        ctx.setLink('connecting');
        // connect, then for every position:
        //   ctx.publishFix({ lat, lon, speed /* m/s */, heading, altitude, satellites, hdop, timestamp })
        // while the device has no lock:
        //   ctx.publishNoFix({ satellites })
        // on disconnect:
        //   ctx.setLink('offline', reason)  — and retry
      },
      stop() {
        // close sockets, clear timers
      },
    };
  },
});
```

### `SourceContext`

| Member | Use |
| --- | --- |
| `id` | Source id from the config |
| `log` | Logger scoped to the source (`debug` for chatty details) |
| `signal` | Aborted when the source stops; pass it to `fetch()` |
| `setLink(state, message?)` | `connecting`, `online`, `offline` (+ reason) |
| `setDevice(info)` | `{ vendor, model, firmware }`. **Never include secrets** |
| `publishFix(fix)` | A valid position. The hub validates, rounds and timestamps it |
| `publishNoFix(detail?)` | Device talks but has no satellite lock |
| `publishMotion(sample)` | Acceleration in g |

Publishing a fix or no-fix also marks the link `online`, so simple drivers don't need to call `setLink` for that.

### Helpers in `src/lib`

| Helper | For |
| --- | --- |
| `ReconnectingTcpClient` | TCP with connect timeout, idle timeout and exponential backoff |
| `DelimitedDecoder` | Byte streams split by a delimiter (NUL, newline), UTF-8 safe across chunks |
| `nmea` (`parseRmc`, `parseGga`, `withChecksum`, ...) | NMEA-0183, with `checksum: 'strict' \| 'any-talker' \| 'ignore'` for quirky firmwares |
| `OptionReader` | Typed option parsing with defaults and clear errors |

### Rules

- Never throw out of the source; report with `setLink('offline', reason)` and retry with backoff.
- **Read-only**: don't send commands that change device settings.
- Convert units at the boundary: m/s, degrees, meters, epoch ms UTC.
- Log unknown message types once at `info` (helps map protocols), everything else at `debug`.
- If the device returns secrets (DDPAI's base info includes the Wi-Fi password), whitelist the fields you keep.

## Third-party drivers (without forking)

The package exports everything needed:

```ts
import { BUILTIN_DRIVERS, defineDriver, parseConfig, startServer } from 'overlays-server';

const myGpsDriver = defineDriver({ /* ... */ });

await startServer({
  config: parseConfig({ sources: [{ id: 'gps', driver: 'my-gps', options: { host: '10.0.0.5' } }] }),
  drivers: [...BUILTIN_DRIVERS, myGpsDriver],
});
```

## simulator

Fake GPS for development and demos. Options (all optional):

| Option | Default | |
| --- | --- | --- |
| `lat`, `lon` | Kızılay, Ankara | Circle center |
| `radiusM` | `300` | Circle radius |
| `speedKmh` | `40` | Speed |
| `intervalMs` | `1000` | Fix interval |
| `altitude` | `890` | Base altitude (meters) |
| `noFixSeconds` | `0` | Report "no fix" this long first |
| `motion` | `false` | Also publish motion (centripetal g) |
