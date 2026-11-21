# DDPAI dashcams (`ddpai` driver)

Verified on a **DDPAI N5 Pro**, model `DN2509_Overseas`, firmware `v8.0.0.10` (November 2026). Other DDPAI models that
expose the same TCP 6100 stream should work; please send a
[device report](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml).

## Setup

1. Connect the PC to the camera's Wi-Fi (`DDPAI_<model>_<xxxx>`).
2. Keep internet on another adapter (Ethernet). On Windows set the interface metrics so internet traffic does not try
   the camera: [windows-network.md](../windows-network.md).
3. Start overlays-server; the default config already contains a `ddpai` source.

The camera cannot join another Wi-Fi network (no station mode), so the PC must be on the camera's network.

**Change the camera's default Wi-Fi password.** Anyone on that network can watch the live video (RTSP has no
password) and use the camera's API.

## Options

| Option | Default | |
| --- | --- | --- |
| `host` | `193.168.0.1` | Camera address. Note: DDPAI uses a *public* block, not 192.168.x |
| `telemetryPort` | `6100` | Live telemetry stream |
| `httpPort` | `80` | HTTP API (device info, read-only) |
| `rtspPort` | `554` | Used for the RTSP URLs in the device info |
| `deviceInfo` | `true` | Read device info (model, firmware, memory card, cameras, other fields) |
| `deviceInfoIntervalMs` | `60000` | Re-read it this often (free space changes while recording); `0` = once per connection |
| `motion` | `true` | Publish G-sensor samples |
| `events` | `true` | Pass unknown message types through as events |
| `idleTimeoutMs` | `6000` | Reconnect when the stream is silent this long (the camera sends ~16 messages/s) |

```json
{ "sources": [{ "id": "ddpai", "driver": "ddpai", "options": { "host": "193.168.0.1" } }] }
```

## What the camera exposes

| Port | Service | Used |
| --- | --- | --- |
| 80 | HTTP, `VYOU_HTTP_SERVER`, `/vcam/cmd.cgi?cmd=...` (also `/cmd.cgi`) | `API_GetBaseInfo` (read-only) |
| 443 | open, no answer observed | no |
| 554 | RTSP live preview: `/liveRTSP/av4` (front), `/liveRTSP/av5` (rear) | no (OBS reads it directly) |
| 6100 | Telemetry stream | **yes** |

### TCP 6100 telemetry

No handshake or session: connect and data flows. Frames are JSON objects separated by a **NUL byte** (`\0`). The
`data` field is itself JSON **encoded as a string**:

```text
{"msgid":"MSG_GsensorData","data":"{\"gsensordata\":\"$GSENSOR,-35,-98,1054,1795256586151\"}"}\0
{"msgid":"MSG_GpsData","data":"{\"gpsdata\":\"$GPRMC,102655.00,A,3955.0000,N,03250.0000,E,0.02,56.67,211126,,,A,V*06\\n\",\"ggadata\":\"$GPGGA,102655.00,3955.0000,N,03250.0000,E,1,30,0.5,983.378,M,0.000,M,,*41\\n\"}"}\0
```

(Coordinates replaced; checksums recomputed the way the camera does it, see below.)

| msgid | Rate | Content |
| --- | --- | --- |
| `MSG_GpsData` | ~1 Hz | `gpsdata`: RMC sentence, `ggadata`: GGA sentence (each ends with `\n`) |
| `MSG_GsensorData` | ~16 Hz | `$GSENSOR,x,y,z,epochMs`, x/y/z in milli-g, camera clock in UTC ms |

RMC gives position, speed (knots), course, UTC date/time and fix status (`A`/`V`); GGA gives satellites, HDOP and
altitude above mean sea level. Other `msgid`s are logged once (`new message type ...`); please report them.

### Checksum quirk

The N5 Pro computes the NMEA checksum as if the talker were **`GN`**, then sends the sentence as **`GP`**. Standard
parsers reject every sentence. The driver uses `checksum: 'any-talker'`, which accepts a checksum that matches the
sentence under any common talker id and still rejects corrupted data. The fake camera (`pnpm fake-ddpai`) reproduces
this.

### HTTP API notes

- Replies: `{"errcode":0,"data":"<JSON string>"}`. No CORS headers, so browsers cannot call it directly.
- `API_GetBaseInfo` returns model, firmware, memory card size and free space (`sdcapacity`, `sdspare`, KiB as far as we
  can tell: 499939456 on a 512 GB card), number of cameras (`sensor_cnt`), ADAS type, preview settings and more, but
  also serial numbers, MAC addresses, the Wi-Fi name **and the Wi-Fi password in plain text**. The driver publishes
  everything except those (filtered by field name) and never logs the raw reply. Field list: [data.md](../data.md).
- `API_GetGpsState` → `{"gpsstate":2,"signal":1}`: lock status only, no coordinates.
- `API_GpsFileListReq` lists past tracks as 8-minute `.git` (tar of NMEA) files: history only, not live.
- `/current.gpx` (used by older DDPAI models) returns 404 on this firmware.
- The `doi-lel: 1` header mentioned for some N5 models was not needed.

## Field data (diagnostics, 2026-11-21, N5 Pro v8.0.0.10)

- Two 2-minute captures on the streamer's setup: GPS exactly 1.0 Hz, G-sensor 15.5 Hz, largest gap between messages
  83 ms, no disconnects, no message types other than GPS and G-sensor (car mostly standing still).
- 31–35 satellites, HDOP reported as a constant 0.5.
- Memory card: `sdcapacity` 499939456 on a 512 GB card → KiB confirmed (511.9 GB); free space rose between captures
  (loop recording deletes old files).
- GPS (UTC) time was ~8 s ahead of the PC clock, i.e. that PC's clock was behind. Harmless: overlays use their own
  clock for staleness and only time differences between fixes.

## Not verified yet

- More than one client on port 6100 at the same time (e.g. with the DDPAI phone app open).
- Behaviour in parking mode / when recording stops.
- Other DDPAI models and firmware lines (`v8.0.1.x` is reported to be a separate line).
