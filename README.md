# overlays-server

**English** · [Türkçe](README-tr.md)

A small **local bridge server** that runs on the streamer's PC (or on a Raspberry Pi in the car). It reads live GPS
from a dashcam (currently **DDPAI**) and streams it once per second over WebSocket to the
[Stream Overlays](https://overlays.ramazansancar.com.tr) map overlay. No phone, no cloud service, no RealtimeIRL: the
position comes straight from the camera over the local network.

```text
DDPAI camera (Wi-Fi, 193.168.0.1:6100) ──► overlays-server (127.0.0.1:3456) ──► OBS browser source (map)
```

- **Live position, speed, heading, altitude, satellites, GPS quality** — from the camera's own GPS, 1 Hz.
- **Everything the device offers** — acceleration (G-sensor), memory card usage, camera count, RTSP URLs, device
  details, unknown messages passed through raw. Overlays use what they need: [docs/data.md](docs/data.md).
- **No empty map in tunnels** — when GPS drops, the last known position is used, even across restarts.
- **On another device / over a VPN** — Raspberry Pi, Tailscale/WireGuard, your own domain (with token + TLS):
  [docs/remote.md](docs/remote.md).
- **Modular drivers** — a new camera / GPS device is one module ([docs/drivers.md](docs/drivers.md)).
- **Self-healing** — reconnects when the camera restarts or its Wi-Fi drops.
- **Privacy first** — listens on `127.0.0.1` by default, only allowed websites can read the data.
- **One runtime dependency** (`ws`), Node.js 22.18+.

## Supported devices

| Device | Driver | Status |
| --- | --- | --- |
| DDPAI N5 Pro (firmware v8.0.0.10) | `ddpai` | Field tested |
| Other DDPAI models with TCP 6100 telemetry | `ddpai` | Very likely; try it and [report](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml) |
| Simulator (no hardware) | `simulator` | — |

Device details and tested environments: [docs/devices/](docs/devices/README.md).
**Your device is not listed?** [New device guide](docs/new-device.md): inspect it with one command (`--probe`) and
send the report as an issue.

## Install

Two ways, both run the same server. Requires **Node.js 22.18 or newer** ([nodejs.org](https://nodejs.org)).

### A) With npm (easiest)

```bash
npx overlays-server@latest
```

`@latest` checks npm for the newest version on every start (plain `npx overlays-server` may reuse an older download).
To install it permanently:

```bash
npm install -g overlays-server
overlays-server
```

**Updating (permanent install):**

```bash
overlays-server --version            # installed version
npm outdated -g overlays-server      # is there a newer one? (no output = up to date)
npm install -g overlays-server@latest
```

Uninstall: `npm uninstall -g overlays-server`.

### B) With git (from source)

```bash
git clone https://github.com/ramazansancar/overlays-server.git
cd overlays-server
npm install --omit=dev      # or: pnpm install --prod
npm start
```

On Windows, double-clicking **`start.cmd`** in the folder is enough: on every start it updates itself with `git pull`,
installs dependencies when needed, then starts the server. Without internet it warns and starts the current version;
set `OVERLAYS_SERVER_NO_UPDATE=1` to skip the update.

**Updating (git install):** nothing to do when you use `start.cmd`. By hand:

```bash
cd overlays-server
git pull
npm install --omit=dev      # updates dependencies if they changed
```

A specific version: `git fetch --tags && git checkout v0.1.1`. Changes: [CHANGELOG.md](CHANGELOG.md).

There is no build step: Node.js 22.18+ runs the TypeScript files directly.

### Check that it works

Open **<http://127.0.0.1:3456>** in a browser. The status page shows live whether the camera is connected and the GPS
state (coordinates are hidden by default, so it can be shown on stream).

## Usage

1. **Connect the PC to the camera's Wi-Fi** (`DDPAI_...` network). Internet should keep coming over Ethernet (e.g. a
   4.5G/5G router). Windows setup: [docs/windows-network.md](docs/windows-network.md).
2. **Start overlays-server** (either way above). The console shows `ddpai: link online` and `ddpai: gps fix`.
3. In the **[overlay settings](https://overlays.ramazansancar.com.tr)** pick **Dashcam GPS — overlays-server [local]**
   as the map overlay's *Location source*. The *Server address* (`127.0.0.1`) and *Server port* (`3456`) below it can
   stay as they are for the default setup. Then add the URL as an OBS browser source.

To try everything without a camera: `npx overlays-server@latest --simulate` (a fake position driving in circles in
Ankara).

### On another device or over a VPN

The server can run on a Raspberry Pi, another computer or somewhere remote; the overlay (OBS on the streaming PC or
in the cloud) reaches it by LAN IP, VPN IP or a domain / public IP. In short:

| Setup | Server | Overlay settings |
| --- | --- | --- |
| Pi on the same LAN / VPN IP | `"host": "0.0.0.0"`, `"token"` | Pi's IP, port, token |
| Tailscale + HTTPS (recommended) | `tailscale serve --https=443 http://127.0.0.1:3456`, `"allowedHosts"` | `pi.<tailnet>.ts.net`, `443`, **Secure connection** |
| Public IP / domain | `"host": "0.0.0.0"`, `"token"`, `"tls"` or Caddy/Nginx | domain, port, token, **Secure connection** |

**Always use a token** when listening on anything other than `127.0.0.1`. Full guide with systemd and Caddy examples:
[docs/remote.md](docs/remote.md).

### Start with Windows

`Win + R` → `shell:startup` → put a shortcut to `start.cmd` (git install) or to a `.cmd` file with this content in
that folder:

```bat
@echo off
npx overlays-server@latest
```

## Configuration

The defaults fit most setups. To change them, create a JSON file (copy [config.example.json](config.example.json)).
The server looks for it in this order:

1. `--config <file>`
2. the `OVERLAYS_SERVER_CONFIG` environment variable
3. `overlays-server.config.json` in the working directory
4. the user folder: Windows `%APPDATA%\overlays-server\config.json`, Linux/macOS `~/.config/overlays-server/config.json`

| Key | Default | Description |
| --- | --- | --- |
| `port` | `3456` | Port to listen on |
| `host` | `127.0.0.1` | Interface to listen on. `0.0.0.0` for access from other devices (with a token) |
| `allowedOrigins` | overlay site + localhost | Websites allowed to read the data (`https://site`, `http://localhost:*`, `*`) |
| `token` | — | When set, clients must send `?token=...` |
| `allowedHosts` | `[]` | Extra host names accepted behind a reverse proxy (Tailscale Serve, Caddy) |
| `tls` | — | `{ "certFile", "keyFile" }`: serve HTTPS / WSS directly |
| `staleAfterMs` | `5000` | A source without GPS for this long is `stale` |
| `gpsPriority` | `[]` | Preference order with several GPS sources (falls back when the first drops) |
| `motionMaxHz` | `10` | Maximum acceleration messages per client per second |
| `logLevel` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `rememberLastPosition` | `true` | Keep the last position on disk; show it while GPS is lost (tunnel) or after a restart |
| `stateFile` | `last-position.json` in the user folder | Where the last position is kept |
| `sources` | `[{ "driver": "ddpai" }]` | List of sources; each has `id`, `driver`, `enabled`, `options` |

Driver options: [docs/devices/ddpai.md](docs/devices/ddpai.md#options), [docs/drivers.md](docs/drivers.md#simulator).

### Command line

```text
overlays-server [options]
  -c, --config <file>         Config file
  -p, --port <port>           Port (default 3456)
      --host <address>        Interface to listen on (default 127.0.0.1)
      --origin <origin>       Extra allowed website (repeatable)
      --token <secret>        Require ?token= from clients
      --allowed-host <name>   Extra host name behind a reverse proxy (repeatable)
      --tls-cert <file>       PEM certificate for HTTPS/WSS (with --tls-key)
      --tls-key <file>        PEM private key
      --ddpai-host <ip>       DDPAI camera address (default 193.168.0.1)
      --ddpai-http-port <port> DDPAI HTTP API port (default 80)
      --simulate              Use the simulator instead of the configured sources
      --log-level <level>     debug | info | warn | error | silent
      --print-config          Print the effective config and exit
      --list-drivers          List drivers and exit
      --probe <address>       Inspect a device (ports, model, data samples) and print a report for an issue
      --probe-ports <list>    Ports for --probe, comma separated (e.g. 80,554,6100)
  -v, --version / -h, --help
```

Environment variables: `OVERLAYS_SERVER_PORT`, `OVERLAYS_SERVER_HOST`, `OVERLAYS_SERVER_LOG_LEVEL`, `OVERLAYS_SERVER_CONFIG`.

## Endpoints

| Path | Description |
| --- | --- |
| `GET /` | Status page |
| `GET /health` | Is the server up? (version, per-source state; no position, no token needed) |
| `GET /v1/state` | Every source's state and last position (JSON) |
| `WS /v1/ws` | Live stream (main channel) |
| `GET /v1/stream` | Live stream, Server-Sent Events (fallback) |
| `GET /v1/diagnostics` | Diagnostics file (recent raw device data, logs, settings) |

Stream parameters: `source=<id|auto|*>`, `motion=1` (acceleration), `events=1` (raw device messages), `all=1`,
`token=...`. Message format: [docs/protocol.md](docs/protocol.md). **What data is there?** (position, speed, heading,
altitude, satellites, HDOP, acceleration, memory card, camera count, RTSP URLs, device details, raw events):
[docs/data.md](docs/data.md).

## Troubleshooting

**Look at the status page first:** <http://127.0.0.1:3456>. Connection and GPS state of every source are live there;
you can show the position and open it in Google Maps / Yandex / OpenStreetMap.

**Attach a diagnostics file to bug reports:** the **Download diagnostics** button at the bottom of the status page
gives one `.json` file: the last ~2 minutes of raw device data, recent log lines, settings and state. With it we can
replay the problem exactly on our machine and fix it. Wi-Fi passwords, serial numbers and MAC addresses are always
removed; the position only when **Include my position** is ticked (needed for map / position problems). From the
command line: `curl -o diagnostics.json http://127.0.0.1:3456/v1/diagnostics`. The overlay settings page offers the
same download (with the local server selected as location source), named with the date and time.

**Status page says `connecting` / "is this PC connected to the camera Wi-Fi?"** — the PC is not on the camera's Wi-Fi,
or Windows sends `193.168.0.1` to the wrong adapter. [docs/windows-network.md](docs/windows-network.md).

**`gps: no_fix`** — the camera is connected but has no satellite lock. Wait a few minutes under open sky.

**Tunnel / underground car park (GPS lost)** — the map stays at the last known position with speed 0 and continues
when the signal returns. Even if OBS or the PC restarts meanwhile, the position is kept: the server stores it in
`last-position.json` and sends it to newly connected overlays as "last known position", and the overlay also remembers
it in the browser. Turn off with `"rememberLastPosition": false`.

**The overlay shows a warning** — when it cannot connect, the overlay asks the server's `/health` and says why:

| Overlay message | What to do |
| --- | --- |
| *Cannot reach the local server* | Server not running, wrong address/port, or the site you opened the overlay from is not in `allowedOrigins`. If the status page opens, check the server console (`refused an overlay connection`) and the browser permission point below |
| *Local server is up but refused the live connection* | The server has a `token`: enter it in the overlay settings' *Server token* field |
| *Server is connecting to the camera…* / *Camera is searching satellites* | The server works; the problem is on the camera side (Wi-Fi, satellites) |

The server logs every refused connection (`refused an overlay connection: ...`). It does not answer websites that are
not allowed at all (for security), so the overlay sees that case as "cannot reach".

**Status page works but the overlay cannot reach the server** — the browser's *Local Network Access* restriction:

- **OBS 33.0+** allows localhost automatically. If you ran an OBS 33 **beta**, an old denial may be stored: close OBS,
  delete `%APPDATA%\obs-studio\plugin_config\obs-browser`, start OBS. Still failing: add
  `--disable-features=LocalNetworkAccessChecks` to the OBS shortcut.
- **Chrome / Edge** (settings page, "open in window" mode): click **Allow** on the permission prompt.
- **Server on another device / reached by domain:** needs `wss://`, see [docs/remote.md](docs/remote.md).

**`port 3456 is already in use`** — the server is already running (second window?) or another program uses the port.
Change it with `--port` and update the address in the overlay settings.

## Security and privacy

A live position is sensitive. By default the server:

- listens on `127.0.0.1` only (other devices cannot reach it) and warns when it listens elsewhere without a token,
- lets only websites in `allowedOrigins` read the data and sends no CORS headers to any other site (they cannot even
  detect it),
- checks the `Host` header against DNS rebinding (including names like `127.0.0.1.attacker.example`),
- sends the camera **read-only** commands and never changes its settings,
- never stores or forwards the Wi-Fi password, serial numbers or MAC addresses the camera reports.

All of this is covered by automated tests (`test/security-e2e.test.ts`, `e2e/`). Details and reporting
vulnerabilities: [SECURITY.md](SECURITY.md). **Change the DDPAI camera's default Wi-Fi password**: anyone on that
network can see the camera's video and use its settings.

## Development

```bash
pnpm install
pnpm dev             # no camera needed: fake DDPAI camera + server in one terminal, restarts on file changes
pnpm dev:fake-camera # or two terminals: 1) fake camera (logs connections)
pnpm dev:server      #                   2) a server connected to it
pnpm dev -- --no-fix --speed 90 --drop-every 20   # no satellites / speed / dropped connection scenarios
pnpm dev -- --replay diagnostics.json            # replay a streamer's diagnostics file
pnpm dev:camera      # with the real camera (193.168.0.1), watch mode
pnpm check           # typecheck (TypeScript 7) + unit, integration and process tests
pnpm test:coverage   # with a coverage report
pnpm test:e2e        # status page browser tests (Playwright)
pnpm build           # dist/ (npm package)
```

End-to-end testing on your machine (fake camera + overlay site + OBS): [docs/testing-locally.md](docs/testing-locally.md).
Architecture, code guidelines and adding a driver: [CONTRIBUTING.md](CONTRIBUTING.md),
[docs/architecture.md](docs/architecture.md).

## Contributors

Contributions are welcome, especially **test reports from other camera models**. See
[CONTRIBUTING.md](CONTRIBUTING.md). Everyone who contributed:
[github.com/ramazansancar/overlays-server/graphs/contributors](https://github.com/ramazansancar/overlays-server/graphs/contributors).

Translations of this README are welcome: `README-<language>.md`, with a region where it matters
(`README-pt-BR.md`, `README-zh-TW.md`), plus a link in the language line at the top of every README.

## License

[GNU AGPL-3.0](LICENSE) (or any later version) © 2026 Ramazan Sancar.

In short: free to use, modify and use commercially. But if you **distribute** a modified version (package, exe,
installer) **or offer it to others over a network**, you must publish its source under the same license. Keep the
status page's source link pointing to your code. The [LICENSE](LICENSE) text is binding.

DDPAI is a trademark of DDPAI Technology Co., Ltd.; this project is not affiliated with them.
