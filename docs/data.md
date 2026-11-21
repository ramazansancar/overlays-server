# Available data / Mevcut veriler

Everything overlays-server can give an overlay, in one place. Use any of it: a speedometer, a G-force meter, a memory
card warning, a satellite indicator, an alert banner... Wire format: [protocol.md](protocol.md).

Bir overlay'in kullanabileceği tüm veriler. İstediğini kullan: hız göstergesi, G kuvveti, hafıza kartı uyarısı,
uydu göstergesi, uyarı bandı...

## How to get it

| Want | Connect to | Rate |
| --- | --- | --- |
| Position, speed, heading, altitude, GPS quality | `ws://127.0.0.1:3456/v1/ws` → `fix` messages | device rate (DDPAI 1 Hz) |
| Connection / GPS state, device info | same, `status` messages | on change (device info re-read every 60 s) |
| Acceleration (G-sensor) | `...?motion=1` → `motion` messages | up to `motionMaxHz` (10/s) |
| Every other device message, raw | `...?events=1` → `event` messages | as the device sends them |
| All of the above | `...?all=1` | |
| One-off snapshot (no streaming) | `GET http://127.0.0.1:3456/v1/state` | |

## Position (`fix`)

| Field | Unit | DDPAI N5 Pro | Source |
| --- | --- | --- | --- |
| `lat`, `lon` | degrees WGS84 | ✅ | RMC |
| `speed` | m/s (`× 3.6` = km/h) | ✅ | RMC |
| `heading` | degrees, 0 = north (left out below ~1.8 km/h) | ✅ | RMC course |
| `altitude` | m above mean sea level | ✅ | GGA |
| `geoidSeparation` | m (geoid above ellipsoid) | ✅ (camera reports 0) | GGA |
| `satellites` | count | ✅ (seen: 30) | GGA |
| `hdop` | horizontal dilution of precision, lower is better (< 1 excellent) | ✅ (seen: 0.5) | GGA |
| `quality` | 1 GPS, 2 DGPS, 4 RTK, 5 RTK float, 6 dead reckoning | ✅ | GGA |
| `mode` | A autonomous, D differential, E estimated | ✅ | RMC |
| `timestamp` | epoch ms UTC, GPS time | ✅ | RMC date + time |
| `lastKnown` | `true` = not live (GPS lost / earlier run); only on the first message after connecting | — | server |

## State (`status`)

| Field | Meaning |
| --- | --- |
| `link` | `connecting`, `online`, `offline`, ... connection to the device |
| `gps` | `no_fix` (searching), `fix`, `stale` (stopped) |
| `satellites` | also while searching, e.g. "searching, 3 satellites" |
| `message` | last error / hint (English) |
| `device` | see below |

## Device (`status.device`)

| Field | Meaning | DDPAI |
| --- | --- | --- |
| `vendor`, `model`, `firmware` | identification | ✅ `DDPAI`, `DN2509_Overseas`, `v8.0.0.10` |
| `storage.totalBytes`, `storage.freeBytes` | memory card (missing without a card) | ✅ unit inferred (KiB), please confirm on other cards |
| `cameras` | sensors: 2 = front + rear | ✅ |
| `streams[]` | `{ name, url }` RTSP live preview (for OBS Media Source, browsers cannot play RTSP) | ✅ front `av4`, rear `av5` |
| `details` | every other non-secret field, as the device names it | ✅ e.g. `adas_type`, `mcu version`, `stream_type`, `preview_mode`, `totalruntime` |
| `updatedAt` | when it was read | |

Secrets are never included: Wi-Fi name and password, serial numbers, UUIDs, MAC addresses, order numbers, keys.

## Acceleration (`motion`)

`x`, `y`, `z` in g, device axes (depends on how the camera is mounted; at rest one axis reads ≈ 1). DDPAI sends
~16 samples/s; clients get at most `motionMaxHz`. Ideas: G-force meter, braking / cornering indicator, bump detector.

Magnitude without gravity: `Math.abs(Math.hypot(x, y, z) - 1)`.

## Raw events (`event`)

`{ type: 'event', source, name, data, timestamp }`: any message type the driver does not know yet, untouched. On a
DDPAI this is every `msgid` other than GPS and G-sensor (none seen on an N5 Pro so far; ADAS / parking alerts are
likely candidates). Build on them, and please [report](new-device.md) what you see so the driver can learn them.

## Example: speed + G-force in the browser

```ts
const ws = new WebSocket('ws://127.0.0.1:3456/v1/ws?motion=1');
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'fix') speedEl.textContent = `${Math.round((msg.speed ?? 0) * 3.6)} km/h`;
  if (msg.type === 'motion') gEl.textContent = `${Math.abs(Math.hypot(msg.x, msg.y, msg.z) - 1).toFixed(2)} g`;
  if (msg.type === 'status' && msg.device?.storage) {
    const { freeBytes, totalBytes } = msg.device.storage;
    cardEl.hidden = freeBytes / totalBytes > 0.05; // warn below 5 % free
  }
};
```

Reconnect with backoff in real code (see [protocol.md](protocol.md#client-example-browser)).
