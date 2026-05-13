# Replit -> GitHub -> IONOS deploy rehberi

> **Hedef:** Agent de Bureau'yu IONOS'ta satin aldigin VPS'te (orn. Server L XL)
> kendi domain'inle (`https://app.agentdebureau.fr`) musterilere actigin
> production sunucusu olarak calistirmak.
>
> **Sure:** ilk kurulum 30-45 dakika + DNS yayilimi (5 dakika - 1 saat).
>
> **Mimari:**
> ```
>   Replit (gelistirme) ─push─► GitHub (Bureau-Agent) ─git pull─► IONOS VPS
>                                  development                     production branch
>                                  production                      Docker Compose
>                                                                  Caddy + HTTPS
>                                                                  Postgres + API + Web
>   musteriler ────────────────► https://app.agentdebureau.fr
> ```
>
> Bu rehber `MIGRATION.md`'nin IONOS'a ozellesmis halidir + GitHub branch
> stratejisi + gunluk update akisi entegre.

---

## A. AŞAMA — Replit'ten GitHub'a (5 dakika)

> GitHub repo zaten olusturulmus: `skocyigit-crypto/Bureau-Agent`.

### A.1 — Replit'i GitHub repo'na bagla

1. Replit -> sol kenar **Tools** -> **Git** panelini ac
2. **Connect to GitHub** -> hesabini secip yetki ver
3. Repo listesinden **`skocyigit-crypto/Bureau-Agent`** sec -> **Connect**
4. Replit otomatik olarak `main` branch'ine push eder (5-10 saniye)

`https://github.com/skocyigit-crypto/Bureau-Agent` ac -> tum dosyalar gorunmeli.

### A.2 — `development` ve `production` branch'lerini olustur

Replit **Shell** sekmesinde:

```bash
git branch -m main development
git push -u origin development

git checkout -b production
git push -u origin production

git checkout development
```

> "Permission denied" hatasi alirsan: GitHub Personal Access Token gerekli.
> github.com -> Settings -> Developer settings -> Personal access tokens
> -> Generate new token (classic) -> repo + workflow yetkisi ver -> kopyala
> -> Replit'te `git remote set-url origin https://<token>@github.com/skocyigit-crypto/Bureau-Agent.git`

GitHub repo **Settings -> General -> Default branch** -> `development` sec.

### A.3 — Production branch protection (kazara bozmayi engelle)

GitHub repo **Settings -> Branches -> Add branch protection rule**:
- Branch name pattern: `production`
- Isaretle: "Require a pull request before merging"
- Save

Boylece `production`'a sadece PR uzerinden merge edilebilir.

---

## B. AŞAMA — IONOS sunucusunu hazirla (10 dakika)

### B.1 — SSH ile baglan

IONOS panelinden sunucu **IPv4 adresini** ve **root sifresini** al:

```bash
ssh root@<sunucu-ip>
```

Ilk girisle birlikte sifreni degistirmen istenir, yeni sifre belirle.

### B.2 — Sistem guncelleme + temel paketler

```bash
apt update && apt upgrade -y
apt install -y curl git ufw fail2ban htop nano
```

### B.3 — Firewall ac (yalnizca SSH + HTTP + HTTPS)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # SSH
ufw allow 80/tcp        # HTTP (Let's Encrypt challenge)
ufw allow 443/tcp       # HTTPS
ufw --force enable
ufw status
```

### B.4 — Swap olustur (Server L XL'de RAM yetersizse build crash'lemesin)

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -h     # 4 GB swap aktif olmali
```

### B.5 — Docker kur

```bash
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

### B.6 — Non-root deploy kullanicisi (guvenlik — root ile uygulama calistirma)

```bash
adduser deploy           # sifre belirle, digerlerini bos gec
usermod -aG docker,sudo deploy

# SSH key kopyala (kendi makinanizdan):
# ssh-copy-id deploy@<sunucu-ip>

# Bundan sonra `ssh deploy@<sunucu-ip>` ile baglan, root'u kapat:
nano /etc/ssh/sshd_config
# PermitRootLogin no   <- aktif et
# PasswordAuthentication no   <- key-only login (SSH key kopyaladiysan)
systemctl restart sshd
```

> **Onemli:** Yeni terminal'de `ssh deploy@<sunucu-ip>` ile girip
> calistigini dogrula, eski root oturumunu KAPATMA — yoksa kendini disari
> kilitlersin.

---

## C. AŞAMA — Uygulamayi deploy et (15-20 dakika)

Bu adimlar `deploy` kullanicisi ile (sudo gerektigi yerde sudo).

### C.1 — Repo'yu klonla (production branch'i)

```bash
sudo mkdir -p /opt/agent-de-bureau
sudo chown deploy:deploy /opt/agent-de-bureau
cd /opt
git clone -b production https://github.com/skocyigit-crypto/Bureau-Agent.git agent-de-bureau
cd agent-de-bureau
```

### C.2 — `.env` dosyasini olustur ve doldur

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env       # sadece deploy kullanicisi okuyabilsin
nano deploy/.env
```

**Rastgele anahtarlar uretmek icin** (sunucuda calistir, ciktiyi `.env`'e yapistir):

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)"
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-32)"
echo "ADMIN_PASSWORD=$(openssl rand -base64 24)"
echo "DATA_ENCRYPTION_KEY=$(openssl rand -hex 32)"
echo "BACKUP_ENCRYPTION_KEY=$(openssl rand -hex 32)"
```

`.env`'de doldurulmasi gereken alanlar:

| Alan | Deger |
|---|---|
| `POSTGRES_PASSWORD` | Yukaridaki openssl ciktisi |
| `SESSION_SECRET` | Yukaridaki openssl ciktisi |
| `JWT_SECRET` | Yukaridaki openssl ciktisi (SESSION'dan FARKLI) |
| `DATA_ENCRYPTION_KEY` | Yukaridaki openssl ciktisi |
| `BACKUP_ENCRYPTION_KEY` | Yukaridaki openssl ciktisi |
| `ADMIN_EMAIL` | Senin email'in (orn. `serkan@agentdebureau.fr`) |
| `ADMIN_PASSWORD` | Yukaridaki openssl ciktisi (SAKLA — bir daha gorunmez) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |
| `RESEND_API_KEY` | Replit Secrets'tan kopyala |
| `TWILIO_ACCOUNT_SID` | Replit Secrets'tan |
| `TWILIO_AUTH_TOKEN` | Replit Secrets'tan |
| `TWILIO_PHONE_NUMBER` | Replit Secrets'tan |
| `GOOGLE_CLIENT_ID` | Replit Secrets'tan |
| `GOOGLE_CLIENT_SECRET` | Replit Secrets'tan |
| `GOOGLE_REDIRECT_URI` | `https://app.agentdebureau.fr/api/auth/google/callback` |
| `DOMAIN` | `app.agentdebureau.fr` (Caddy Let's Encrypt icin sart) |
| `PUBLIC_URL` | `https://app.agentdebureau.fr` |
| `ALLOWED_ORIGINS` | `https://app.agentdebureau.fr` |
| `STRIPE_SECRET_KEY` | (varsa) sk_live_... |
| `STRIPE_WEBHOOK_SECRET` | (varsa) whsec_... |
| `STRIPE_PRICE_*` | (varsa) Stripe dashboard'dan price ID'leri |

> **NOT:** `ADMIN_PASSWORD`'u SAKLA (1Password / Bitwarden / KeePass).
> Ilk acilista bu sifreyle giris yapilir, sonra panelden degistirilir.

### C.3 — Domain DNS'ini IONOS sunucuya yonlendir

IONOS panelinde **Domain** -> domain'i sec -> **DNS**:

| Tip | Hostname | Deger | TTL |
|---|---|---|---|
| A | `app` | `<sunucu-ip>` | 3600 |

(Veya kok domain icin: hostname `@`)

DNS yayilimi 5 dakika - 1 saat. Test:
```bash
dig +short app.agentdebureau.fr    # sunucu-ip donmeli
```

### C.4 — Konteynerleri ayaga kaldir

```bash
cd /opt/agent-de-bureau
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Ilk build **5-10 dakika** surer (Docker imajlari derlenir, `npm install` calisir).

Loglari izle:
```bash
docker compose -f deploy/docker-compose.yml logs -f api
```

Beklenen mesajlar:
- `Server listening on :8080`
- `[CORS] Origines autorisees [...]`

`Ctrl+C` ile log takibinden cik (konteyner devam eder).

### C.5 — Veritabani semasini yukle

```bash
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api \
  npx --package drizzle-kit drizzle-kit push --config=lib/db/drizzle.config.ts
```

Ilk acilista `ADMIN_EMAIL` / `ADMIN_PASSWORD` ile super-admin otomatik olusur.

### C.6 — Tarayicidan test

`https://app.agentdebureau.fr` ac. **Ilk acilista** Caddy Let's Encrypt
sertifikasi alir (~30 saniye). Sayfa yuklenince `ADMIN_EMAIL` / `ADMIN_PASSWORD`
ile giris yap.

### C.7 — Google OAuth callback URL guncelle

https://console.cloud.google.com/apis/credentials -> OAuth Client'ini ac:
- **Authorized redirect URIs** -> "+ Add URI":
  `https://app.agentdebureau.fr/api/auth/google/callback`
- Save

(Replit zamanindaki eski URI'yi silebilirsin.)

### C.8 — Stripe webhook URL guncelle (varsa)

https://dashboard.stripe.com/webhooks -> mevcut webhook'u sil, yenisini olustur:
- Endpoint URL: `https://app.agentdebureau.fr/api/stripe/webhook`
- Events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*`
- Yeni `whsec_...` signing secret'i kopyala -> `.env`'de
  `STRIPE_WEBHOOK_SECRET` degerini guncelle -> `docker compose restart api`

---

## D. AŞAMA — Otomatik yedek + monitoring

### D.1 — Gunluk DB yedek (cron)

```bash
sudo mkdir -p /var/backups/agent-de-bureau
sudo chown deploy:deploy /var/backups/agent-de-bureau
crontab -e
```

Sona ekle (her gece 03:00'da yedek alir, 14 gunden eskiyi siler):

```cron
0 3 * * * cd /opt/agent-de-bureau && docker compose -f deploy/docker-compose.yml exec -T db pg_dump -U agent agent_de_bureau | gzip > /var/backups/agent-de-bureau/adb-$(date +\%F).sql.gz && find /var/backups/agent-de-bureau -name 'adb-*.sql.gz' -mtime +14 -delete
```

### D.2 — IONOS Snapshot (haftalik tam disk yedegi)

IONOS panel -> Server -> **Snapshots** -> "Create snapshot". Haftada bir manuel
veya IONOS otomatik snapshot abonelik aksesuarini ac.

### D.3 — Uptime monitoring (dis dunyadan kontrol)

https://uptimerobot.com (ucretsiz) -> "+ Add New Monitor":
- Type: HTTP(s)
- URL: `https://app.agentdebureau.fr/api/healthz`
- Interval: 5 dakika
- Alerts: email'ine

Sunucu 5 dakika kapali kalirsa email gelir.

### D.4 — Disk doldu uyarisi

```bash
sudo apt install -y monit
sudo nano /etc/monit/monitrc
# disk usage > 80% -> alert
```

(Detay icin `man monit`.)

---

## E. AŞAMA — Gunluk update akisi

Replit'te kod degisikligi yaptiginda:

### E.1 — Replit'te commit + push

Replit Shell'de:
```bash
git add -A
git commit -m "yeni ozellik X"
git push origin development
```

### E.2 — Test ettiyse production'a merge

GitHub.com -> repo -> **Pull requests** -> **New pull request**:
- base: `production`, compare: `development`
- "Create pull request" -> "Squash and merge"

(Veya Shell'den hizli yol — branch protection kapaliysa:)
```bash
git checkout production
git merge development
git push origin production
git checkout development
```

### E.3 — IONOS sunucuda guncelle

```bash
ssh deploy@<sunucu-ip>
cd /opt/agent-de-bureau
git pull origin production
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml logs -f api    # 'Server listening' bekle
```

### E.4 — (Bonus) Otomatik deploy script

`/home/deploy/update.sh` olarak kaydet:
```bash
#!/bin/bash
set -e
cd /opt/agent-de-bureau
git fetch origin production
LOCAL=$(git rev-parse production 2>/dev/null || echo "")
REMOTE=$(git rev-parse origin/production)
if [ "$LOCAL" = "$REMOTE" ]; then echo "Guncel"; exit 0; fi
git checkout production
git pull origin production
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml exec -T api \
  npx --package drizzle-kit drizzle-kit push --config=lib/db/drizzle.config.ts
echo "Deploy tamam: $(git log -1 --oneline production)"
```

```bash
chmod +x /home/deploy/update.sh
# Cron: her 5 dakikada yeni commit varsa otomatik deploy
crontab -e
# */5 * * * * /home/deploy/update.sh >> /var/log/auto-deploy.log 2>&1
```

(Cron'u acik birakmadan once 1-2 hafta manuel guncellemeyle test et — yeni
sema migration'u bozuk gelirse otomatik rollback yok.)

---

## F. Sik karsilasilan tuzaklar

| Belirti | Sebep | Cozum |
|---|---|---|
| `502 Bad Gateway` | api konteyner ayakta degil | `docker compose ps` + `logs api` |
| `api` CrashLoop, "ALLOWED_ORIGINS bos" | `.env`'de eksik | `https://app.agentdebureau.fr` ekle, restart |
| HTTPS sertifikasi alamadi | DNS daha yayilmadi veya port 80 kapali | `dig`, `ufw status`, IONOS firewall paneli |
| Google login "redirect_uri_mismatch" | Console'da eski URI | Adim C.7 |
| Build "out of memory" | Server L XL'de RAM yetmiyor | Adim B.4 swap kontrol; `docker compose build --no-cache api` tek tek build |
| `git pull` "merge conflict" | Sunucuda manuel degisiklik yapildi | `git stash`, `git pull`, `git stash pop` (veya `git reset --hard origin/production`) |
| Stripe webhook 400 | Test/live mode karistirildi veya eski whsec_ | C.8 — yeni webhook ve secret |
| Cron yedek calismiyor | Docker exec TTY ister | Mutlaka `exec -T` (T = no TTY) |

---

## G. Kontrol listesi (canliya gecmeden once)

- [ ] GitHub repo'da `development` + `production` branch'leri var
- [ ] `production` branch protection acik (PR zorunlu)
- [ ] `.env` dosyasi sunucuda `chmod 600`, repo'ya KESINLIKLE commit edilmedi
- [ ] Tum production secret'lar sifre yoneticisinde yedekli
- [ ] SESSION/JWT/DATA/BACKUP key'leri Replit'tekinden FARKLI (rastgele uretildi)
- [ ] `ADMIN_PASSWORD` 1Password/Bitwarden'da
- [ ] DNS A kaydi sunucu IP'sine yonlendi (`dig` ile dogrulandi)
- [ ] UFW firewall acik (sadece 22/80/443)
- [ ] Root login kapali, deploy kullanicisi SSH key ile aktif
- [ ] Swap acik (en az 4 GB)
- [ ] `/api/healthz` 200 donuyor
- [ ] HTTPS calisiyor (Let's Encrypt sertifikasi)
- [ ] Google OAuth giris calisiyor (yeni redirect URI)
- [ ] Stripe webhook (varsa) yeni URL'e yonlendi
- [ ] Gunluk DB yedek cron aktif
- [ ] IONOS snapshot acildi
- [ ] UptimeRobot monitoring aktif
- [ ] Test kullanicisi olusturup tum kritik akislari (login, CRM, fatura,
      AI sohbet, telefon araması) bir kez deneyimledim

---

Ek detay (mimari diyagrami, Stripe abonelik kurulumu, sorun giderme tablosu)
icin `MIGRATION.md`'ye bakabilirsin — bu rehber onun IONOS'a ozellesmis halidir.
