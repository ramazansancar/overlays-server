# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- CI: the `start.cmd` update test failed on pull requests (detached checkout); the test clone is put on a branch.

## [0.1.0] - 2026-11-21

First release, on npm as [`overlays-server`](https://www.npmjs.com/package/overlays-server).

### Security

- DNS rebinding guard: host names starting with `127.` (e.g. `127.0.0.1.attacker.example`) were treated as loopback;
  only real IPv4 literals in 127.0.0.0/8 count now.
- Websites not in `allowedOrigins` no longer get CORS headers on refused requests, so they cannot detect the server.
- Warning at start when listening on a non-loopback address without a token.

### Changed

- License: MIT → **GNU AGPL-3.0-or-later**. Modified versions that are distributed or offered over a network must
  publish their source under the same license. (Copies obtained before this change keep their MIT terms.)

### Added

- Remote setups (Raspberry Pi, VPN, reverse proxy, public address): `allowedHosts` / `--allowed-host` for proxy host
  names, built-in TLS (`tls` / `--tls-cert` / `--tls-key`) for HTTPS + WSS; guide in `docs/remote.md`.
- `--probe` recognises RTSP servers on any port.
- Test suite: unit, integration, security/attack scenarios, process-level CLI and `start.cmd` tests (`pnpm test`,
  `pnpm test:coverage`) and status page browser tests with Playwright (`pnpm test:e2e`); CI runs all of them.
- README in English (`README.md`) and Turkish (`README-tr.md`).
- Last known position: kept on disk (`rememberLastPosition`, `stateFile`) and sent with `lastKnown: true` to clients
  that connect while GPS is lost (tunnels) or after a restart; the status page marks it.
- Local bridge server: WebSocket (`/v1/ws`), Server-Sent Events (`/v1/stream`), JSON state (`/v1/state`),
  health check and a status page.
- Modular driver system (`defineDriver`), multiple sources, GPS source priority with automatic failover,
  stale detection.
- `ddpai` driver: live GPS (1 Hz) and G-sensor from DDPAI dashcams over TCP 6100, model/firmware from the HTTP API.
  Handles the N5 Pro's NMEA checksum quirk (checksum computed for `GN`, sent as `GP`).
- `simulator` driver for development without hardware.
- Security: loopback-only by default, origin allowlist, Host header check (DNS rebinding), optional token.
- Config file with defaults, environment variables and CLI flags; `--simulate`, `--print-config`, `--list-drivers`.
- Run from a git clone (`npm start`, `start.cmd`, no build step) or from npm (`npx overlays-server`). `start.cmd`
  updates itself with `git pull --ff-only` before starting (`OVERLAYS_SERVER_NO_UPDATE=1` to skip) and reinstalls
  dependencies when they changed.
- Programmatic API (`import { startServer, defineDriver } from 'overlays-server'`).
- Fake DDPAI camera for development and tests; `pnpm dev` runs the server against it (`--no-fix`, `--speed`,
  `--drop-every`), or in two terminals `pnpm dev:fake-camera` + `pnpm dev:server`. `--ddpai-http-port` flag.
- Overlay connections and refusals are logged at `info` / `warn`.
- Status page is live over WebSocket (`source=*` subscription, new), shows map links (Google Maps, Yandex,
  OpenStreetMap) for the position, and offers a diagnostics download (`/v1/diagnostics`: recent raw device frames,
  logs, config, state; secrets always masked, positions opt-in). The fake camera replays these files
  (`--replay`; files without positions get a dead-reckoned stand-in track from the recorded speed and course, so
  their GPS frames still parse). `/health` reports protocol and per-source state; `status` messages carry `driverName`.
- `--probe <host>`: inspects a device (ports, HTTP/RTSP servers, model/firmware, pushed data samples) and prints a
  Markdown report for new-device issues, with positions, Wi-Fi credentials, serials and MACs masked.
- Docs: new-device guide, supported devices with a test log, local testing guide; issue forms with commands.
- Everything the device offers: fix quality, geoid separation and mode in `fix`; device info with memory card,
  camera count, RTSP stream URLs and every other non-secret field (re-read every 60 s); unknown device messages as
  `event` (`?events=1`, `?all=1`); `lastMotion` in `/v1/state`; richer status page. Data catalog: `docs/data.md`.

[Unreleased]: https://github.com/ramazansancar/overlays-server/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ramazansancar/overlays-server/releases/tag/v0.1.0
