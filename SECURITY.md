# Security policy

overlays-server handles a streamer's **live location**. Please report vulnerabilities privately.

## Reporting

Use GitHub's private vulnerability reporting:
[Report a vulnerability](https://github.com/ramazansancar/overlays-server/security/advisories/new).
Please don't open a public issue for security problems. Expect a first answer within a few days.

Include the version (`overlays-server --version`), OS, how to reproduce, and the impact. Remove real coordinates and
Wi-Fi credentials from logs.

## Supported versions

Only the latest release gets fixes.

## Security model

In scope:

- **Loopback only by default.** The server listens on `127.0.0.1`. Listening elsewhere (`--host`) is an explicit choice;
  use `token` then.
- **Origin allowlist.** Browsers attach `Origin` to cross-site `fetch`, `EventSource` and WebSocket requests. Anything
  not in `allowedOrigins` gets 403, so a random website open on the streamer's PC cannot read the location.
- **DNS rebinding.** While bound to loopback, requests whose `Host` is not a loopback name are refused (421).
- **Optional token** compared in constant time.
- **Last position on disk.** To survive restarts while GPS is lost, the last position of each source is kept in the
  user's own profile folder (`last-position.json`, `rememberLastPosition: false` turns it off). Nothing else is stored.
- **Read-only towards devices.** Drivers never send commands that change device settings.
- **Secrets from devices.** DDPAI's `API_GetBaseInfo` returns the Wi-Fi password in plain text. Only model and
  firmware are kept; the raw reply is never logged or forwarded.

Out of scope:

- Other software on the same PC (it can read loopback ports anyway).
- The camera's own security (open RTSP, HTTP API without authentication on its Wi-Fi). Change the camera's default
  Wi-Fi password.
- Websites the user added to `allowedOrigins` themselves (`*` disables the protection).

---

**Türkçe:** Güvenlik açıklarını herkese açık issue yerine GitHub'ın özel bildirim formuyla gönder (yukarıdaki link).
Loglardan gerçek koordinatları ve Wi-Fi bilgilerini çıkar.
