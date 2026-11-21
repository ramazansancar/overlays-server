# Supported devices / Desteklenen cihazlar

| Device | Driver | Live data | Status | Details |
| --- | --- | --- | --- | --- |
| DDPAI N5 Pro | `ddpai` | GPS 1 Hz, G-sensor ~16 Hz, model/firmware | ✅ Tested | [ddpai.md](ddpai.md) |
| Other DDPAI models with TCP 6100 telemetry | `ddpai` | same | ❔ Untested | [ddpai.md](ddpai.md) |
| — (no hardware) | `simulator` | GPS, motion | ✅ Built in | [drivers.md](../drivers.md#simulator) |

Your device is missing? Follow [new-device.md](../new-device.md): one command (`--probe`) collects what we need.

## Test log

Every entry is a real test on real hardware. Add yours with a
[device report](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml) or a PR to
this table (no names of private people, no locations).

| Date | Device | Firmware | overlays-server | Environment | Result |
| --- | --- | --- | --- | --- | --- |
| 2026-11-21 | DDPAI N5 Pro (`DN2509_Overseas`) | `v8.0.0.10` | protocol capture (pre-0.1.0) | Windows, PC on camera Wi-Fi + Ethernet internet, OBS 33.0.1 | ✅ TCP 6100 stream verified: GPS 1 Hz (RMC + GGA, 30 satellites, HDOP 0.5), G-sensor ~16 Hz. Found the GN/GP checksum quirk. `/current.gpx` 404 |
| 2026-11-21 | DDPAI N5 Pro (`DN2509_Overseas`) | `v8.0.0.10` | 0.1.0 | Windows, camera Wi-Fi + Ethernet internet, OBS 33.0.1 browser source, overlays.ramazansancar.com.tr map | ✅ Field test on the streamer's setup: live position on the map overlay, no problems reported |
| 2026-11-21 | Fake DDPAI camera (`pnpm dev`) | — | 0.1.0 | Windows 10, Node 22.18 | ✅ Automated tests: fixes, no-fix, reconnect, device info |

### What a test entry should contain

- **Device** and exact model string (status page or `--probe` shows it), **firmware** version.
- **overlays-server version** (`overlays-server --version`).
- **Environment**: OS, how the PC reaches the device (camera Wi-Fi + Ethernet, USB Wi-Fi dongle, Raspberry Pi...),
  OBS version if the overlay was tested in OBS.
- **Result**: fixes arriving? rate? anything odd (reconnects, wrong speed, missing altitude)?
