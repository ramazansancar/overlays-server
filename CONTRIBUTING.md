# Contributing to overlays-server

Thanks for helping! Türkçe soru ve katkılar da memnuniyetle karşılanır.

The most valuable contributions right now:

1. **Test reports from other cameras** (other DDPAI models, firmware versions, other brands). Use the
   [device report](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml) issue form.
2. **New drivers** for devices that expose live GPS on the network (see [docs/drivers.md](docs/drivers.md)).
3. Bug reports with logs (`--log-level debug`). **Remove coordinates and Wi-Fi names/passwords first.**

## Development setup

Requirements: Node.js **22.18+** (runs TypeScript directly), [pnpm](https://pnpm.io) 10.

```bash
git clone https://github.com/ramazansancar/overlays-server.git
cd overlays-server
pnpm install
pnpm check        # typecheck + tests, run before every commit
```

| Script | What it does |
| --- | --- |
| `pnpm dev` | **No camera needed:** fake DDPAI camera + server in one process, `--watch`. Flags: `--no-fix`, `--speed <km/h>`, `--drop-every <s>`, `--port`, `--log-level` |
| `pnpm dev:camera` | Real camera (default config), `--watch` |
| `pnpm start -- <flags>` | Run once (e.g. `pnpm start -- --log-level debug`) |
| `pnpm simulate` | Run with the simulator source |
| `pnpm fake-ddpai` | Fake DDPAI camera alone on `127.0.0.1:6100` (+ API on `:8080`), e.g. for `pnpm start -- --ddpai-host 127.0.0.1` |
| `pnpm typecheck` | `tsc --noEmit` with **TypeScript 7** (native compiler) |
| `pnpm test` | `node --test` over `test/**/*.test.ts` |
| `pnpm build` | Emit `dist/` (JS + `.d.ts`) for the npm package |

There is no bundler and no transpile step in development: Node strips the types. That is why the code uses only
erasable TypeScript syntax (`erasableSyntaxOnly`): no `enum`, no `namespace`, no constructor parameter properties,
and relative imports end in `.ts` (rewritten to `.js` on build).

TypeScript 7 has no JavaScript API yet, so tools that need it (typescript-eslint, ts-node, ...) cannot run on it. We
don't use any. If you add one, install TypeScript 6 next to it under an alias instead of downgrading.

## Project layout

```text
src/
  cli.ts                 command line entry (config file → env → flags)
  app.ts                 startServer(): builds sources, HTTP/WS server, lifecycle
  config.ts              config schema, defaults, file lookup
  index.ts               public API for `import ... from 'overlays-server'`
  core/
    driver.ts            Driver / Source / SourceContext contracts  ← start here for new devices
    hub.ts               state per source, active GPS source, stale detection, fan-out
    protocol.ts          wire messages (v1)
    registry.ts          driver lookup
    types.ts             GpsFix, MotionSample, DeviceInfo, states
  drivers/
    index.ts             built-in driver list
    ddpai/               DDPAI: TCP 6100 telemetry + read-only HTTP API
    simulator.ts         fake GPS for development
  lib/                   NMEA parser, NUL framing, reconnecting TCP client, logger, option reader
  transports/            HTTP routes, WebSocket, SSE, origin/host/token checks, status page
scripts/                 dev tools (fake camera)
test/                    node:test suites
docs/                    architecture, protocol, drivers, devices, setup guides
```

Read [docs/architecture.md](docs/architecture.md) for how the pieces fit.

## Code guidelines

- TypeScript `strict` plus `noUncheckedIndexedAccess`; no `any` outside the driver registry.
- Only built-in Node modules and `ws` at runtime. Discuss in an issue before adding a dependency.
- Drivers never throw to the server: catch, call `ctx.setLink('offline', reason)`, retry.
- Talk to devices **read-only**. Never send commands that change device settings.
- Units at the boundary match the overlay: degrees, **m/s**, meters, epoch ms (UTC).
- Comments explain *why* (device quirks, protocol facts), not what the next line does.
- Keep the wire protocol backward compatible; see the rules in [docs/protocol.md](docs/protocol.md).

## Privacy rules (important)

This project handles live locations. In code, tests, fixtures, issues and PRs:

- **No real coordinates.** Captured frames must have their positions replaced (and checksums recomputed).
- **No Wi-Fi names, passwords, serial numbers, MAC addresses.** DDPAI's `API_GetBaseInfo` returns the Wi-Fi password
  in plain text; never log or commit its raw reply.
- Don't log full telemetry at `info` level.

## Tests

Every change needs tests. Parsers get unit tests with frames shaped exactly like the device's (see
`test/ddpai.test.ts`); behaviour that crosses the network goes into `test/server.test.ts`, which runs the real server
against `scripts/lib/fake-ddpai.ts`. If a device has a quirk, make the fake device reproduce it (the fake DDPAI
camera reproduces the N5 Pro's checksum quirk, for example).

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org): `feat(ddpai): ...`, `fix(hub): ...`, `docs: ...`.
- One topic per PR; `pnpm check` must pass (CI runs it on Windows and Linux, Node 22 and 24).
- Update docs and `CHANGELOG.md` (under *Unreleased*) when behaviour or config changes.

## Releasing (maintainers)

1. Move *Unreleased* in `CHANGELOG.md` to the new version; bump `version` in `package.json` **and** `src/version.ts`.
2. `pnpm check && pnpm build`, commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`, push with tags. The *Release*
   workflow checks that the tag matches both version strings and creates the GitHub release.
3. Publish to npm by hand: `npm publish` (`prepublishOnly` runs the checks and the build first). No npm token is
   stored in the repository or in CI.

## Code of conduct

Be kind and constructive. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
