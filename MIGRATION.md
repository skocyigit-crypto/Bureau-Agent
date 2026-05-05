# 🚚 Replit'ten Dışarı Taşıma Rehberi

Bu rehber Agent de Bureau uygulamasını Replit'ten alıp **kendi sunucunuzda** (Hetzner, DigitalOcean, AWS EC2, OVH, kendi makinanız — Docker'ın çalıştığı her yer) çalıştırmanıza yarar.

> **Tahmini süre:** 30–60 dakika (DNS yayılma süresi hariç).

---

## 0. Hazırlık — neye ihtiyacınız var

- **Bir Linux sunucu** (Ubuntu 22.04+ veya Debian 12 önerilir, en az 2 GB RAM)
- Sunucuda **Docker Engine 24+** ve **Docker Compose v2** kurulu
- (İsteğe bağlı ama önerilir) bir alan adı (örn. `app.sirketim.fr`) ve A kaydının sunucu IP'sine yönlendirilmiş olması — HTTPS için
- Bir **Gemini / OpenAI / Anthropic API anahtarı** (en az biri)
- Replit projesindeki **Resend, Twilio, Google OAuth** anahtarlarınızın elinizde olması

Docker yoksa sunucuda kurmak için:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
```

---

## 1. Replit tarafında — veritabanını dışa aktarın

Replit'in **Shell** sekmesinde şunu çalıştırın:

```bash
bash deploy/scripts/export-from-replit.sh
```

Bu komut `agent-de-bureau-YYYYMMDD-HHMMSS.sql.gz` adında sıkıştırılmış bir yedek üretir. Replit dosya gezgininden **bu dosyayı bilgisayarınıza indirin**.

---

## 2. Kaynak kodu yeni sunucuya alın

İki yolu var, ikisi de geçerli:

### A. Git ile (önerilir)
Önce projeyi GitHub/GitLab'a push edin (Replit'te `Git` panelinden), sonra sunucuda:
```bash
git clone <repo-url> agent-de-bureau
cd agent-de-bureau
```

### B. Doğrudan kopya
Replit menüsünden **Download as ZIP** → bilgisayarınıza inen zip'i sunucuya `scp` ile gönderin → açın.

---

## 3. Yapılandırma dosyasını hazırlayın

```bash
cp deploy/.env.example deploy/.env
nano deploy/.env       # veya vim, ne kullanıyorsanız
```

Doldurmanız gereken **kritik** alanlar:

| Alan | Ne yazılacak |
|---|---|
| `POSTGRES_PASSWORD` | Uzun rastgele bir şifre. Üretmek için: `openssl rand -base64 32` |
| `SESSION_SECRET` | `openssl rand -hex 32` çıktısı |
| `JWT_SECRET` | `openssl rand -hex 32` çıktısı (SESSION_SECRET'tan farklı olsun) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | İlk açılışta otomatik oluşturulacak süper-admin |
| `GEMINI_API_KEY` (veya OpenAI/Anthropic) | https://aistudio.google.com/apikey |
| `RESEND_API_KEY` | E-posta için (Replit'ten getirin) |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Replit'ten getirin |
| `GOOGLE_REDIRECT_URI` | `https://<alanadınız>/api/auth/google/callback` |
| `TWILIO_*` | Telefon için (Replit'ten getirin) |
| `DOMAIN` | HTTPS için: `app.sirketim.fr`. Sadece HTTP ile test için: `:80` |
| `PUBLIC_URL` | `https://app.sirketim.fr` (DOMAIN HTTPS ise) |

---

## 4. Konteynerleri ayağa kaldırın

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

İlk `--build` 5–10 dakika sürer (Docker imajları derlenir). Sonraki başlatmalar saniyeler sürer.

Kontrol:
```bash
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f api
```

`api` konteynerinde `Server listening on :8080` mesajını görmelisiniz.

---

## 5. Veritabanını yükleyin

İki seçeneğiniz var:

### A. Replit'ten yedek geri yükleme (mevcut verilerinizle)
Adım 1'de aldığınız `.sql.gz` dosyasını sunucudaki proje klasörüne (örn. `scp ile`) kopyalayın, sonra:
```bash
chmod +x deploy/scripts/restore-on-new-server.sh
./deploy/scripts/restore-on-new-server.sh agent-de-bureau-YYYYMMDD-HHMMSS.sql.gz
```

### B. Boş veritabanı (sıfırdan başlamak isterseniz)
```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  npx --package drizzle-kit drizzle-kit push --config=lib/db/drizzle.config.ts
```
İlk açılışta `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile bir süper-admin otomatik yaratılır.

---

## 6. Açılışı test edin

Tarayıcıda şuna gidin:
- HTTPS kurulduysa: `https://app.sirketim.fr`
- HTTP test ise: `http://<sunucu-ip>`

`ADMIN_EMAIL` / `ADMIN_PASSWORD` ile giriş yapın. Sol kolonda menü, dashboard ve veriler gelmeli.

---

## 7. Google OAuth callback URL'ini güncelleyin

Bu **kritik** ama tek seferlik bir Google Console ayarıdır (kod değişikliği yok):

1. https://console.cloud.google.com/apis/credentials adresine gidin
2. Replit zamanından kalma OAuth Client'ı açın
3. **Authorized redirect URIs** listesine ekleyin:
   - `https://app.sirketim.fr/api/auth/google/callback`
4. Eski Replit URL'ini istiyorsanız listeden silebilirsiniz
5. **Save**

Aynı şekilde Twilio (varsa webhook URL'leri) ve Resend (sender domain'i) ayarlarını yeni alan adınıza güncelleyin.

---

## 8. Günlük yönetim

| İhtiyaç | Komut |
|---|---|
| Logları görmek | `docker compose -f deploy/docker-compose.yml logs -f api` |
| Servisleri yeniden başlatmak | `docker compose -f deploy/docker-compose.yml restart api` |
| Tamamen durdurmak | `docker compose -f deploy/docker-compose.yml down` |
| Veritabanı yedeği almak | `docker compose -f deploy/docker-compose.yml exec db pg_dump -U agent agent_de_bureau \| gzip > backup-$(date +%F).sql.gz` |
| Yeni sürüm deploy etmek (git pull sonrası) | `docker compose -f deploy/docker-compose.yml up -d --build` |
| Şema güncellemesi | `docker compose -f deploy/docker-compose.yml exec api npx --package drizzle-kit drizzle-kit push --config=lib/db/drizzle.config.ts` |

### Otomatik yedek (cron)
Sunucunun `crontab -e`'sine ekleyin (her gece 3'te yedek alır, 14 günden eskiyi siler):
```
0 3 * * * cd /home/<kullanici>/agent-de-bureau && docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U agent agent_de_bureau | gzip > /var/backups/adb-$(date +\%F).sql.gz && find /var/backups -name 'adb-*.sql.gz' -mtime +14 -delete
```

---

## 9. Mimari (neyin nereye gittiğini bilmek isteyenlere)

```
                ┌─────────────────────────────────────────┐
                │            web (Caddy konteyner)         │
İnternet ─►─────┤  :80/:443                                │
                │                                          │
                │  /api/*  ──reverse-proxy──►  api:8080    │
                │  /*      ──static dosyalar──►  /srv      │
                └────────────┬─────────────────────────────┘
                             │
                             ▼
                ┌─────────────────────────────────────────┐
                │       api (Node 24 konteyner)           │
                │  Express + Drizzle  :8080               │
                │   ├─ Gemini / OpenAI / Anthropic dış API │
                │   ├─ Resend (e-posta)                   │
                │   ├─ Twilio (telefon)                   │
                │   └─ Google OAuth/Gmail/Calendar/Drive  │
                └────────────┬─────────────────────────────┘
                             │
                             ▼
                ┌─────────────────────────────────────────┐
                │       db (Postgres 16 konteyner)         │
                │  veriler: docker named volume (db_data)  │
                └─────────────────────────────────────────┘
```

- **Caddy**: tek başına TLS (Let's Encrypt) sertifikası alır, statik dosyaları sunar, `/api`'yi backend'e yönlendirir. Ek nginx/apache gerekmez.
- **Replit-spesifik şeyler taşınmadı**: `mockup-sandbox` (Replit canvas'ı), `mobile` (Expo geliştirme), `tanitim` (vitrine sitesi). Bunları ayrıca taşımak isterseniz aynı mantıkla yapılabilir.

---

## 10. Sorun giderme

| Belirti | Olası sebep | Çözüm |
|---|---|---|
| `api` konteyner sürekli yeniden başlıyor | DATABASE_URL yanlış veya db hazır değil | `docker compose logs db` — `accepting connections` mesajı bekleyin, sonra `docker compose restart api` |
| Tarayıcı "502 Bad Gateway" | api konteyner ayakta değil | `docker compose ps` ve `docker compose logs api` |
| Google login çalışmıyor | Redirect URI eski Replit adresinde kalmış | Adım 7'yi yapın |
| Şifremi unuttum | Henüz bir password reset akışı yok | `docker compose exec db psql -U agent agent_de_bureau` ile DB'ye girip `users` tablosunda `password_hash` sütununu yeni bir `bcrypt` hash ile güncelleyin (veya yeni `ADMIN_PASSWORD` ile konteyneri yeniden başlatın — mevcut admin'i ezmez, yeni admin yaratır) |
| AI cevap vermiyor | Hiçbir AI key tanımlı değil | `.env`'de `GEMINI_API_KEY` (en kolay/en ucuz) doldurun, `docker compose restart api` |
| HTTPS sertifika alamıyor | DNS sunucuya yönlü değil veya port 80 dışa kapalı | `dig app.sirketim.fr` çıktısını kontrol edin, güvenlik duvarını açın (`ufw allow 80,443/tcp`) |

---

Sorun yaşarsanız `docker compose logs api` çıktısının son 50 satırını paylaşın, çoğu sorun oradan anlaşılır.

---

## Ek: Docker'sız alternatif

Docker kullanmak istemiyorsanız (örneğin paylaşımlı bir sunucuda root erişiminiz yoksa), `deploy/non-docker/` klasöründe **PM2 + nginx + native Postgres** ile aynı kurulumu yapan dosyalar var. Detay için `deploy/non-docker/README.md`'ye bakın. Önerilen yol yine de Docker Compose'tur — taşınabilirlik en yüksek seviyededir.

---

## Replit-spesifik özellikler (sunucuda devre dışı kalır)

Aşağıdaki özellikler Replit platformunun connector altyapısına bağlıdır ve sunucuya taşıdığınızda **otomatik devre dışı** olur (uygulama açılır ama bu özellikler hata verir):

- **Google Workspace Hub** (`/google-workspace` route grubu): Replit Connectors üzerinden Drive/Docs/Sheets/Calendar/Gmail erişimi
- **Replit Mail entegrasyonu**: Gmail API üzerinden mail gönderme

**Çözüm — sunucuda aynı özellikleri kullanmak için:**
1. Google Cloud Console'da bir OAuth client oluşturun, redirect URI'yi `https://app.sirketim.fr/api/google-oauth/callback` olarak ayarlayın
2. `.env`'de `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` doldurun
3. Mail için `RESEND_API_KEY` (Resend) veya `SMTP_*` (kendi sunucunuz) doldurun — `email.ts` graceful fallback yapar

Bu kurulumla Google OAuth (giriş + Drive backup + Calendar sync + Gmail) tamamen çalışır. Yalnızca "Google Workspace Hub" görsel kontrol paneli sayfası (Replit'in connector listesini gösterir) etkisiz kalır.
