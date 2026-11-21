import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startFakeDdpai, type FakeDdpai } from '../scripts/lib/fake-ddpai.ts';
import { redact } from '../src/lib/redact.ts';
import { formatProbeReport, probeDevice } from '../src/tools/probe.ts';

describe('redact', () => {
  it('masks NMEA positions but keeps the sentence shape', () => {
    const out = redact('$GPRMC,102655.00,A,3948.1553,N,03227.7336,E,0.02,56.67,211126,,,A,V*09');
    assert.equal(out, '$GPRMC,102655.00,A,xxxx.xxxx,N,xxxxx.xxxx,E,0.02,56.67,211126,,,A,V*09');
  });

  it('masks secrets in plain and in escaped JSON', () => {
    assert.equal(redact('{"password":"hunter2","model":"X"}'), '{"password":"REDACTED","model":"X"}');
    const escaped = '{"data":"{\\"password\\":\\"hunter2\\",\\"sn\\":\\"H123\\",\\"version\\":\\"v1\\"}"}';
    const out = redact(escaped);
    assert.ok(!out.includes('hunter2') && !out.includes('H123'), out);
    assert.ok(out.includes('v1'));
  });

  it('masks decimal positions, MAC addresses and numeric serials', () => {
    const out = redact('{"lat":39.9,"lon":"32.8","macaddr":"AA:BB:CC:DD:EE:FF","sn":123456} 00-11-22-33-44-55');
    assert.ok(!/39\.9|32\.8|AA:BB|123456|00-11-22/.test(out), out);
  });
});

describe('probe', () => {
  let fake: FakeDdpai;

  before(async () => {
    fake = await startFakeDdpai({ gpsIntervalMs: 100, gsensorIntervalMs: 20 });
  });

  after(async () => {
    await fake.close();
  });

  it('finds the telemetry stream and the device API, without leaking secrets or positions', async () => {
    const report = await probeDevice('127.0.0.1', {
      ports: [fake.telemetryPort, fake.httpPort, 9],
      listenMs: 600,
      connectTimeoutMs: 500,
    });
    assert.deepEqual(report.openPorts, [fake.telemetryPort, fake.httpPort]);
    const stream = report.ports.find((p) => p.port === fake.telemetryPort);
    assert.equal(stream?.kind, 'stream');
    assert.equal(stream?.delimiter, 'NUL');
    assert.ok(stream?.messageTypes?.MSG_GpsData && stream.messageTypes.MSG_GsensorData);
    assert.equal(report.ports.find((p) => p.port === fake.httpPort)?.kind, 'http');
    assert.equal(report.device?.fields.model, 'DDPAI FAKE_Model');

    const text = formatProbeReport(report);
    assert.ok(!text.includes('do-not-leak'), 'Wi-Fi password must not appear');
    assert.ok(!/39\d\d\.\d{4},N/.test(text), 'NMEA latitude must be masked');
    assert.match(text, /xxxx\.xxxx,N/);
  });

  it('reports a host without open ports', async () => {
    const report = await probeDevice('127.0.0.1', { ports: [9], listenMs: 100, connectTimeoutMs: 300 });
    assert.deepEqual(report.openPorts, []);
    assert.match(formatProbeReport(report), /No open ports/);
  });
});
