# Wire protocol (v1)

Clients connect to:

| Transport | URL | Notes |
| --- | --- | --- |
| WebSocket (preferred) | `ws://127.0.0.1:3456/v1/ws` | One JSON object per text message |
| Server-Sent Events | `http://127.0.0.1:3456/v1/stream` | `event: <type>` + `data: <json>` per message |
| Snapshot | `http://127.0.0.1:3456/v1/state` | Current state of every source, no streaming |

Query parameters (WebSocket and SSE):

| Parameter | Default | Meaning |
| --- | --- | --- |
| `source` | `auto` | `auto` follows the active GPS source (priority + failover); or a source id to pin one |
| `motion` | off | `1` to also receive `motion` messages (throttled to `motionMaxHz`) |
| `events` | off | `1` to also receive raw device `event` messages |
| `all` | off | `1` = `motion=1&events=1` |
| `token` | — | Required when the server has a `token` configured (or send `Authorization: Bearer`) |

Requests from an `Origin` not in `allowedOrigins` get **403**; WebSocket upgrades are refused the same way.

## Messages

Every message has a `type`. **Clients must ignore unknown types and unknown fields.** New optional fields and new
message types can be added within v1; removing or changing the meaning of a field requires v2 (new path `/v2/...`).

### `hello`

First message on every connection.

```json
{ "type": "hello", "server": "overlays-server", "version": "0.1.0", "protocol": 1,
  "subscription": "auto", "activeSource": "ddpai" }
```

### `status`

Sent for every source right after `hello`, then whenever a source's state changes.

```json
{ "type": "status", "source": "ddpai", "driver": "ddpai", "link": "online", "gps": "fix", "active": true,
  "satellites": 24, "device": { "vendor": "DDPAI", "model": "DN2509_Overseas", "firmware": "v8.0.0.10" },
  "since": 1795256586151 }
```

| Field | Values |
| --- | --- |
| `link` | `starting`, `connecting`, `online`, `offline`, `stopped` |
| `gps` | `unknown` (no data yet), `no_fix` (searching satellites), `fix`, `stale` (fixes stopped) |
| `active` | this source feeds `source=auto` |
| `message` | optional human readable detail (English), e.g. the last connection error |
| `satellites` | optional, also while searching |
| `device` | optional: `vendor`, `model`, `firmware`, `storage` (`totalBytes`, `freeBytes`), `cameras`, `streams` (`[{ name, url }]`, RTSP), `details` (other non-secret device fields), `updatedAt`. See [data.md](data.md) |
| `since` | epoch ms of the last `link`/`gps` change |

### `fix`

A position, at the device's rate (DDPAI: 1 Hz). With `source=auto` only the active source's fixes are sent. Right
after the `status` messages, the current fix is repeated if there is one.

```json
{ "type": "fix", "source": "ddpai", "lat": 39.9207712, "lon": 32.8541103, "heading": 56.7, "speed": 11.11,
  "altitude": 905.1, "satellites": 24, "hdop": 0.6, "timestamp": 1795256586000 }
```

| Field | Unit | Notes |
| --- | --- | --- |
| `lat`, `lon` | degrees (WGS84) | always present |
| `speed` | **m/s** | optional |
| `heading` | degrees from true north, 0–360 | optional; **left out below ~1.8 km/h** (GPS course is noise when standing still) |
| `altitude` | meters above mean sea level | optional |
| `satellites`, `hdop` | — | optional |
| `quality` | — | optional, GGA fix quality (1 GPS, 2 DGPS, ...) |
| `geoidSeparation` | meters | optional, geoid height above the ellipsoid |
| `mode` | — | optional, RMC mode (A autonomous, D differential, E estimated) |
| `timestamp` | epoch ms, UTC | GPS time when the device sends it, otherwise server time |

The field names match the overlay's `Fix` type, so a client can pass a fix through unchanged. Smoothing between
fixes is the client's job.

### `motion` (opt-in)

```json
{ "type": "motion", "source": "ddpai", "x": -0.035, "y": -0.098, "z": 1.054, "timestamp": 1795256586151 }
```

Acceleration in g, device axes (orientation depends on how the camera is mounted). Skipped for slow clients.

### `event` (opt-in)

```json
{ "type": "event", "source": "ddpai", "name": "MSG_Something", "data": { "...": "as sent by the device" },
  "timestamp": 1795256586151 }
```

Any device message the driver does not interpret, passed through untouched (`name` = device message type). Lets
overlays use new data before the server knows it. The shape of `data` is device specific and not covered by the
compatibility promise.

### `/v1/state`

Snapshot of every source: `status` (as in the `status` message), `lastFix`, `lastFixAt`, `lastMotion`, `active`.
Full field list: [data.md](data.md).

## Client example (browser)

```ts
function connect(onFix: (fix: { lat: number; lon: number; heading?: number; speed?: number }) => void) {
  let ws: WebSocket | undefined;
  let retry = 1000;
  let stopped = false;
  const open = () => {
    ws = new WebSocket('ws://127.0.0.1:3456/v1/ws');
    ws.onopen = () => (retry = 1000);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'fix') onFix(msg);
    };
    ws.onclose = () => {
      if (stopped) return;
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 10_000);
    };
  };
  open();
  return () => {
    stopped = true;
    ws?.close();
  };
}
```

For `fetch`/`EventSource` from an HTTPS page, Chrome additionally needs `targetAddressSpace: 'loopback'` on fetch
and the user's *Local network access* permission. WebSocket avoids the mixed-content part; OBS 33 also exempts it from
the permission check.
