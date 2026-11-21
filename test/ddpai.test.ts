import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pickDeviceInfo } from '../src/drivers/ddpai/http-api.ts';
import { decodeDdpaiFrame, gpsMessageToFix, parseGsensor } from '../src/drivers/ddpai/messages.ts';
import { ddpaiSentence } from '../scripts/lib/fake-ddpai.ts';
import { parseRmc, withChecksum } from '../src/lib/nmea.ts';

// Same shape and checksum quirk as frames captured from an N5 Pro (coordinates changed).
const rmc = ddpaiSentence('GPRMC,102655.00,A,3955.0000,N,03250.0000,E,0.02,56.67,211126,,,A,V');
const gga = ddpaiSentence('GPGGA,102655.00,3955.0000,N,03250.0000,E,1,30,0.5,983.378,M,0.000,M,,');
const gpsFrame = JSON.stringify({ msgid: 'MSG_GpsData', data: JSON.stringify({ gpsdata: `${rmc}\n`, ggadata: `${gga}\n` }) });
const gsensorFrame = '{"msgid":"MSG_GsensorData","data":"{\\"gsensordata\\":\\"$GSENSOR,-35,-98,1054,1795256586151\\"}"}';

describe('ddpai messages', () => {
  it('decodes a GPS frame into a fix', () => {
    const msg = decodeDdpaiFrame(gpsFrame);
    assert.equal(msg?.kind, 'gps');
    const fix = gpsMessageToFix(msg as Extract<typeof msg, { kind: 'gps' }> & object);
    assert.ok(fix);
    assert.equal(fix.lat, 39 + 55 / 60);
    assert.equal(fix.lon, 32 + 50 / 60);
    assert.equal(fix.heading, 56.67);
    assert.equal(fix.altitude, 983.378);
    assert.equal(fix.satellites, 30);
    assert.equal(fix.hdop, 0.5);
    assert.equal(fix.timestamp, Date.UTC(2026, 10, 21, 10, 26, 55));
    assert.ok(Math.abs(fix.speed! - 0.0103) < 0.001);
  });

  it('needs the any-talker checksum mode for real camera sentences', () => {
    assert.equal(parseRmc(rmc), undefined, 'strict mode rejects the GN-checksummed GP sentence');
    assert.ok(parseRmc(rmc, { checksum: 'any-talker' })?.valid);
    assert.ok(withChecksum('GPRMC,1,V') !== ddpaiSentence('GPRMC,1,V'));
  });

  it('gives no fix while the receiver searches', () => {
    const noFixRmc = withChecksum('GPRMC,102655.00,V,,,,,,,211126,,,N,V');
    const noFixGga = withChecksum('GPGGA,102655.00,,,,,0,03,,,M,,M,,');
    const frame = JSON.stringify({ msgid: 'MSG_GpsData', data: JSON.stringify({ gpsdata: noFixRmc, ggadata: noFixGga }) });
    const msg = decodeDdpaiFrame(frame);
    assert.equal(msg?.kind, 'gps');
    assert.equal(gpsMessageToFix(msg as Extract<typeof msg, { kind: 'gps' }> & object), undefined);
  });

  it('decodes G-sensor frames in g', () => {
    const msg = decodeDdpaiFrame(gsensorFrame);
    assert.deepEqual(msg, { kind: 'gsensor', sample: { x: -0.035, y: -0.098, z: 1.054, timestamp: 1795256586151 } });
    assert.equal(parseGsensor('$GSENSOR,1,2'), undefined);
  });

  it('passes unknown message types through and ignores garbage', () => {
    assert.deepEqual(decodeDdpaiFrame('{"msgid":"MSG_Something","data":"{\\"a\\":1}"}'), {
      kind: 'other',
      msgid: 'MSG_Something',
      data: { a: 1 },
    });
    assert.equal(decodeDdpaiFrame('not json'), undefined);
    assert.equal(decodeDdpaiFrame('{"no":"msgid"}'), undefined);
    assert.equal(decodeDdpaiFrame('{"msgid":"MSG_GpsData","data":"{}"}'), undefined);
  });

  it('turns base info into device info without any secret field', () => {
    const raw = {
      model: 'DDPAI DN2509_Overseas',
      version: 'v8.0.0.10',
      'mcu version': 53,
      password: 'secret1',
      nickname: 'secret2',
      ordernum: 'secret3',
      uuid: 'secret4',
      sn: 'secret5',
      macaddr: 'secret6',
      chipsn: 'secret7',
      btmacaddr: 'secret8',
      random: 'secret9',
      upgrade_key: 'secret10',
      sdcapacity: 499939456,
      sdspare: 57775296,
      sensor_cnt: 2,
      adas_type: 2,
    };
    const info = pickDeviceInfo(raw, { host: '193.168.0.1', rtspPort: 554 }, 1000);
    assert.equal(info.model, 'DN2509_Overseas');
    assert.equal(info.firmware, 'v8.0.0.10');
    assert.deepEqual(info.storage, { totalBytes: 499939456 * 1024, freeBytes: 57775296 * 1024 });
    assert.equal(info.cameras, 2);
    assert.deepEqual(info.streams, [
      { name: 'front', url: 'rtsp://193.168.0.1:554/liveRTSP/av4' },
      { name: 'rear', url: 'rtsp://193.168.0.1:554/liveRTSP/av5' },
    ]);
    assert.deepEqual(info.details, { 'mcu version': 53, sdcapacity: 499939456, sdspare: 57775296, sensor_cnt: 2, adas_type: 2 });
    assert.ok(!/secret/.test(JSON.stringify(info)), JSON.stringify(info));
  });

  it('lists only the front stream for a single camera and skips storage without a card', () => {
    const info = pickDeviceInfo({ sensor_cnt: 1, sdcapacity: 0, sdspare: 0 }, { host: '10.0.0.1', rtspPort: 554 });
    assert.equal(info.streams?.length, 1);
    assert.equal(info.storage, undefined);
  });

  it('adds fix quality, geoid separation and mode', () => {
    const msg = decodeDdpaiFrame(gpsFrame);
    const fix = gpsMessageToFix(msg as Extract<typeof msg, { kind: 'gps' }> & object)!;
    assert.equal(fix.quality, 1);
    assert.equal(fix.geoidSeparation, 0);
    assert.equal(fix.mode, 'A');
  });
});
