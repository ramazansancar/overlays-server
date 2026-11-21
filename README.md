# overlays-server

Yayıncının bilgisayarında çalışan küçük bir **yerel köprü sunucu**. Araç kamerasından (şimdilik **DDPAI**) canlı GPS
verisini alır, [Stream Overlays](https://overlays.ramazansancar.com.tr) harita overlay'ine WebSocket üzerinden
saniyede bir aktarır. Telefon, bulut servisi ya da RealtimeIRL gerekmez: konum kameradan doğrudan, yerel ağdan gelir.

[English below](#english)

```text
DDPAI kamera (Wi-Fi, 193.168.0.1:6100) ──► overlays-server (127.0.0.1:3456) ──► OBS tarayıcı kaynağı (harita)
```

- **Canlı konum, hız, yön, rakım, uydu sayısı, GPS kalitesi** — kameranın kendi GPS'inden, 1 Hz.
- **Cihazdan alınabilen her şey** — ivme (G-sensör), hafıza kartı doluluğu, kamera sayısı, RTSP adresleri, cihaz
  bilgileri, tanınmayan mesajlar ham olarak. Overlay istediğini kullanır: [docs/data.md](docs/data.md).
- **Modüler sürücü yapısı** — yeni kamera / GPS cihazı tek bir modülle eklenir ([docs/drivers.md](docs/drivers.md)).
- **Kendi kendini onarır** — kamera kapanıp açılsa ya da Wi-Fi kopsa yeniden bağlanır.
- **Gizlilik öncelikli** — yalnız `127.0.0.1`'i dinler, yalnız izin verilen siteler veriyi okuyabilir.
- **Tek bağımlılık** (`ws`), Node.js 22.18+.

## Desteklenen cihazlar

| Cihaz | Sürücü | Durum |
| --- | --- | --- |
| DDPAI N5 Pro (firmware v8.0.0.10) | `ddpai` | Sahada test edildi |
| Diğer DDPAI modelleri (TCP 6100 telemetrisi olanlar) | `ddpai` | Büyük olasılıkla çalışır, deneyip [bildir](https://github.com/ramazansancar/overlays-server/issues/new?template=device-report.yml) |
| Simülatör (cihazsız deneme) | `simulator` | — |

Cihaz ayrıntıları ve test edildiği ortamlar: [docs/devices/](docs/devices/README.md).
**Cihazın listede yok mu?** [Yeni cihaz ekleme rehberi](docs/new-device.md): tek komutla (`--probe`) cihazını
incele, raporu issue olarak gönder.

## Kurulum

İki yol var, ikisi de aynı sunucuyu çalıştırır. **Node.js 22.18 veya üstü** gerekli ([nodejs.org](https://nodejs.org)).

### A) npm ile (en kolay)

```bash
npx overlays-server@latest
```

`@latest` her açılışta npm'deki son sürümü kontrol eder (yalnız `npx overlays-server` yazarsan daha önce indirilen
sürüm kullanılabilir). Kalıcı kurmak istersen:

```bash
npm install -g overlays-server
overlays-server
```

**Güncelleme (kalıcı kurulum):**

```bash
overlays-server --version            # kurulu sürüm
npm outdated -g overlays-server      # yeni sürüm var mı? (çıktı boşsa güncelsin)
npm install -g overlays-server@latest
```

Kaldırmak için: `npm uninstall -g overlays-server`.

### B) Git ile (kaynaktan)

```bash
git clone https://github.com/ramazansancar/overlays-server.git
cd overlays-server
npm install --omit=dev      # ya da: pnpm install --prod
npm start
```

Windows'ta klasördeki **`start.cmd`** dosyasına çift tıklamak da yeterli: her açılışta önce `git pull` ile kendini
günceller, gerekirse bağımlılıkları kurar, sonra sunucuyu başlatır. İnternet yoksa uyarı verip mevcut sürümle açılır;
otomatik güncellemeyi kapatmak için `set OVERLAYS_SERVER_NO_UPDATE=1`.

**Güncelleme (git kurulumu):** `start.cmd` kullanıyorsan bir şey yapmana gerek yok. Elle:

```bash
cd overlays-server
git pull
npm install --omit=dev      # bağımlılıklar değiştiyse günceller
```

Belirli bir sürüme geçmek için: `git fetch --tags && git checkout v0.1.0`. Değişiklikler: [CHANGELOG.md](CHANGELOG.md).

Derleme adımı yok: Node.js 22.18+ TypeScript dosyalarını doğrudan çalıştırır.

### Çalıştığını kontrol et

Tarayıcıda **<http://127.0.0.1:3456>** adresini aç. Durum sayfası kameranın bağlı olup olmadığını ve GPS durumunu
gösterir (koordinatlar varsayılan olarak gizli, yayında gösterilebilir).

## Kullanım

1. **Bilgisayarı kameranın Wi-Fi'ına bağla** (`DDPAI_...` ağı). İnternet Ethernet'ten (ör. Superbox) gelmeye devam
   etmeli. Windows ayarı için: [docs/windows-network.md](docs/windows-network.md).
2. **overlays-server'ı başlat** (yukarıdaki iki yoldan biri). Konsolda `ddpai: link online` ve `ddpai: gps fix` görünür.
3. **[Overlay ayarlarında](https://overlays.ramazansancar.com.tr)** harita overlay'inin *Konum kaynağı* olarak
   **Araç kamerası GPS — overlays-server [yerel]** seçeneğini seç. Altında açılan *Sunucu adresi* (`127.0.0.1`) ve
   *Sunucu portu* (`3456`) varsayılan kurulumda olduğu gibi kalabilir; sunucu başka bir portta ya da başka bir
   cihazda (ör. Raspberry Pi) çalışıyorsa burayı değiştir. Sonra URL'yi OBS tarayıcı kaynağına ekle.

Kamera yoksa sistemi denemek için: `npx overlays-server@latest --simulate` (Ankara'da daire çizen sahte konum).

### Windows açılışında otomatik başlatma

`Win + R` → `shell:startup` → açılan klasöre `start.cmd`'nin (git kurulumu) ya da şu içerikte bir `.cmd` dosyasının
kısayolunu koy:

```bat
@echo off
npx overlays-server@latest
```

## Ayarlar

Varsayılanlar çoğu kurulum için yeterli. Değiştirmek için bir JSON dosyası oluştur
([config.example.json](config.example.json) örneğini kopyala). Sunucu ayar dosyasını şu sırayla arar:

1. `--config <dosya>`
2. `OVERLAYS_SERVER_CONFIG` ortam değişkeni
3. Çalışma klasöründe `overlays-server.config.json`
4. Kullanıcı klasörü: Windows `%APPDATA%\overlays-server\config.json`, Linux/macOS `~/.config/overlays-server/config.json`

| Anahtar | Varsayılan | Açıklama |
| --- | --- | --- |
| `port` | `3456` | Dinlenecek port |
| `host` | `127.0.0.1` | Dinlenecek arayüz. Overlay başka cihazda değilse değiştirme |
| `allowedOrigins` | overlay sitesi + localhost | Veriyi okuyabilecek web siteleri (`https://site`, `http://localhost:*`, `*`) |
| `token` | — | Ayarlanırsa istemciler `?token=...` göndermek zorunda |
| `staleAfterMs` | `5000` | Bu kadar süre GPS gelmezse durum `stale` olur |
| `gpsPriority` | `[]` | Birden fazla GPS kaynağı varsa tercih sırası (ilk sıradaki koparsa sonrakine geçer) |
| `motionMaxHz` | `10` | İstemci başına saniyedeki en fazla ivme mesajı |
| `logLevel` | `info` | `debug`, `info`, `warn`, `error`, `silent` |
| `rememberLastPosition` | `true` | Son konumu diske yaz; GPS yokken (tünel) ya da yeniden başlatmadan sonra onu göster |
| `stateFile` | kullanıcı klasöründe `last-position.json` | Son konumun saklandığı dosya |
| `sources` | `[{ "driver": "ddpai" }]` | Kaynak listesi; her biri `id`, `driver`, `enabled`, `options` |

Sürücü seçenekleri: [docs/devices/ddpai.md](docs/devices/ddpai.md#ayarlar), [docs/drivers.md](docs/drivers.md#simulator).

### Komut satırı

```text
overlays-server [seçenekler]
  -c, --config <dosya>     Ayar dosyası
  -p, --port <port>        Port (varsayılan 3456)
      --host <adres>       Dinlenecek arayüz (varsayılan 127.0.0.1)
      --origin <origin>    Ek izinli site (tekrarlanabilir)
      --token <gizli>      İstemcilerden ?token= iste
      --ddpai-host <ip>    DDPAI kamera adresi (varsayılan 193.168.0.1)
      --simulate           Kaynak yerine simülatörü kullan
      --log-level <seviye> debug | info | warn | error | silent
      --print-config       Geçerli ayarları yazdır ve çık
      --list-drivers       Sürücüleri listele ve çık
      --probe <adres>      Cihazı incele (portlar, model, veri örnekleri), issue için rapor yazdır
      --probe-ports <liste> --probe için portlar, virgülle (ör. 80,554,6100)
  -v, --version / -h, --help
```

Ortam değişkenleri: `OVERLAYS_SERVER_PORT`, `OVERLAYS_SERVER_HOST`, `OVERLAYS_SERVER_LOG_LEVEL`, `OVERLAYS_SERVER_CONFIG`.

## Uç noktalar

| Yol | Açıklama |
| --- | --- |
| `GET /` | Durum sayfası |
| `GET /health` | Sunucu açık mı? (sürüm, kaynakların bağlantı durumu; konum yok, token istemez) |
| `GET /v1/state` | Tüm kaynakların durumu ve son konumu (JSON) |
| `WS /v1/ws` | Canlı akış (ana kanal) |
| `GET /v1/stream` | Canlı akış, Server-Sent Events (yedek) |
| `GET /v1/diagnostics` | Tanı dosyası (son ham cihaz verisi, loglar, ayarlar); durum sayfasındaki butonla indirilir |

Akış parametreleri: `source=<id|auto>`, `motion=1` (ivme), `events=1` (ham cihaz mesajları), `all=1`, `token=...`.
Mesaj biçimi: [docs/protocol.md](docs/protocol.md). **Hangi veriler var?** (konum, hız, yön, rakım, uydu, HDOP, ivme,
hafıza kartı, kamera sayısı, RTSP adresleri, cihaz bilgileri, ham olaylar): [docs/data.md](docs/data.md).

## Sorun giderme

**Önce durum sayfasına bak:** <http://127.0.0.1:3456>. Kaynakların bağlantı ve GPS durumu canlı görünür; konumu
gösterip Google Maps / Yandex / OpenStreetMap'te açabilirsin.

**Hata bildirirken tanı dosyasını ekle:** durum sayfasının altındaki **Tanı verisini indir** butonu tek bir `.json`
dosyası verir: cihazdan gelen son ~2 dakikalık ham veri, son log satırları, ayarlar ve durum. Bu dosyayla sorunu
kendi bilgisayarımızda aynen tekrar oynatıp düzeltebiliyoruz. Wi-Fi şifresi, seri numarası ve MAC adresleri her zaman
gizlenir; konum yalnızca **Konumu dahil et** işaretliyse eklenir (harita/konum sorunlarında gerekli). Komut satırından:
`curl.exe -o tani.json http://127.0.0.1:3456/v1/diagnostics`.

**Durum sayfasında `connecting` / "is this PC connected to the camera Wi-Fi?"** — Bilgisayar kameranın Wi-Fi'ına
bağlı değil ya da Windows `193.168.0.1`'i yanlış arayüze yolluyor. [docs/windows-network.md](docs/windows-network.md).

**`gps: no_fix`** — Kamera bağlı ama uydu kilidi yok. Açık gökyüzünde birkaç dakika bekle.

**Tünel / kapalı otopark (GPS koptu)** — Harita son bilinen konumda kalır, hız 0 görünür; sinyal gelince kaldığı
yerden devam eder. OBS sahnesi ya da bilgisayar bu sırada yeniden başlasa bile son konum korunur: sunucu son konumu
`last-position.json` dosyasında saklar ve yeni bağlanan overlay'e "son bilinen konum" olarak gönderir, overlay de
tarayıcıda son konumu hatırlar. Kapatmak için `"rememberLastPosition": false`.

**Overlay bir uyarı gösteriyor** — Overlay bağlanamazsa sunucunun `/health` ucuna sorup nedenini yazar:

| Overlay'deki mesaj | Ne yapmalı |
| --- | --- |
| *Yerel sunucuya ulaşılamadı* | Sunucu kapalı ya da adres/port yanlış. Durum sayfası açılıyorsa aşağıdaki tarayıcı izni maddesine bak |
| *Yerel sunucu bu siteye izin vermiyor* | Overlay'i açtığın siteyi `allowedOrigins`'e ekle |
| *Yerel sunucu açık ama canlı bağlantıyı reddetti* | Sunucuda `token` ayarlı: overlay ayarlarındaki *Sunucu anahtarı* alanına yaz |
| *Sunucu kameraya bağlanıyor…* / *Kamera uydu arıyor* | Sunucu çalışıyor; sorun kamera tarafında (Wi-Fi, uydu) |

Sunucu da reddettiği her bağlantıyı konsola yazar (`refused an overlay connection: ...`).

**Durum sayfası çalışıyor ama overlay sunucuya ulaşamıyor** — Tarayıcının *Yerel Ağ Erişimi* (Local Network Access)
kısıtı:

- **OBS 33.0+**: localhost erişimine otomatik izin veriyor. OBS 33 **beta** kullandıysan eski bir ret kalıcı
  kaydedilmiş olabilir: OBS'i kapat, `%APPDATA%\obs-studio\plugin_config\obs-browser` klasörünü sil, OBS'i aç.
  Hâlâ olmuyorsa OBS kısayolunun sonuna `--disable-features=LocalNetworkAccessChecks` ekle.
- **Chrome / Edge** (ayar sayfası, "Pencerede aç" modu): adres çubuğunda çıkan izin isteğinde **İzin ver** de.

**`port 3456 is already in use`** — Sunucu zaten açık (ikinci pencere?) ya da port başka programda. `--port` ile değiştir
ve overlay ayarındaki adresi de güncelle.

## Güvenlik ve gizlilik

Canlı konum hassas bir veridir. Sunucu varsayılan olarak:

- yalnız `127.0.0.1`'i dinler (ağdaki başka cihazlar erişemez),
- yalnız `allowedOrigins` listesindeki sitelerin veriyi okumasına izin verir (aksi halde tarayıcında açık herhangi
  bir site konumunu okuyabilirdi),
- DNS rebinding saldırılarına karşı `Host` başlığını kontrol eder,
- kameraya **yalnız okuma** komutları gönderir, hiçbir ayarı değiştirmez,
- kameranın döndürdüğü Wi-Fi şifresini hiçbir yere yazmaz ya da iletmez.

Ayrıntı ve açık bildirme: [SECURITY.md](SECURITY.md). DDPAI kameranın **varsayılan Wi-Fi şifresini değiştir**:
aynı ağa giren herkes kameranın görüntüsüne ve ayarlarına erişebilir.

## Geliştirme

```bash
pnpm install
pnpm dev            # kamerasız geliştirme: sahte DDPAI kamera + sunucu tek terminalde, dosya değişince yeniden başlar
pnpm dev:fake-camera # ya da iki terminal: 1) sahte kamera (bağlantıları loglar)
pnpm dev:server     #                     2) ona bağlanan sunucu
pnpm dev -- --no-fix --speed 90 --drop-every 20   # uydu yok / hız / bağlantı kopma senaryoları
pnpm dev:camera     # gerçek kamerayla (193.168.0.1), izleme modunda
pnpm simulate       # simülatör sürücüsüyle
pnpm check          # tip kontrolü (TypeScript 7) + testler
pnpm build          # dist/ (npm paketi)
```

Yerelde uçtan uca test (sahte kamera + overlay sitesi + OBS): [docs/testing-locally.md](docs/testing-locally.md).
Mimari, kod kuralları ve yeni sürücü ekleme: [CONTRIBUTING.md](CONTRIBUTING.md), [docs/architecture.md](docs/architecture.md).

## Katkıda bulunanlar

Katkılar memnuniyetle karşılanır. Özellikle **farklı kamera modelleriyle test sonuçları** çok değerli.
[CONTRIBUTING.md](CONTRIBUTING.md) dosyasına göz at. Tüm katkıda bulunanlar:
[github.com/ramazansancar/overlays-server/graphs/contributors](https://github.com/ramazansancar/overlays-server/graphs/contributors).

## Lisans

[GNU AGPL-3.0](LICENSE) (veya sonraki sürümleri) © 2026 Ramazan Sancar.

Kısaca: ücretsiz kullanabilir, değiştirebilir, ticari işlerde de kullanabilirsin. Ama değiştirilmiş bir sürümü
**dağıtırsan** (paket, exe, kurulum) **ya da ağ üzerinden başkalarına hizmet olarak sunarsan**, o sürümün kaynak kodunu
da aynı lisansla açmak zorundasın. Durum sayfasındaki kaynak kod linkini kendi kaynağını gösterecek şekilde koru.
Bağlayıcı olan [LICENSE](LICENSE) metnidir.

DDPAI, DDPAI Technology Co., Ltd.'nin markasıdır; bu proje onlarla bağlantılı değildir.

---

## English

**overlays-server** is a small local bridge that runs on the streamer's PC. It reads live GPS from a dashcam
(currently **DDPAI**, over the camera's Wi-Fi) and streams it once per second over WebSocket to the
[Stream Overlays](https://overlays.ramazansancar.com.tr) map overlay. No phone, no cloud relay.

### Install

Requires **Node.js 22.18+**.

```bash
# npm (update: npm install -g overlays-server@latest, or always run @latest)
npx overlays-server@latest

# or from source (no build step: Node runs the TypeScript directly; update: git pull && npm install --omit=dev)
git clone https://github.com/ramazansancar/overlays-server.git
cd overlays-server && npm install --omit=dev && npm start
```

Open **<http://127.0.0.1:3456>** for the status page. Without a camera: `npx overlays-server@latest --simulate`.
Device not supported yet? Run `npx overlays-server@latest --probe <camera-ip>` and open a device report
([guide](docs/new-device.md)).

### Use

1. Connect the PC to the camera's Wi-Fi (keep internet on Ethernet; see [docs/windows-network.md](docs/windows-network.md)).
2. Start overlays-server.
3. In the [overlay settings](https://overlays.ramazansancar.com.tr) choose **Dashcam GPS — overlays-server [local]** as
   the map's location source (server address `127.0.0.1`, port `3456` unless you changed them). If it cannot connect,
   the overlay tells you why (server down / site not allowed / token needed).

Config file, CLI flags and endpoints are listed in the Turkish sections above (tables are language-neutral).
Protocol: [docs/protocol.md](docs/protocol.md). Adding a device: [docs/drivers.md](docs/drivers.md).
Troubleshooting OBS 33 / Chrome *Local Network Access*: see "Sorun giderme" above — clear
`%APPDATA%\obs-studio\plugin_config\obs-browser` if you ran an OBS 33 beta, or allow the prompt in Chrome.

Security: listens on loopback only, origin allowlist, Host header check, read-only towards the camera,
never forwards the Wi-Fi password the camera reports. See [SECURITY.md](SECURITY.md).

Contributions welcome, especially test reports from other camera models: [CONTRIBUTING.md](CONTRIBUTING.md).
License: [GNU AGPL-3.0-or-later](LICENSE). Free to use, modify and use commercially; if you distribute a modified
version or offer it to others over a network, you must publish its source under the same license (keep the status
page's source link pointing to your code). DDPAI is a trademark of its owner; this project is not affiliated with it.
