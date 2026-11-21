# Yeni bir cihaz eklemek / New device

Kameran ya da GPS cihazın [desteklenenler listesinde](devices/README.md) yok mu? Cihaz elimizde olmadan destek
ekleyebilmemiz için cihazın ağda ne konuştuğunu görmemiz gerekiyor. Bunu sen birkaç dakikada çıkarabilirsin.

[English summary at the bottom](#english)

## 1. Bilgisayarı cihazın Wi-Fi'ına bağla

Kameranın kendi Wi-Fi ağına bağlan (çoğu kamerada telefon uygulamasının bağlandığı ağ). İnternet başka bir
bağlantıdan (Ethernet) gelmeye devam edebilir: [windows-network.md](windows-network.md).

## 2. Cihazın IP adresini bul

Kameralar genelde Wi-Fi ağının **ağ geçidi** (gateway) adresindedir.

```powershell
# Windows PowerShell: Wi-Fi arayüzünün ağ geçidi
Get-NetIPConfiguration | Where-Object InterfaceAlias -like 'Wi-Fi*' | ForEach-Object { $_.IPv4DefaultGateway.NextHop }
```

```bat
:: Windows CMD: "Wireless LAN adapter Wi-Fi" altındaki "Default Gateway" / "Varsayılan Ağ Geçidi"
ipconfig
```

```bash
# macOS
route -n get default | grep gateway
# Linux
ip route | grep default
```

Sık görülen adresler (modele göre değişebilir): DDPAI `193.168.0.1`, 70mai `192.168.0.1`, Viofo `192.168.1.254`,
BlackVue `10.99.77.1`.

## 3. Cihazı incele (probe)

```bash
npx overlays-server@latest --probe 193.168.0.1
```

Windows'ta raporu doğrudan panoya kopyalamak için:

```bat
npx overlays-server@latest --probe 193.168.0.1 | clip
```

Dosyaya yazmak için: `... --probe 193.168.0.1 > probe.md`. Git kurulumunda: `npm start -- --probe 193.168.0.1`.

Probe ne yapar?

- Kameralarda sık kullanılan portları tarar (`--probe-ports 80,554,6100` ile kendi listeni verebilirsin).
- Açık her portu birkaç saniye dinler: cihaz kendiliğinden veri gönderiyorsa (canlı telemetri) mesaj tiplerini sayar
  ve her tipten bir örnek alır.
- HTTP ve RTSP sunucularının adını okur, DDPAI tarzı API'lerden model ve firmware'i alır.
- **Sadece okur.** Cihaza ayar değiştiren hiçbir komut göndermez.
- **Kişisel veriyi maskeler:** koordinatlar `xxxx.xxxx`, Wi-Fi adı ve şifresi, seri numarası, MAC adresi
  `REDACTED` olur. Yine de göndermeden önce raporu bir kez gözden geçir.

Daha iyi sonuç için: kamera açık havada, GPS'i uyduya kilitli olsun (araç hareket ediyorsa da olur).

## 4. Raporu gönder

[Cihaz raporu formunu](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml) aç,
probe çıktısını yapıştır. Form, cihaz bilgisini nasıl bulacağını adım adım gösteriyor.

Probe çalışmazsa formdaki PowerShell / curl komutlarıyla da bilgi toplayabilirsin.

Sunucu çalışırken konsolda `new message type ...` görürsen (tanımadığı bir cihaz mesajı), o günün log dosyasını da
ekle: mesajın örnekleri orada (`start.cmd` ile yanındaki `logs` klasörü, diğer durumlarda
`%APPDATA%overlays-serverlogs`). Konum ve gizli alanlar dosyada zaten gizli.

## 5. Sonrası

Rapordan cihazın canlı konum verip vermediği anlaşılır:

| Raporda görünen | Anlamı |
| --- | --- |
| Bir portta `stream`, tiplerde NMEA (`GPRMC`, `GNRMC`, `GPGGA`) ya da `Gps` geçen mesajlar | Canlı GPS var, sürücü yazılabilir |
| Sadece `http` / `rtsp` | Canlı konum ağda yayınlanmıyor olabilir; HTTP API'de konum ucu aranır |
| Hiç açık port yok | Bilgisayar cihazın ağında değil ya da IP yanlış |

Sürücü yazmak istersen (geliştiriciler): [drivers.md](drivers.md). Sahte cihaz yazıp testlerle göndermek en hızlı
yol; örnek: `scripts/lib/fake-ddpai.ts`.

---

## English

1. Join the device's Wi-Fi.
2. Find its IP (usually the Wi-Fi gateway: `ipconfig`, `ip route`).
3. Run `npx overlays-server@latest --probe <ip>` (Windows: append `| clip` to copy). It scans common ports, listens
   for pushed data, reads server names and DDPAI-style model/firmware, is read-only, and masks positions, Wi-Fi
   credentials, serials and MACs.
4. Paste the report into a
   [device report](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml).
   A `new message type ...` line on the console (a message the server does not know): attach that day's log file
   too (`logs` next to `start.cmd`, otherwise `%APPDATA%overlays-serverlogs` / `~/.config/overlays-server/logs`); it
   holds samples of the message, masked.

Writing the driver yourself: [drivers.md](drivers.md).
