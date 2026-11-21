# Windows: kamera Wi-Fi'ı + internet aynı anda

Kamera kendi Wi-Fi ağını yayar ve başka bir ağa bağlanamaz. Bu yüzden bilgisayar **iki ağa birden** bağlı olmalı:

| Arayüz | Bağlı olduğu yer | Görevi |
| --- | --- | --- |
| Ethernet (ya da 2. Wi-Fi adaptörü) | Modem / Superbox | İnternet, yayın çıkışı |
| Wi-Fi | `DDPAI_...` kamera ağı | RTSP görüntü (OBS) ve GPS (overlays-server) |

Kameranın ağında internet yoktur. Windows bazen interneti oradan çıkarmaya çalışır ve bağlantı kopar. Çözüm, arayüz
önceliğini (metric) elle ayarlamak: küçük sayı öncelikli demek.

## Mevcut durumu gör

PowerShell:

```powershell
Get-NetIPInterface -AddressFamily IPv4 | Sort-Object InterfaceMetric | Format-Table InterfaceAlias, InterfaceMetric, ConnectionState
Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Format-Table InterfaceAlias, NextHop, RouteMetric
Find-NetRoute -RemoteIPAddress 193.168.0.1 | Select-Object -First 1 InterfaceAlias
```

Son komut `Wi-Fi` (kameraya bağlı arayüz) demeli.

## Önceliği ayarla

PowerShell'i **yönetici olarak** aç (arayüz adlarını yukarıdaki listeden al):

```powershell
Set-NetIPInterface -InterfaceAlias "Ethernet" -InterfaceMetric 10   # internet
Set-NetIPInterface -InterfaceAlias "Wi-Fi"    -InterfaceMetric 50   # kamera
```

Menüden yapmak istersen: *Denetim Masası → Ağ ve Paylaşım Merkezi → Bağdaştırıcı ayarlarını değiştirin* → adaptöre
sağ tık → *Özellikler* → *İnternet Protokolü Sürüm 4* → *Gelişmiş* → *Otomatik ölçüm* işaretini kaldır →
*Arabirim ölçüsü*: Ethernet `10`, Wi-Fi `50`.

## Kontrol

```powershell
Test-NetConnection 193.168.0.1 -Port 6100   # TcpTestSucceeded : True
Test-NetConnection 1.1.1.1                  # internet hâlâ çalışıyor
```

Ardından overlays-server'ın durum sayfasında (http://127.0.0.1:3456) kaynak `online` görünmeli.

## Neden 193.168.0.1?

DDPAI, kameraya `193.168.0.1` adresini veriyor. Bu **özel (private) değil, genel (public)** bir IP bloğu. Normal bir
router bu adresi internete yollamaya çalışır; o yüzden kamerayı başka bir router'ın arkasına koymak işe yaramaz.
Bilgisayarın bu adrese giden trafiği kameranın Wi-Fi'ından göndermesi gerekir. Windows bunu kendiliğinden yapar,
çünkü Wi-Fi bu adresle aynı alt ağda. Metric ayarı da varsayılan (internet) trafiğinin Ethernet'te kalmasını sağlar.

---

**English summary:** the camera only works as an access point, so the PC joins the camera Wi-Fi while internet stays
on Ethernet. Give Ethernet a lower interface metric (10) than the camera Wi-Fi (50) so default traffic never tries
the camera network; `Find-NetRoute -RemoteIPAddress 193.168.0.1` should name the Wi-Fi adapter.
