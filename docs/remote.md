# Running the server on another device / over a VPN

The default setup is one PC: overlays-server and OBS on the same machine, overlay connecting to `127.0.0.1`. You can
also run the server somewhere else — a Raspberry Pi in the car, a laptop, a box at home — and let the overlay
(OBS on the streaming PC, a cloud OBS, a restream server) reach it over the LAN, a VPN or the internet.

[Türkçe özet aşağıda](#türkçe-özet)

## Pick a setup

| Setup | Server config | Overlay settings | Works in |
| --- | --- | --- | --- |
| Same PC (default) | defaults | `127.0.0.1`, `3456` | everywhere |
| Raspberry Pi / other PC on the **same LAN** | `"host": "0.0.0.0"`, `"token"` | Pi's LAN IP (`192.168.1.50`), `3456`, token | OBS 33+, Chrome/Edge 142+ (they allow `ws://` to private IPs after a permission); older browsers need the TLS setup below |
| **VPN** with a private IP (WireGuard, ZeroTier, Tailscale IP) | `"host": "0.0.0.0"` (or the VPN IP), `"token"` | VPN IP (`10.8.0.2`, `100.x.y.z`), `3456`, token | as above |
| **Tailscale with HTTPS** (recommended for remote) | default host + `"allowedHosts": ["pi.<tailnet>.ts.net"]`, `tailscale serve` | host `pi.<tailnet>.ts.net`, port `443`, **Secure connection** on | everywhere (valid certificate) |
| **Public IP / domain** (port forwarding, DDNS) | `"host": "0.0.0.0"`, `"token"`, `"tls"` (or a reverse proxy) | your domain, your port, token, **Secure connection** on | everywhere |

**Always set a `token` when the server listens on anything other than `127.0.0.1`.** The server prints a warning if
you don't: without it, every device that can reach the port can read the live position.

Why TLS for remote setups: the overlay page is HTTPS, and browsers only let HTTPS pages open plain `ws://` connections
to `127.0.0.1` / `localhost` (and, in recent Chromium, private IP literals after a permission). A DNS name or a public
IP needs `wss://`, i.e. a certificate.

## Raspberry Pi on the LAN

`overlays-server.config.json` on the Pi:

```json
{
  "host": "0.0.0.0",
  "token": "a-long-random-string",
  "sources": [{ "id": "ddpai", "driver": "ddpai" }]
}
```

The Pi needs to reach the camera (its Wi-Fi joined to the camera network) and the streaming PC needs to reach the Pi
(Ethernet, a second Wi-Fi adapter, or the car router). In the overlay settings: server address = the Pi's IP,
port = `3456`, server token = the same string.

Start it at boot with systemd:

```ini
# /etc/systemd/system/overlays-server.service
[Unit]
Description=overlays-server
After=network-online.target

[Service]
WorkingDirectory=/home/pi
ExecStart=/usr/bin/npx overlays-server@latest --config /home/pi/overlays-server.config.json
Restart=always
User=pi

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now overlays-server`

## Tailscale (HTTPS without opening ports)

1. Install Tailscale on the Pi and on the streaming machine; enable MagicDNS and HTTPS certificates in the admin console.
2. Keep overlays-server on its default `127.0.0.1:3456` and let Tailscale publish it with a valid certificate:
   `tailscale serve --bg --https=443 http://127.0.0.1:3456`
3. Tell the server to accept the Tailscale name (the proxy forwards it as the Host header):
   ```json
   { "allowedHosts": ["pi.your-tailnet.ts.net"] }
   ```
   or `--allowed-host pi.your-tailnet.ts.net`.
4. Overlay settings: server address `pi.your-tailnet.ts.net`, port `443`, **Secure connection (wss / https)** on.

Only devices in your tailnet can reach it; adding a `token` on top does not hurt.

Alternatively `tailscale cert pi.your-tailnet.ts.net` and the built-in TLS (next section) with `"host": "0.0.0.0"`.

## Public IP / own domain

Prefer a reverse proxy that handles certificates (Caddy example):

```text
overlay.example.com {
    reverse_proxy 127.0.0.1:3456
}
```

with `"allowedHosts": ["overlay.example.com"]` and a `token`. Or let overlays-server serve TLS itself:

```json
{
  "host": "0.0.0.0",
  "port": 3456,
  "token": "a-long-random-string",
  "tls": { "certFile": "/etc/letsencrypt/live/overlay.example.com/fullchain.pem",
           "keyFile": "/etc/letsencrypt/live/overlay.example.com/privkey.pem" }
}
```

CLI equivalent: `--host 0.0.0.0 --token ... --tls-cert fullchain.pem --tls-key privkey.pem`. Forward the port on your
router, then in the overlay: your domain, the port, the token, **Secure connection** on.

## What stays protected

Whatever the setup, the server still refuses web pages not in `allowedOrigins`, answers only GET/HEAD/OPTIONS, never
sends commands to the camera, and keeps secrets out of everything it serves. Behind a proxy on loopback, Host names
outside `allowedHosts` are refused (DNS rebinding guard). See [SECURITY.md](../SECURITY.md).

---

## Türkçe özet

Sunucuyu yayın bilgisayarından başka bir yerde (araçtaki Raspberry Pi, evdeki bir kutu) çalıştırıp overlay'i
yerel ağ, VPN ya da internet üzerinden bağlayabilirsin.

- **127.0.0.1 dışında dinleyen her kurulumda `token` koy.** Koymazsan sunucu uyarı verir; porta ulaşan herkes
  konumu okuyabilir.
- **Aynı ağdaki Pi / VPN IP'si:** `"host": "0.0.0.0"` + `"token"`; overlay'de Pi'nin IP'si, port 3456 ve token.
  OBS 33+ ve yeni Chrome'da çalışır (özel IP'ye `ws://` izinli).
- **Uzaktan (önerilen): Tailscale + HTTPS:** sunucu varsayılan adreste kalır,
  `tailscale serve --bg --https=443 http://127.0.0.1:3456`, ayarlara `"allowedHosts": ["pi.<tailnet>.ts.net"]`;
  overlay'de adres `pi.<tailnet>.ts.net`, port `443`, **Güvenli bağlantı (wss / https)** açık.
- **Global IP / alan adı:** port yönlendirme + token + TLS (`"tls": { "certFile", "keyFile" }` ya da Caddy/Nginx);
  overlay'de alan adın, port, token ve **Güvenli bağlantı** açık.
- HTTPS overlay sayfası `ws://` ile yalnızca `127.0.0.1`/`localhost`'a (ve yeni Chromium'da izinle özel IP'lere)
  bağlanabilir; alan adı ya da genel IP için `wss://` (sertifika) gerekir.
