import { defineDriver } from '../../core/driver.ts';
import { DelimitedDecoder } from '../../lib/delimited.ts';
import { errorMessage } from '../../lib/log.ts';
import { ReconnectingTcpClient } from '../../lib/reconnecting-tcp.ts';
import { fetchDeviceInfo } from './http-api.ts';
import { decodeDdpaiFrame, gpsMessageToFix } from './messages.ts';

export interface DdpaiOptions {
  /** Camera address on its own Wi-Fi. DDPAI uses 193.168.0.1 (a public block, not 192.168!). */
  host: string;
  /** Live telemetry stream. */
  telemetryPort: number;
  /** HTTP API, read-only: model, firmware, memory card, camera count. */
  httpPort: number;
  /** RTSP port, for the stream URLs in the device info. */
  rtspPort: number;
  deviceInfo: boolean;
  /** Re-read the device info this often (memory card free space changes while recording). 0 = once per connection. */
  deviceInfoIntervalMs: number;
  /** Publish G-sensor samples (~16 Hz). */
  motion: boolean;
  /** Pass every other message type through as events. */
  events: boolean;
  /** Reconnect when the stream is silent this long. The camera sends G-sensor data many times a second. */
  idleTimeoutMs: number;
}

export const ddpaiDriver = defineDriver<DdpaiOptions>({
  id: 'ddpai',
  name: 'DDPAI dashcam',
  description: 'Live GPS and G-sensor from DDPAI dashcams over their Wi-Fi (TCP 6100). Tested: N5 Pro.',
  capabilities: ['gps', 'motion', 'device', 'events'],

  parseOptions: (o) => ({
    host: o.string('host', '193.168.0.1'),
    telemetryPort: o.port('telemetryPort', 6100),
    httpPort: o.port('httpPort', 80),
    rtspPort: o.port('rtspPort', 554),
    deviceInfo: o.boolean('deviceInfo', true),
    deviceInfoIntervalMs: o.number('deviceInfoIntervalMs', 60_000, { min: 0, integer: true }),
    motion: o.boolean('motion', true),
    events: o.boolean('events', true),
    idleTimeoutMs: o.number('idleTimeoutMs', 6000, { min: 0, integer: true }),
  }),

  create(ctx, options) {
    const decoder = new DelimitedDecoder({ delimiter: 0x00 });
    const unknownSeen = new Set<string>();

    let infoTimer: NodeJS.Timeout | undefined;
    const loadDeviceInfo = () => {
      if (!options.deviceInfo || ctx.signal.aborted) return;
      fetchDeviceInfo({ host: options.host, httpPort: options.httpPort, rtspPort: options.rtspPort, signal: ctx.signal })
        .then((info) => ctx.setDevice(info))
        .catch((err) => ctx.log.debug(`device info unavailable: ${errorMessage(err)}`));
    };
    const scheduleDeviceInfo = () => {
      clearInterval(infoTimer);
      loadDeviceInfo();
      if (options.deviceInfo && options.deviceInfoIntervalMs > 0) {
        infoTimer = setInterval(loadDeviceInfo, options.deviceInfoIntervalMs);
        infoTimer.unref();
      }
    };

    const handleFrame = (frame: string) => {
      const msg = decodeDdpaiFrame(frame);
      if (!msg) {
        ctx.log.debug(`unparsed frame: ${frame.slice(0, 120)}`);
        return;
      }
      switch (msg.kind) {
        case 'gps': {
          const fix = gpsMessageToFix(msg);
          if (fix) ctx.publishFix(fix);
          else ctx.publishNoFix({ ...(msg.gga?.satellites !== undefined && { satellites: msg.gga.satellites }) });
          break;
        }
        case 'gsensor':
          if (options.motion) ctx.publishMotion(msg.sample);
          break;
        case 'other':
          // Logged once per type: helps map the rest of the protocol (ADAS, alerts, ...).
          if (!unknownSeen.has(msg.msgid)) {
            unknownSeen.add(msg.msgid);
            ctx.log.info(`new message type ${msg.msgid} (please report it: docs/new-device.md)`);
          }
          if (options.events) ctx.publishEvent({ name: msg.msgid, data: msg.data, timestamp: Date.now() });
          break;
      }
    };

    const client = new ReconnectingTcpClient({
      host: options.host,
      port: options.telemetryPort,
      idleTimeoutMs: options.idleTimeoutMs,
      log: ctx.log,
      onConnect: () => {
        decoder.reset();
        ctx.setLink('online');
        scheduleDeviceInfo();
      },
      onData: (chunk) => {
        const frames = decoder.push(chunk, (bytes) => ctx.log.warn(`dropped an oversized frame (${bytes} bytes)`));
        for (const frame of frames) handleFrame(frame);
      },
      onDisconnect: (reason, wasConnected) => {
        const target = `${options.host}:${options.telemetryPort}`;
        const hint = wasConnected ? '' : ' (is this PC connected to the camera Wi-Fi?)';
        clearInterval(infoTimer);
        ctx.setLink(wasConnected ? 'offline' : 'connecting', `${target}: ${reason}${hint}`);
      },
    });

    return {
      start() {
        ctx.setLink('connecting', `${options.host}:${options.telemetryPort}`);
        client.start();
      },
      stop() {
        clearInterval(infoTimer);
        client.stop();
      },
    };
  },
});
