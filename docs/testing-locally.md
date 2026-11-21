# Testing locally / Yerelde test

Kamera olmadan tüm zinciri (sahte kamera → overlays-server → harita overlay'i) kendi bilgisayarında denemek için.

## 1. Sunucu: otomatik testler

```bash
cd overlays-server
pnpm install
pnpm check            # TypeScript 7 tip kontrolü + tüm Node testleri
pnpm test:coverage    # aynı testler, dosya başına kapsama raporuyla
pnpm test:e2e         # durum sayfası tarayıcı testleri (Playwright; yerelde kurulu Chrome'u kullanır)
pnpm check:all        # hepsi
```

| Test dosyaları | Ne doğrular |
| --- | --- |
| `test/nmea`, `delimited`, `ddpai`, `hub`, `config`, `units` | Ayrıştırıcılar, cihaz tuhaflıkları, durum makinesi, ayarlar, loglama, simülatör, yeniden bağlanma |
| `test/server`, `diagnostics`, `last-position`, `app` | Gerçek sunucu + sahte kamera: akış, tanı dosyası, son konum, başlangıç hataları |
| `test/security-e2e`, `remote` | Saldırılar (yabancı site, DNS rebinding, token, büyük mesaj, yol denemeleri) ve kullanım senaryoları (overlay sitesi, LAN/Pi, ters vekil, TLS) |
| `test/cli-e2e` | Gerçek `node src/cli.ts` süreci; Windows'ta `start.cmd` (güncelleme yolu dahil, internetsiz) |
| `e2e/status-page.spec.ts` | Tarayıcıda durum sayfası: canlı veri, XSS denemesi, harita linkleri, tanı indirme, yeniden bağlanma, token, son konum |

## 2. Sunucu: sahte kamerayla çalıştır

```bash
pnpm dev              # sahte DDPAI kamera + sunucu, http://127.0.0.1:3456
```

Ya da **iki terminalde** (sahte kameranın ne yaptığını ayrı görmek için):

```bash
pnpm dev:fake-camera     # 1. terminal: sahte kamera 127.0.0.1:6100 (API :8080); bağlantıları ve istekleri yazar
pnpm dev:server          # 2. terminal: sunucu, 1. terminaldeki kameraya bağlanır
```

1. terminalde `telemetry client connected`, 2. terminalde `ddpai: link online` ve `ddpai: gps fix` görmelisin.
Overlay bağlanınca 2. terminal `overlay connected (http://localhost:5173 ...)` yazar.

Durum sayfası: <http://127.0.0.1:3456>. Senaryolar (her biri ayrı çalıştırılır, tek terminal modu):

```bash
pnpm dev -- --no-fix            # kamera uydu arıyor (gps: no_fix)
pnpm dev -- --speed 120         # hızlı sürüş
pnpm dev -- --drop-every 15     # 15 sn'de bir kamera bağlantısı kopar, sunucu yeniden bağlanır
pnpm dev -- --port 3457         # başka port (overlay'de portu da değiştir)
pnpm dev -- --log-level debug   # ayrıntılı log
```

Akışı terminalden izlemek:

```bash
curl http://127.0.0.1:3456/v1/state                 # anlık durum (JSON)
curl -N http://127.0.0.1:3456/v1/stream             # canlı akış (SSE), Ctrl+C ile çık
```

PowerShell'de `curl` yerine `curl.exe` yaz (PowerShell'in `curl` takma adı başka bir komut).

WebSocket'i Node ile dinlemek (Node 22+ yerleşik WebSocket):

```bash
node -e "const ws=new WebSocket('ws://127.0.0.1:3456/v1/ws');ws.onmessage=e=>console.log(e.data)"
```

Güvenlik kontrolü (yabancı site reddedilmeli → 403, yanlış Host → 421):

```bash
curl -i -H "Origin: https://evil.example" http://127.0.0.1:3456/v1/state
curl -i -H "Host: evil.example" http://127.0.0.1:3456/v1/state
```

Probe aracını sahte kameraya karşı denemek (iki terminal):

```bash
pnpm dev:fake-camera                                             # 1. terminal: 127.0.0.1:6100 + API :8080
node src/cli.ts --probe 127.0.0.1 --probe-ports 6100,8080        # 2. terminal
```

## 3. Overlay sitesiyle uçtan uca

İki terminal:

```bash
# 1. terminal: sunucu + sahte kamera (tek süreç)
cd overlays-server
pnpm dev

# 2. terminal: overlay sitesi (Vite dev, http://localhost:5173)
cd overlays.ramazansancar.com.tr
pnpm install
pnpm dev
```

1. <http://localhost:5173> aç → yayıncı seç → **Harita** overlay'i.
2. **Konum kaynağı**: *Araç kamerası GPS — overlays-server [yerel]*.
3. **Sunucu adresi** `127.0.0.1` (ya da altındaki `localhost`), **port** `3456`. Önizlemede araç Kızılay çevresinde
   daire çizmeli.
4. Kopma testi: 1. terminali `pnpm dev -- --drop-every 15` ile yeniden başlat; overlay kendiliğinden toparlanmalı.
   Sunucuyu tamamen kapatıp açmak da (Ctrl+C → `pnpm dev`) aynı şekilde toparlanmalı.
5. Farklı port: `pnpm dev -- --port 3457`, overlay ayarında portu 3457 yap.

`localhost:5173` sunucunun varsayılan `allowedOrigins` listesinde, ek ayar gerekmez.

### OBS'te

Aynı iki terminal açıkken OBS → **Kaynaklar → + → Tarayıcı** → URL olarak ayar sayfasındaki
*Tarayıcı kaynağı URL'si*ni yapıştır (`http://localhost:5173/overlay.html?...`), 1920×1080.

Canlı siteyle (`https://overlays.ramazansancar.com.tr`) denemek, overlay tarafındaki değişiklik yayına alındıktan
sonra mümkün. OBS 33 beta kullandıysan ve bağlantı reddediliyorsa: OBS'i kapat,
`%APPDATA%\obs-studio\plugin_config\obs-browser` klasörünü sil.

## 4. Bir yayıncının sorununu tekrar oynatmak

Yayıncı durum sayfasından **Tanı verisini indir** ile aldığı dosyayı gönderir. Sahte kamera o dosyadaki ham mesajları
orijinal zamanlamasıyla döngüde yeniden yayınlar:

```bash
pnpm dev -- --replay tani.json                    # tek terminal: tekrar oynatan sahte kamera + sunucu
# ya da iki terminal:
pnpm dev:fake-camera -- --replay tani.json        # 1. terminal
pnpm dev:server                                   # 2. terminal
```

Birden fazla kaynak varsa: `--replay-source <id>`. Dosya konumsuz alındıysa koordinatlar maskelidir; tekrar oynatırken
kayıttaki hız ve yönden Kızılay'dan başlayan temsili bir rota üretilir (zamanlama, hız, yön, uydu, HDOP, rakım ve ivme
kayıttaki gibi kalır). Gerçek konuma bağlı sorunlarda (yanlış yer, sıçrama) yayıncıdan **Konumu dahil et** ile
indirmesini iste.

## 5. npm paketini yayınlamadan denemek

```bash
cd overlays-server
pnpm build
npm pack                                   # overlays-server-0.1.0.tgz
cd ..
mkdir npm-test && cd npm-test
npm init -y
npm install ../overlays-server/overlays-server-0.1.0.tgz
npx overlays-server --simulate             # http://127.0.0.1:3456
```

## 6. Gerçek kamerayla

Bilgisayar kameranın Wi-Fi'ına bağlıyken:

```bash
pnpm dev:camera                            # varsayılan ayarlar, 193.168.0.1:6100
node src/cli.ts --probe 193.168.0.1        # cihaz raporu
```
