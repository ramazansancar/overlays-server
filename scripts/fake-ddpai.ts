/**
 * Runs a fake DDPAI camera on localhost so the real driver can be tried without hardware:
 *
 *   pnpm fake-ddpai                      # telemetry on 127.0.0.1:6100, HTTP API on 127.0.0.1:8080
 *   pnpm start -- --ddpai-host 127.0.0.1 # with sources.ddpai.options.httpPort = 8080 for device info
 *
 * Flags: --port <tcp> --http-port <port> --no-fix --speed <km/h>
 */
import { parseArgs } from 'node:util';
import { startFakeDdpai } from './lib/fake-ddpai.ts';

const argv = process.argv.slice(2);
if (argv[0] === '--') argv.shift();

const { values } = parseArgs({
  args: argv,
  options: {
    port: { type: 'string', default: '6100' },
    'http-port': { type: 'string', default: '8080' },
    'no-fix': { type: 'boolean', default: false },
    speed: { type: 'string', default: '36' },
  },
});

const time = () => new Date().toLocaleTimeString();
const fake = await startFakeDdpai({
  telemetryPort: Number(values.port),
  httpPort: Number(values['http-port']),
  noFix: values['no-fix'],
  speedKmh: Number(values.speed),
  onLog: (m) => console.log(`${time()} ${m}`),
});
console.log(`fake DDPAI camera: telemetry tcp://127.0.0.1:${fake.telemetryPort}, api http://127.0.0.1:${fake.httpPort}`);
console.log(`Connect the server from another terminal:  pnpm dev:server`);
console.log('Ctrl+C to stop.');
setInterval(() => {
  const n = fake.clients();
  console.log(`${time()} ${n ? `streaming GPS + G-sensor to ${n} client(s)` : 'waiting for a client (pnpm dev:server)…'}`);
}, 10_000).unref();
await new Promise(() => {}); // keep running until Ctrl+C
process.on('SIGINT', () => void fake.close().then(() => process.exit(0)));
