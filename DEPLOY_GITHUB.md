# Replit -> GitHub -> Production deploy rehberi

Bu rehber projeyi profesyonel canli ortama tasimak icin **tek seferlik kurulumu**
ve sonraki **gunluk akisi** anlatir.

> Hedef mimari:
>
> ```
>   Replit (gelistirme)             GitHub (kaynak gercek)             Production
>   ------------------------         -----------------------            ----------
>   sen burada calisirsin    --->    development branch       --->     (yok)
>   PR ac, dene                      production branch        --->     Railway / Scaleway
>                                    (otomatik deploy)                 musteriler kullanir
> ```
>
> **Iki branch:** `development` (calisma) ve `production` (stabil). Musteriler
> sadece `production`'in deploy edildigi sunucuyu gorur. Replit'te yaptigin her
> degisiklik once `development`'a, test edip onayladiktan sonra `production`'a
> merge olur.

---

## 1. GitHub repo'yu olustur ve Replit'e bagla

1. https://github.com/new -> repo adi `agent-de-bureau` (private oneririz).
   Hicbir sey ekleme: README/`.gitignore`/license seçme.

2. Replit projesinde sol kenar **Tools -> Git** panelini ac:
   - "Connect to GitHub" -> az once acildigin repo'yu sec.
   - Replit otomatik olarak **`main`** branch'ine push eder. Bu bizim
     `development`'imiz olacak — asagida yeniden adlandiracagiz.

3. Bilgisayarinda (veya Replit Shell'de) repo'yu klonla ve iki branch ayarla:

   ```bash
   git clone git@github.com:<kullanici>/agent-de-bureau.git
   cd agent-de-bureau

   # mevcut "main"i "development" yap
   git branch -m main development
   git push -u origin development
   git push origin --delete main

   # production'i development'tan ayir (ilk anda ayni icerik)
   git checkout -b production
   git push -u origin production
   ```

4. GitHub repo **Settings -> General -> Default branch** -> `development` sec.
   Boylece Replit yeni push'lari otomatik olarak `development`'a yapar.

---

## 2. Branch protection — production'i kazara bozmaktan koru

GitHub repo **Settings -> Branches -> Add branch protection rule**:

- **Branch name pattern:** `production`
- Isaretle:
  - **Require a pull request before merging** (dogrudan push'u engelle)
  - **Require status checks to pass before merging** -> sec: `Typecheck & Build`,
    `Docker image build (api)` (CI workflow'u 1 kez calistiktan sonra listede gorunur)
  - **Require branches to be up to date before merging**
  - **Do not allow bypassing the above settings**

Sonuc: `production`'a sadece `development`'tan acilan PR uzerinden ve CI yesil
oldugunda merge edilebilir. Hata canliya sizamaz.

---

## 3. Hassas verileri (secrets) **guvenli** tasi

**ASLA** `.env` dosyasini repo'ya commit etme. `.gitignore` zaten dislamali
ama yine de `git status` ile dogrula. Asagidaki sira en guvenlisidir:

### 3a. Replit'teki secret listesini cikar

Replit panelindeki **Secrets** sekmesinde tum anahtarlarin **adlarini** not al
(degerleri gostermesini iste, kopyala — ekrana yansitma, sadece sifre yoneticine).

Asgari liste (canli icin):
```
DATABASE_URL                (Railway/Scaleway otomatik verecek, atla)
SESSION_SECRET              -> openssl rand -hex 32
JWT_SECRET                  -> openssl rand -hex 32 (SESSION'dan farkli)
ADMIN_EMAIL
ADMIN_PASSWORD              -> openssl rand -base64 24
GEMINI_API_KEY              (veya OPENAI_API_KEY / ANTHROPIC_API_KEY)
RESEND_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REDIRECT_URI         -> https://<canli-domain>/api/auth/google/callback
STRIPE_SECRET_KEY           (live mode'a gecince sk_live_)
STRIPE_WEBHOOK_SECRET       (production webhook icin yeniden uretilecek)
STRIPE_PRICE_STARTER
STRIPE_PRICE_PROFESSIONNEL
STRIPE_PRICE_ENTREPRISE
DATA_ENCRYPTION_KEY         -> openssl rand -hex 32
BACKUP_ENCRYPTION_KEY       -> openssl rand -hex 32
ALLOWED_ORIGINS             -> https://<canli-domain>  (REPLIT_DOMAINS yoksa zorunlu)
PUBLIC_URL                  -> https://<canli-domain>
```

> **Onemli:** Production icin `SESSION_SECRET` / `JWT_SECRET` /
> `DATA_ENCRYPTION_KEY` / `BACKUP_ENCRYPTION_KEY` degerlerini Replit'tekinden
> **FARKLI** olarak yeniden uret. Replit'teki anahtarlar gelistirme icindir;
> sizmasi durumunda canli etkilenmemeli.

### 3b. Sifre yoneticisi

Tum degerleri **1Password / Bitwarden / KeePass** gibi bir sifre yoneticisinde
"Ajant Bureau — production" baslikli secure note olarak sakla. **Slack/email/
git'e ASLA yapistirma.**

### 3c. Platforma yukle

Bir sonraki adimda Railway veya Scaleway dashboard'unda her birini tek tek
"Environment variable" olarak ekleyeceksin (asagi).

---

## 4. Production platformunu sec ve baglat

### Secenek A — Railway (en hizli, kredi kart sart)

1. https://railway.app -> "Login with GitHub" -> repo'na erisim ver.
2. **New Project -> Deploy from GitHub repo** -> `agent-de-bureau` sec.
3. **Settings -> Source -> Branch** -> `production` (sadece bu branch deploy edilir).
4. Railway projedeki `railway.json`'i otomatik bulur ve `deploy/Dockerfile.api`'yi
   kullanarak build eder. Healthcheck `/api/healthz`'tan dogrular.
5. Sol panel -> **+ New -> Database -> PostgreSQL**. Railway otomatik olarak
   `DATABASE_URL` env'ini api servisine bagli sekilde uretir.
6. **Variables** sekmesinde adim 3a'daki tum anahtarlari tek tek ekle.
   `REPLIT_DOMAINS` yok, o yuzden `ALLOWED_ORIGINS=https://<railway-domain>`
   (veya custom domain) MUTLAKA ekle — yoksa boot fail eder.
7. **Settings -> Networking -> Generate domain** veya **Custom domain** ekle
   (CNAME'i Railway'in verdigi adrese yonlendir).
8. Ilk deploy bitince DB sema'sini yukle:
   ```bash
   railway run --service api -- pnpm --filter @workspace/db exec drizzle-kit push
   ```
   (Railway CLI: `npm i -g @railway/cli && railway login && railway link`)
9. **GitHub deploy hook (opsiyonel ama onerilir):**
   Railway -> Project Settings -> **Deploy Triggers -> Webhook** -> URL'i kopyala.
   GitHub repo Settings -> **Secrets and variables -> Actions -> New secret**:
   `RAILWAY_DEPLOY_HOOK = <kopyaladigin-url>`. Boylece `production`'a her merge'de
   `.github/workflows/deploy-production.yml` Railway'i tetikler.

### Secenek B — Scaleway Serverless Containers (Avrupa, GDPR, daha ucuz)

1. https://console.scaleway.com -> **Container Registry** -> namespace olustur
   (orn. `agent-de-bureau`).
2. Yerel bilgisayarda (Docker kurulu olsun):
   ```bash
   # Scaleway registry'ye login
   docker login rg.fr-par.scw.cloud/agent-de-bureau \
     -u nologin -p <scaleway-secret-key>

   # imaji build et + push et
   docker buildx build --platform linux/amd64 \
     -f deploy/Dockerfile.api \
     -t rg.fr-par.scw.cloud/agent-de-bureau/api:latest \
     --push .
   ```
3. Scaleway konsol -> **Serverless -> Containers -> Deploy a container**:
   - Image: `rg.fr-par.scw.cloud/agent-de-bureau/api:latest`
   - Port: `8080`
   - Min/Max instances: 1 / 3 (trafik artarsa otomatik olcekle)
   - Memory: 1024 MB, CPU: 1000 mvCPU
   - **Health check**: HTTP GET `/api/healthz`
4. **Environment variables**: adim 3a'daki tum anahtarlari ekle. Database icin:
   - **Scaleway Managed Database -> PostgreSQL** ekle, baglanti URL'ini al,
     `DATABASE_URL` olarak yapistir.
5. **Custom domain** ekle (Scaleway docs adim adim anlatir, CNAME).
6. **Trigger** sekmesinden bir webhook URL al -> GitHub repo secret:
   `SCALEWAY_DEPLOY_HOOK = <url>`. Boylece deploy-production.yml otomatik
   tetikler.

> **Not:** Scaleway git'ten otomatik build etmez (Railway'in aksine), bu yuzden
> her deploy oncesi `docker buildx ... --push` adimi yapilir. CI workflow'una
> bu adim eklenebilir (gerekirse soyle, ekleyelim).

---

## 5. Replit'teki gunluk gelistirme akisi

Bir kez kurulduktan sonra her gun yapacagin akis:

```
1. Replit'te calis (kod yaz, test et, vs)
2. Replit Git paneli -> Stage all -> Commit -> Push
   -> otomatik olarak "development" branch'ine gider
3. development'a push olunca CI workflow calisir (typecheck + build + docker)
4. CI yesile dustugunde GitHub'da:
     "Compare & pull request" -> base: production, compare: development
     -> Open PR -> Review -> "Squash and merge"
5. production'a merge olur olmaz:
     - CI tekrar calisir (sigorta)
     - deploy-production.yml webhook'u tetikler
     - Railway/Scaleway yeni image'i build edip canliya alir
     - Healthcheck gecerse trafik yeni versiyona doner (zero-downtime)
6. Tarayicidan https://<canli-domain> kontrol et
```

**Acil rollback** (canli birakti):
- Railway: Dashboard -> Deployments -> onceki yesil deploy -> "Redeploy"
- Scaleway: Container -> Revisions -> onceki revision -> "Set as active"

---

## 6. Kontrol listesi (ilk deploy oncesi)

- [ ] GitHub repo private, branch'ler `development` + `production` mevcut
- [ ] `production` branch protection acik, CI status check zorunlu
- [ ] `.env` dosyasi repo'ya **gitmemis** (`git ls-files | grep .env` bos olmali)
- [ ] Tum production secret'lari sifre yoneticisinde
- [ ] Production icin SESSION/JWT/DATA/BACKUP key'leri Replit'tekinden FARKLI
- [ ] Railway/Scaleway Variables sekmesine tum anahtarlar girildi
- [ ] `ALLOWED_ORIGINS` production domain'ini iceriyor
- [ ] PostgreSQL ayri servis olarak baglandi, `DATABASE_URL` set
- [ ] Custom domain DNS'i platforma yonlendi (A veya CNAME)
- [ ] Google OAuth Console'da yeni redirect URI eklendi
- [ ] Stripe webhook'u canli URL'e yonlendi (yeni `whsec_` ile)
- [ ] Twilio webhook'lari (varsa) canli URL'e yonlendi
- [ ] Drizzle `push` ile DB sema'si uygulandi
- [ ] `/api/healthz` 200 donuyor
- [ ] `/` ve `/buro-ajani/` yuklenip giris yapilabiliyor
- [ ] Otomatik DB yedek cron'u kuruldu (Railway: managed; Scaleway: snapshot)

---

## 7. Sik karsilasilan tuzaklar

| Belirti | Sebep | Cozum |
|---|---|---|
| Build OK ama container CrashLoop | `ALLOWED_ORIGINS` boş | Variables'a `https://<domain>` ekle, redeploy |
| `502 Bad Gateway` | `PORT` env yanlis okunmamis | Railway/Scaleway `PORT`'u otomatik atar; Dockerfile'daki `EXPOSE 8080` ile uyumlu olsun (kod `process.env.PORT \|\| 8080`) |
| Google login "redirect_uri_mismatch" | Console'da eski URI | Google Console -> Credentials -> Authorized redirect URIs -> yeni URL ekle |
| Stripe webhook 400 | Webhook secret yanlis veya yanlis route | `STRIPE_WEBHOOK_SECRET` production'da yeniden olusturuldu mu? Test mode <-> live mode karistirma |
| CI kirmizi: "lockfile out of date" | `pnpm install --frozen-lockfile` icin lockfile guncel degil | Yerel `pnpm install` cikistir, lockfile commit et |
| Docker build "no space left" | GitHub Actions cache sismis | Workflow'da `cache-to` `mode=max`'i `mode=min` yap veya reset |

---

## 8. Sonraki adimlar (bonus)

- **Staging ortami:** `staging` branch + ikinci bir Railway/Scaleway servisi.
  Production'dan once burada test edersin (gercek uretim verisi olmadan).
- **Otomatik DB migration on deploy:** Dockerfile CMD'sini kucuk bir
  `entrypoint.sh` ile sar -> `drizzle-kit push` calistir, sonra `node ...`.
- **Sentry/Logtail entegrasyonu:** Hata ve loglari merkezi yere yolla.
- **Uptime monitoring:** UptimeRobot / BetterStack ile `/api/healthz`'i her
  dakika dis dunyadan kontrol et.

Daha detayli self-host (kendi sunucu, Docker Compose) icin: bkz. `MIGRATION.md`.
