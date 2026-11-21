/**
 * Development without a camera: starts the fake DDPAI camera and the server wired to it, in one process.
 * The real `ddpai` driver runs against it, so this exercises the same code as the car setup.
 *
 *   pnpm dev                          # fake camera + server on http://127.0.0.1:3456, restarts on file changes
 *   pnpm dev -- --no-fix              # camera without satellite lock
 *   pnpm dev -- --speed 90            # drive faster (km/h)
 *   pnpm dev -- --drop-every 20       # drop the camera connection every 20 s (reconnect testing)
 *   pnpm dev -- --port 3457 --log-level debug
 *
 * Use `pnpm dev:camera` for the real camera.
 */
import { parseArgs } from 'node:util';
import { startFakeDdpai } from './lib/fake-ddpai.ts';
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
  },
});

const fake = await startFakeDdpai({
  noFix: values['no-fix'],
  speedKmh: Number(values.speed),
  ...(values.lat && { lat: Number(values.lat) }),
  ...(values.lon && { lon: Number(values.lon) }),
});

const config = parseConfig({
  port: values.port,
  logLevel: values['log-level'],
  sources: [
    {
      id: 'ddpai',
      driver: 'ddpai',
      options: { host: '127.0.0.1', telemetryPort: fake.telemetryPort, httpPort: fake.httpPort, idleTimeoutMs: 3000 },
    },
  ],
});
const log = createLogger(config.logLevel);
log.info(`fake DDPAI camera on tcp://127.0.0.1:${fake.telemetryPort} (api :${fake.httpPort})`);

const server = await startServer({ config, log });
log.info(`status page:   ${server.url}/`);
log.info(`overlay feed:  ${server.url.replace(/^http/, 'ws')}/v1/ws`);

if (values['drop-every']) {
  const seconds = Number(values['drop-every']);
  setInterval(() => {
    log.info('dev: dropping the camera connection');
    fake.dropClients();
  }, seconds * 1000).unref();
}

const shutdown = () => {
  void Promise.all([server.close(), fake.close()]).then(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
