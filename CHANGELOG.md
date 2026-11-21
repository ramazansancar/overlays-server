# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- License: MIT → **GNU AGPL-3.0-or-later**. Modified versions that are distributed or offered over a network must
  publish their source under the same license. (Copies obtained before this change keep their MIT terms.)

### Added

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
