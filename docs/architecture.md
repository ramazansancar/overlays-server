# Architecture

```text
            ┌────────────── Car ───────────────┐
            │ DDPAI dashcam 193.168.0.1        │
            │   :554  RTSP video ──────────────┼──► OBS Media Source (not touched by this server)
            │   :6100 telemetry (TCP) ──┐      │
            │   :80   HTTP API ─────────┤      │
            └───────────────────────────┼──────┘
                 camera Wi-Fi           │          internet on Ethernet (e.g. a 4.5G/5G router)
┌───────────────────────────────────────▼─────────────── streamer PC ───────────────────────────┐
│ overlays-server (127.0.0.1:3456)                                                              │
│                                                                                               │
│   Drivers / Sources          Hub                              Transports                      │
│   ┌──────────────┐  ctx  ┌──────────────────────────┐  events  ┌────────────────────────┐     │
│   │ ddpai        │──────►│ status per source        │─────────►│ WebSocket  /v1/ws      │     │
│   │ simulator    │       │ last fix, stale timer    │          │ SSE        /v1/stream  │     │
│   │ (your driver)│       │ active GPS source        │◄─────────│ JSON       /v1/state   │     │
│   └──────────────┘       │ (priority + failover)    │ snapshot │ status page /          │     │
│                          └──────────────────────────┘          └───────────▲────────────┘     │
└────────────────────────────────────────────────────────────────────────────┼──────────────────┘
                                                                             │ ws://127.0.0.1:3456/v1/ws
                                           OBS browser source: https://overlays.ramazansancar.com.tr/overlay.html?...
```

## Layers

**Drivers** (`src/drivers/*`) know one device type. A driver is a plain object (`defineDriver`) with an id, a
capability list, an options parser and a `create(ctx, options)` factory. The source it creates connects to the
device and reports everything through its `SourceContext`: link state, device info, fixes, "no fix", motion
samples. Drivers know nothing about HTTP, clients or other sources. See [drivers.md](drivers.md).

**Hub** (`src/core/hub.ts`) is the single source of truth:

- keeps a `SourceStatus` per source: `link` (`starting | connecting | online | offline | stopped`) and
  `gps` (`unknown | no_fix | fix | stale`), plus satellites, device info and the last message;
- normalizes fixes (range checks, rejects `0,0`, rounds, drops heading below ~1.8 km/h where GPS course is noise);
- marks a source `stale` when fixes stop for `staleAfterMs`, or when its link drops;
- picks the **active GPS source**: the first source in `gpsPriority` order that has a fix. If the preferred camera
  drops, clients on `auto` transparently get the next one;
- fans events out to subscribers. A throwing subscriber cannot break the others.

**Transports** (`src/transports/*`) turn hub state into the wire protocol ([protocol.md](protocol.md)).
`feed.ts` builds one client's stream (snapshot first, then filtered live events) and is shared by WebSocket and SSE,
so both behave identically. Every request goes through the same gate: Host header (DNS rebinding), Origin allowlist,
optional token.

**App / CLI** (`src/app.ts`, `src/cli.ts`) validate the whole config before opening a port, start the server, then
start the sources (a failing source is reported, not fatal), and shut everything down on Ctrl+C.

## Why these choices

- **Local bridge instead of the browser talking to the camera:** browsers cannot open raw TCP; the camera's HTTP server
  sends no CORS headers; the overlay page is HTTPS while the camera is plain HTTP.
- **WebSocket first, SSE as fallback:** Chromium's *Local Network Access* gates requests from public HTTPS pages to
  `127.0.0.1`. OBS 33 (CEF 150) explicitly exempts WebSockets and auto-grants localhost access to browser sources;
  regular Chrome shows a one-time prompt. SSE/JSON remain for clients that prefer them.
- **Loopback only + origin allowlist:** any website open on the streamer's PC could otherwise read the live location.
- **No build step in development:** Node 22.18+ strips TypeScript types natively; `tsc` (TypeScript 7) only type-checks
  and emits `dist/` for npm.
- **One runtime dependency** (`ws`): the server is meant to be trusted with location data and run unattended.

## Operations and support

- **Status page** (`/`): live over the same WebSocket as overlays (`source=*` = every source), position hidden by
  default, map links when shown, device details, RTSP URLs.
- **`/health`**: cheap liveness + per-source state, no position, no token. Overlays call it when their WebSocket fails
  to tell "server down" from "refused" (origin / token / host).
- **Diagnostics** (`/v1/diagnostics`): the hub keeps the last ~2000 raw frames per source (`ctx.recordRaw`) and
  `recordingLogger` keeps the last 500 log lines; together with config, state and runtime they make one JSON file for
  bug reports. Secrets always masked (`lib/redact.ts`), positions only on request.
- **Replay**: the fake DDPAI camera (`scripts/lib/fake-ddpai.ts`) streams a diagnostics file's frames with their
  original timing, so a streamer's problem runs on a developer machine through the real driver.
- **Last position**: `LastPositionStore` writes each source's last fix to `last-position.json` (every 10 s, atomically,
  and on shutdown); on start the hub is seeded with it, and clients connecting without a live fix get it with
  `lastKnown: true`. GPS lost in a tunnel or a restart never leaves the map without a position.
- **Probe** (`--probe <host>`, `src/tools/probe.ts`): read-only device inspection for new-device reports.
- **Updates**: npm (`npx overlays-server@latest`) or git; `start.cmd` pulls before starting.

## Possible extensions

- *Proxy mode*: serve the overlay site through the local server so everything is same-origin (no LNA at all).
- *Cloud relay*: push fixes to a remote endpoint when the overlay runs on another device (e.g. a phone).
- More drivers: generic NMEA over serial/TCP (USB GPS dongles, gpsd), other dashcam brands.
- OBS WebSocket integration: switch scenes when the camera drops.
