import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nmeaChecksum, nmeaCoordinate, nmeaTimestamp, parseGga, parseRmc, splitSentence, withChecksum } from '../src/lib/nmea.ts';

describe('nmea', () => {
  it('computes checksums like real receivers', () => {
    // Textbook sentence with a known checksum.
    assert.equal(nmeaChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'), '47');
  });

  it('rejects a wrong checksum and accepts a missing one', () => {
    const good = withChecksum('GPRMC,102655.00,A,3955.0000,N,03250.0000,E,0.02,56.67,211126,,,A,V');
    assert.ok(splitSentence(good));
    assert.equal(splitSentence(good.slice(0, -2) + '00'), undefined);
    assert.ok(splitSentence('$GPRMC,1,V'));
    assert.equal(splitSentence('GPRMC,no dollar'), undefined);
  });

  it('any-talker mode accepts a checksum computed for another talker, still rejects garbage', () => {
    const body = 'GPRMC,102655.00,A,3955.0000,N,03250.0000,E,0.02,56.67,211126,,,A,V';
    const gnChecksum = nmeaChecksum('GN' + body.slice(2));
    const sentence = '$' + body + '*' + gnChecksum;
    assert.equal(splitSentence(sentence), undefined);
    assert.ok(splitSentence(sentence, { checksum: 'any-talker' }));
    assert.ok(splitSentence('$' + body + '*00', { checksum: 'ignore' }));
    // 0x1E away from the real checksum would only match a talker swap; a random wrong value must fail.
    const wrong = ((parseInt(gnChecksum, 16) + 1) % 256).toString(16).toUpperCase().padStart(2, '0');
    assert.equal(splitSentence('$' + body + '*' + wrong, { checksum: 'any-talker' }), undefined);
  });

  it('converts coordinates with hemispheres', () => {
    assert.equal(nmeaCoordinate('3955.0000', 'N'), 39 + 55 / 60);
    assert.equal(nmeaCoordinate('03250.0000', 'E'), 32 + 50 / 60);
    assert.equal(nmeaCoordinate('3355.5000', 'S'), -(33 + 55.5 / 60));
    assert.equal(nmeaCoordinate('07000.0000', 'W'), -70);
    assert.equal(nmeaCoordinate('', 'N'), undefined);
    assert.equal(nmeaCoordinate('3999.0000', 'N'), undefined, 'minutes >= 60');
    assert.equal(nmeaCoordinate('3955.0000', 'X'), undefined);
  });

  it('builds UTC timestamps', () => {
    assert.equal(nmeaTimestamp('102655.00', '211126'), Date.UTC(2026, 10, 21, 10, 26, 55));
    assert.equal(nmeaTimestamp('102655.25', '211126'), Date.UTC(2026, 10, 21, 10, 26, 55, 250));
    assert.equal(nmeaTimestamp('102655', ''), undefined);
    assert.equal(nmeaTimestamp('256000', '211126'), undefined);
  });

  it('parses a DDPAI-style RMC (NMEA 4.1, extra mode fields)', () => {
    const rmc = parseRmc(withChecksum('GPRMC,102655.00,A,3955.0000,N,03250.0000,E,10.00,56.67,211126,,,A,V'));
    assert.ok(rmc?.valid);
    assert.equal(rmc.lat, 39 + 55 / 60);
    assert.equal(rmc.lon, 32 + 50 / 60);
    assert.ok(Math.abs(rmc.speed! - 5.144) < 0.001, 'knots to m/s');
    assert.equal(rmc.course, 56.67);
    assert.equal(rmc.timestamp, Date.UTC(2026, 10, 21, 10, 26, 55));
  });

  it('reports RMC without a fix as invalid', () => {
    const rmc = parseRmc(withChecksum('GPRMC,102655.00,V,,,,,,,211126,,,N,V'));
    assert.equal(rmc?.valid, false);
    assert.equal(rmc?.lat, undefined);
  });

  it('accepts any talker id and ignores other sentences', () => {
    assert.ok(parseRmc(withChecksum('GNRMC,102655.00,A,3955.0000,N,03250.0000,E,0,0,211126,,,A'))?.valid);
    assert.equal(parseRmc(withChecksum('GPGGA,1,2')), undefined);
    assert.equal(parseGga(withChecksum('GPRMC,1,2')), undefined);
  });

  it('parses GGA', () => {
    const gga = parseGga(withChecksum('GPGGA,102655.00,3955.0000,N,03250.0000,E,1,30,0.5,983.378,M,0.000,M,,'));
    assert.deepEqual(gga, { quality: 1, satellites: 30, hdop: 0.5, altitude: 983.378, geoidSeparation: 0 });
    const noFix = parseGga(withChecksum('GPGGA,102655.00,,,,,0,03,,,M,,M,,'));
    assert.deepEqual(noFix, { quality: 0, satellites: 3 });
  });
});
