/**
 * Masks personal data in device output before it is shown or shared (probe reports, diagnostics, issue logs):
 * positions, Wi-Fi credentials, serial numbers, MAC addresses. Works on raw text, plain JSON and
 * JSON escaped inside JSON strings (DDPAI's `data` field).
 */

const SECRET_KEYS = [
  'password', 'passwd', 'pass', 'pwd', 'psk', 'wifipwd', 'wifi_pwd', 'ssid', 'key', 'token', 'secret',
  'sn', 'serial', 'serialno', 'chipsn', 'uuid', 'imei', 'ordernum', 'nickname',
  'mac', 'macaddr', 'btmacaddr', 'wifimac', 'bssid',
];
const POSITION_KEYS = ['lat', 'lon', 'lng', 'latitude', 'longitude', 'alt', 'altitude'];

const q = '\\\\?"'; // a quote, optionally escaped (JSON inside a JSON string)
const keyed = (keys: string[], value: string) =>
  new RegExp(`(${q}(?:${keys.join('|')})${q}\\s*:\\s*)(${value})`, 'gi');

const SECRET_STRING = keyed(SECRET_KEYS, `${q}(?:[^"\\\\]|\\\\(?!"))*${q}`);
const SECRET_NUMBER = keyed(SECRET_KEYS, '-?\\d[\\d.]*');
const POSITION_VALUE = keyed(POSITION_KEYS, `-?\\d+(?:\\.\\d+)?|${q}-?\\d+(?:\\.\\d+)?${q}`);
/** NMEA `ddmm.mmmm,N` / `dddmm.mmmm,E`. */
const NMEA_COORD = /\b\d{4,5}\.\d+,(?=[NSEW]\b)/g;
const MAC = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;

export interface RedactOptions {
  /** Keep coordinates (the user chose to share their position, e.g. to debug a map problem). Default false. */
  keepPositions?: boolean;
}

export function redact(text: string, options: RedactOptions = {}): string {
  let out = text
    .replace(SECRET_STRING, '$1"REDACTED"')
    .replace(SECRET_NUMBER, '$1"REDACTED"')
    .replace(MAC, 'xx:xx:xx:xx:xx:xx');
  if (!options.keepPositions) {
    out = out.replace(POSITION_VALUE, '$1"x"').replace(NMEA_COORD, (m) => m.replace(/\d/g, 'x'));
  }
  return out;
}
