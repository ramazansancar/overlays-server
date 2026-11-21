/**
 * Development without a camera: starts the fake DDPAI camera and the server wired to it, in one process.
 * The real `ddpai` driver runs against it, so this exercises the same code as the car setup.
 *
 *   pnpm dev                          # fake camera + server on http://127.0.0.1:3456, restarts on file changes
 *   pnpm dev -- --no-fix              # camera without satellite lock
 *   pnpm dev -- --speed 90            # drive faster (km/h)
 *   pnpm dev -- --drop-every 20       # drop the camera connection every 20 s (reconnect testing)
 *   pnpm dev -- --port 3457 --log-level debug
 *   pnpm dev -- --replay diagnostics.json  # replay a streamer's diagnostics file (loops)
 *
 * Two terminals instead (fake camera output visible on its own):
 *   pnpm dev:fake-camera              # terminal 1: fake camera on 127.0.0.1:6100 (+ API :8080)
 *   pnpm dev:server                   # terminal 2: server connected to it (= pnpm dev -- --external)
 *
 * Use `pnpm dev:camera` for the real camera.
 */
import { parseArgs } from 'node:util';
import { startFakeDdpai } from './lib/fake-ddpai.ts';
import { loadReplayFrames } from './lib/replay.ts';
import { startServer } from '../src/app.ts';
import { parseConfig } from '../src/config.ts';
import { createLogger } from '../src/lib/log.ts';

// `pnpm dev -- --flag` passes the `--` through.
const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values } = parseArgs({
  args: argv,
  options: {
    port: { type: 'string', default: '3456' },
    'log-level': { type: 'string', default: 'info' },
    'no-fix': { type: 'boolean', default: false },
    speed: { type: 'string', default: '36' },
    lat: { type: 'string' },
    lon: { type: 'string' },
    'drop-every': { type: 'string' },
    external: { type: 'boolean', default: false },
    replay: { type: 'string' },
    'replay-source': { type: 'string' },
    'camera-host': { type: 'string', default: '127.0.0.1' },
    'camera-port': { type: 'string', default: '6100' },
    'camera-http-port': { type: 'string', default: '8080' },
  },
});

const replay = values.replay ? loadReplayFrames(values.replay, values['replay-source']) : undefined;
if (replay) {
  const seconds = ((replay.frames.at(-1)!.t - replay.frames[0]!.t) / 1000).toFixed(0);
  console.log(`replaying ${replay.frames.length} frames (${seconds} s, source "${replay.source}") from ${values.replay}`);
  if (replay.synthesizedPositions > 0) {
    console.log(`positions were masked: ${replay.synthesizedPositions} GPS frames get a stand-in track from the recorded speed and course`);
  }
}
const fake = values.external
  ? undefined
  : await startFakeDdpai({
      ...(replay && { replay: replay.frames }),
      noFix: values['no-fix'],
      speedKmh: Number(values.speed),
      ...(values.lat && { lat: Number(values.lat) }),
      ...(values.lon && { lon: Number(values.lon) }),
    });
const camera = fake
  ? { host: '127.0.0.1', telemetryPort: fake.telemetryPort, httpPort: fake.httpPort }
  : { host: values['camera-host'], telemetryPort: Number(values['camera-port']), httpPort: Number(values['camera-http-port']) };

const config = parseConfig({
  port: values.port,
  logLevel: values['log-level'],
  sources: [
    {
      id: 'ddpai',
      driver: 'ddpai',
      options: { ...camera, idleTimeoutMs: 3000 },
    },
  ],
});
const log = createLogger(config.logLevel);
log.info(
  fake
    ? `built-in fake DDPAI camera on tcp://127.0.0.1:${fake.telemetryPort} (api :${fake.httpPort})`
    : `using the camera at tcp://${camera.host}:${camera.telemetryPort} (api :${camera.httpPort}); start it with: pnpm dev:fake-camera`,
);

const server = await startServer({ config, log });
log.info(`status page:   ${server.url}/`);
log.info(`overlay feed:  ${server.url.replace(/^http/, 'ws')}/v1/ws`);

if (values['drop-every'] && fake) {
  const seconds = Number(values['drop-every']);
  setInterval(() => {
    log.info('dev: dropping the camera connection');
    fake.dropClients();
  }, seconds * 1000).unref();
}

const shutdown = () => {
  void Promise.all([server.close(), fake?.close()]).then(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
