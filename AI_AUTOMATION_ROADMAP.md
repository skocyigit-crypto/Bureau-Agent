# Tam Yapay Zeka Otomasyonu — Yol Haritası

> Bu dosya, "Ajant Bureau" uygulamasının tam yapay zeka destekli / tam otomasyonlu
> hale gelmesi için yapılan denetimlerin ve kalan işlerin **kalıcı** kaydıdır. Her
> oturumda güncellenir, silinmez — yeni bulgu/tamamlanan iş oldukça buraya eklenir.
>
> Son güncelleme: 2026-09-02 (satış zincirinin 31 Temmuz'dan beri kapalı olduğu bulundu ve
> tenant kapsamında güvenli biçimde geri açıldı; önceki güncelleme 2026-07-14: fatura hatırlatmaları
> gerçek cron'a bağlandı VE AI destekli müşteri desteği e-posta triyajı uçtan uca canlıda
> doğrulandı — kalan tek adım kullanıcının Cloudflare Worker'ı kurması)

## ⚠️ 2026-07-14 — Kritik altyapı incidenti (çözüldü)

"Cep uygulaması ve internet sitesini baştan aşağı kontrol et" talebi sırasında Playwright
ile gerçek tarayıcı testi yapılırken üç ciddi, birbirinden bağımsız sorun bulundu ve
düzeltildi:

1. **Guardian tüm siteyi ~5 dakika kilitledi**: Cloud Run'da web servisi (Caddy) ile api
   servisi arasındaki hop'ta gerçek ziyaretçi IP'si kayboluyor, TÜM web sitesi kullanıcıları
   Guardian'a aynı paylaşılan iç adresten (`169.254.169.126`) geliyormuş gibi görünüyordu.
   Bir trafik patlaması (test trafiğim) bu adresi banladı → siteye kimse giremedi. 6. tekrarda
   KALICI ban'a dönüşecekti. → `middleware/guardian.ts`'e iç IP muafiyeti + kalıcı çözüm
   (madde 3'e bak) ile düzeltildi.
2. **Deploy pipeline'ı tamamen kırılmıştı**: `xlsx` kütüphanesinin tek kaynağı olan
   `cdn.sheetjs.com`, pnpm/Cloud Build gibi otomasyon araçlarının User-Agent'ını
   engellemeye başlamış (403) — her yeni push'ta build başarısız oluyordu. →
   `artifacts/api-server/vendor/xlsx-0.20.3.tgz` olarak repoya gömüldü, dış bağımlılık
   kaldırıldı.
3. **Rate limiter (express-rate-limit) aynı paylaşılan-IP sorununu yaşıyordu**: Bir
   ziyaretçinin normal gezinmesi bile ortak kotayı tüketip TÜM kullanıcıları 429'a
   düşürebiliyordu. → Kalıcı, doğru çözüm: `deploy/Caddyfile.cloudrun` artık gerçek
   ziyaretçi IP'sini (`X-Forwarded-For`'dan, Caddy'nin proxy'ye göndermeden hemen önce)
   ayrı bir `X-Real-Client-IP` header'ına kopyalıyor; yeni `lib/request-ip.ts` bunu
   önceliklendiriyor. Guardian + 15'in üzerinde rate limiter (app.ts ve 7 route dosyası)
   buna bağlandı. **Canlıda debug endpoint'iyle doğrulandı**: web proxy üzerinden gelen
   ham `X-Forwarded-For` tamamen iç/Google adreslerinden oluşuyor (`169.254.169.126,
   2600:1900:...`), ama `X-Real-Client-IP` gerçek ziyaretçi IP'sini doğru taşıyor.

**Neden önemliydi**: Bu üçü de kod incelemesiyle bulunamayacak, sadece gerçek tarayıcı/
trafik testiyle ortaya çıkan, "sessizce herkesi etkileyen" türden sorunlardı — ilk ikisi
olmasaydı site zaten kullanılamaz haldeydi (sırasıyla erişilemez ve deploy edilemez).

## Genel durum özeti

Uygulamanın AI/otomasyon mimarisi **koda göre çok daha tam**, ama **canlı deploy'a göre
eksik** — çünkü Cloud Run'da sadece `GEMINI_API_KEY` tanımlı. Kod, OpenAI/Anthropic/
Twilio/Google OAuth gibi sağlayıcılar için zaten yazılmış ve doğru şekilde "yoksa nazikçe
devre dışı kal" mantığıyla korunuyor — yani sistem çökmüyor, sadece o özellik sessizce
çalışmıyor.

**Şu an canlıda GERÇEKTEN çalışanlar** (Gemini yeterli):
- AI Komutan (ai-commandant) — çoklu-sağlayıcı LLM konseyi, gerçek görev/takvim/e-posta üretiyor
- AI Ajanlar (10 persona: Tom, Lea, Max...) raporlama
- Doküman AI (OCR/çıkarım, 16 belge tipi, gerçek kayıt oluşturuyor)
- Mobil sesli komut (voice-command, voice-site-ops)
- Otomasyon motoru (kural bazlı, 5 dk'da bir çalışıyor) — SMS hariç her şey
- Proaktif motor (10 deterministik dedektör, 10 dk'da bir)
- AI öğrenme (deterministik, ücretsiz)
- Anlık cevap (hesap makinesi, birim, döviz, IBAN)
- Agent Queue / Autonomous Secretary (saatlik cron, onay kuyruğu)
- Günlük özet (artık gerçekten günlük — Resend ile her sabah otomatik e-posta gidiyor)
- Fatura hatırlatmaları (artık gerçekten günlük — her organizasyon için otomatik cron)

**Şu an canlıda ÇALIŞMAYAN / erişilemez olanlar** (eksik yapılandırma yüzünden):
- Autonomous Inbox taraması (Gmail OAuth yok — her org için "bağlı Gmail yok" dönüyor)
- Super Agent'ın e-posta ayağı (aynı Gmail OAuth eksikliği)
- ~~Anthropic/Claude~~ — 2026-08-28'de çözüldü. Vertex'te iki engel ölçülmüştü
  (`claude-sonnet-4-6` hiçbir bölgede yok → 404; erişilebilen tek model
  `claude-opus-4-8`'in kotası sıfır → 429). Vertex kotasını beklemek yerine
  doğrudan Anthropic API anahtarına geçildi. Kod + yapılandırma canlıda;
  anahtarın geçerliliği ilk gerçek Claude çağrısında doğrulanacak (bkz. madde 3)

**2026-07-14'te düzeltilen iki gerçek Twilio BYOK hatası** (müşteri kendi Twilio'sunu
girse bile hiçbir şey çalışmıyordu — artık çalışıyor, bkz. "Tamamlanmış işler"):
- AI Telefon Santrali webhook doğrulaması artık her müşterinin kendi Twilio anahtarını
  kullanıyor (platform geneli tek anahtar yerine).
- Otomasyon motorunun SMS aksiyonu artık her organizasyonun kendi kayıtlı sağlayıcısını
  kullanıyor.

---

## Öncelikli görevler (tam otomasyona ulaşmak için)

### 1. [YÜKSEK] Google OAuth platformu kur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)
- **Neden önemli**: Autonomous Inbox (gelen kutusu tarama + otomatik görev oluşturma) ve
  Super Agent'ın e-posta ayağı tamamen bu olmadan çalışamıyor. Google Workspace
  entegrasyonu (Drive/Calendar) de aynı şekilde etkileniyor.
- **Ne gerekiyor**: Google Cloud Console'da bir OAuth istemci ID'si oluşturulmalı
  (console.cloud.google.com/apis/credentials), yetkilendirilmiş redirect URI olarak
  `https://app.agentdebureau.fr/api/google-oauth/callback` eklenmeli, sonra
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` Secret Manager'a
  eklenip Cloud Run'a bağlanmalı.
- **DİKKAT — redirect URI API adresi OLMAMALI**: callback başarıdan sonra göreli
  olarak `/parametres`'e yönlendiriyor (`routes/google-oauth.ts:144`, `baseUrl = "/"`).
  API servisi o yolu servis etmediği için, redirect URI olarak API adresi yazılırsa
  kullanıcı bağlantıyı tamamladıktan sonra 404 görür. Web servisi `/api*` isteklerini
  zaten API'ye proxy'liyor (`deploy/Caddyfile.cloudrun:33`), dolayısıyla WEB adresi
  hem callback'i çalıştırır hem de sonrasında uygulamaya geri döndürür.
- **Dosyalar**: `lib/google-auth.ts:160-192`, `routes/autonomous-inbox.ts:308`,
  `routes/ai-agents.ts:2895`
- **Durum**: Bekliyor — kullanıcı kararı gerekiyor (Google Cloud Console'da proje sahibi
  olarak kendisinin oluşturması lazım, ben oluşturamam).

### 2. [TAMAMLANDI] Twilio BYOK (her müşteri kendi hesabını girer) (2026-07-14)

- **Sorun**: Hem `twilio-voice.ts` (webhook imza doğrulama) hem de
  `automation-engine.ts` (SMS aksiyonu) sadece platformun kendi (var olmayan)
  `TWILIO_*` ortam değişkenlerine bakıyordu — bir müşteri kendi Twilio hesabını
  uygulama içinden (Telefon Sistemi → Fournisseurler) girse bile hiçbir şey
  çalışmıyordu.
- **Yapıldı**: İkisi de artık "To" numarasına göre doğru müşteriyi bulup ONUN kayıtlı
  Twilio (veya diğer sağlayıcı) kimlik bilgisini kullanıyor. Platform kendi Twilio
  hesabını bağlamak ISTERSE hâlâ yedek olarak devreye girer, ama artık şart değil.
- **Dosyalar**: `routes/twilio-voice.ts`, `services/automation-engine.ts`
- **Kalan**: Platform kendi Twilio hesabını da bağlamak isterse (opsiyonel — sadece
  hiç müşteri kendi hesabını girmediğinde devreye girecek bir yedek), hesap+numara
  satın alması gerekir. Zorunlu değil.

### 3. [ORTA] OpenAI / Anthropic platform-seviyesi yedek anahtarı ekle

- **Neden önemli**: Şu an "hedged council" (Gemini/OpenAI/Anthropic yarışı) sadece
  Gemini ile çalışıyor — tek nokta bağımlılığı. Gemini kota/kesinti yaşarsa hiçbir
  yedek yok.
- **Anthropic/Claude — KOD HAZIR (2026-07-14)**: `lib/integrations-anthropic-ai/src/client.ts`
  Vertex AI üzerinden Claude'a bağlanabiliyor (ayrı Anthropic hesabı/API key gerekmez,
  mevcut GCP faturasına eklenir). Cloud Run servis hesabına `roles/aiplatform.user`
  izni verildi.
  ~~Model isim çevirisi (`claude-sonnet-4-6` → `claude-sonnet-4.6`) otomatik.~~
  **Bu not yanlıştı**: Vertex, doğrudan API ile AYNI tireli formatı kullanıyor,
  hiçbir nokta-çevirisi yok ve kodda da yok. Kalan gerçek çeviri, emekli modelleri
  ve `-latest` takma adlarını canlı bir ID'ye eşlemek (`resolveClaudeModelId`).
- **OpenAI — TAMAMLANDI (2026-07-14)**: Bağlandı, Secret Manager üzerinden, `/api/ai/status`
  ile doğrulandı (`available: true`).
- **Anthropic/Claude — 2026-08-28'de ölçülen gerçek durum** (canlı Cloud Run
  `agent-de-bureau-api` yapılandırması + doğrudan Vertex `rawPredict` denemeleri):
  - Canlı serviste `ANTHROPIC_API_KEY` yok; yalnızca
    `ANTHROPIC_VERTEX_PROJECT_ID=gwmme-1771577941260` ve `ANTHROPIC_VERTEX_REGION=us-east5`
    tanımlı → Claude tamamen Vertex yoluna bağımlı.
  - `claude-sonnet-4-6` (uygulamanın çağırdığı varsayılan model) us-east5,
    us-central1, europe-west1 ve europe-west4'te **404** — "not found or your project
    does not have access". `claude-haiku-4-5` de aynı şekilde 404.
  - Yalnızca `claude-opus-4-8` erişilebilir, ama **429 — kota sıfır**
    (`online_prediction_input_tokens_per_minute_per_base_model`,
    base model `anthropic-claude-opus-4-8`).
  - Yani kota talebi Opus 4.8 için verilse bile, uygulama Sonnet 4.6 istediği sürece
    404 almaya devam ederdi. Deploy betiği artık Vertex modunda `ANTHROPIC_MODEL`
    varsayılanını `claude-opus-4-8` yapıyor.
- **Uygulanan çözüm (2026-08-28)**: Vertex kotasını beklemek yerine doğrudan API
  yoluna geçildi. Projede zaten duran `batiflow-anthropic-api-key` sırrı,
  değeri kopyalanmadan doğrudan `ANTHROPIC_API_KEY` adıyla Cloud Run'a bağlandı
  (servis hesabına o sır için `roles/secretmanager.secretAccessor` verildi).
  Canlı yapılandırma:
  - `ANTHROPIC_API_KEY` → `batiflow-anthropic-api-key:latest`
  - `ANTHROPIC_MODEL=claude-sonnet-4-6`, `ANTHROPIC_FAST_MODEL=claude-haiku-4-5`
  - `ANTHROPIC_VERTEX_*` korundu; doğrudan anahtar varken `getAnthropicMode()`
    onu yok sayar, anahtar kaldırılırsa Vertex yeniden devreye girer.
  - **Dikkat**: anahtar batiflow ile PAYLAŞILIYOR (batiflow-api de aynı sırrı
    `ANTHROPIC_API_KEY` olarak bağlıyor). Batiflow tarafında iptal/rotasyon
    yapılırsa agent-de-bureau da durur. Ayrıştırmak için yeni bir Anthropic
    anahtarı üretip `anthropic-api-key` adında ayrı bir sır oluşturmak ve Cloud
    Run bağını ona çevirmek yeterli (tek komut).
- **KALAN TEK ENGEL — Anthropic aylık harcama limiti (2026-08-28'de ölçüldü)**:
  Anahtar geçerli (`GET /v1/models` → 200) ve yapılandırılan model kimlikleri
  doğru çözülüyor (`claude-sonnet-4-6` → kendisi, `claude-haiku-4-5` →
  `claude-haiku-4-5-20251001`). Ancak gerçek bir `POST /v1/messages` çağrısı
  429 dönüyor:
  > `enforced_spend_limit_reached` — "your organization has crossed its monthly
  > API usage threshold, set based on your organization's API tier. You will
  > regain access on **2026-09-01 at 00:00 UTC**."

  Yani Claude, kod veya yapılandırma yüzünden değil, **Anthropic hesabının aylık
  harcama tavanı** yüzünden kapalı. İki seçenek: (a) 1 Eylül'ü beklemek — o an
  hiçbir değişiklik gerekmeden çalışır; (b) Anthropic Console → Plans & Billing
  üzerinden limiti/tier'ı yükseltmek. Bu arada Gemini ve OpenAI çalıştığı için
  konsey yanıt vermeye devam eder (bkz. `isQuotaErr` düzeltmesi).
- **Hâlâ açık olan Vertex maddesi (opsiyonel)**: Vertex'i ileride kullanmak
  istenirse Cloud Console → IAM & Admin → Quotas →
  `online_prediction_input_tokens_per_minute_per_base_model`
  (base model `anthropic-claude-opus-4-8`, bölge us-east5) için artırım talebi
  gerekir; ayrıca Sonnet 4.6 / Haiku 4.5 Model Garden'da etkin değil.
- **Dosyalar**: `lib/integrations-anthropic-ai/src/client.ts`, `services/ai-providers.ts:223-329`,
  `deploy/gcp-deploy.sh`, `src/__tests__/claude-model-ids.test.ts`
- **Durum**: OpenAI tamam. Anthropic: kod tarafı tamam; Vertex kotası / doğrudan
  anahtar kullanıcının kararını bekliyor.

### 4. [ORTA] Super Agent durumunu kalıcı hale getir

- **Sorun**: `ai-agents.ts:2819` — `superAgentStates = new Map()` bellekte tutuluyor,
  her redeploy/restart'ta kayboluyor. Ayrıca sadece manuel tetiklemeyle çalışıyor
  (`POST /ai/super-agent/run`), zamanlanmış bir cron yok.
- **Yapılacak**: Durumu bir DB tablosuna taşı, `autonomous-secretary-cron.ts` gibi
  zamanlanmış bir cron ekle.
- **Durum**: Ertelendi — bu ~37 kullanım noktasını dokunan riskli bir refactor, ve
  zaten Gmail'e bağlı olan e-posta ayağı Google OAuth (madde 1) olmadan çalışmıyor.
  OAuth kurulduktan sonra tekrar değerlendirilecek.

### 5. [TAMAMLANDI] Günlük özeti gerçekten "günlük" yap (2026-07-14)

- **Sorun**: `daily-digest.ts` sadece ekran açılınca (pull) çalışıyordu, proaktif
  push/e-posta/zamanlama yoktu.
- **Yapıldı**: `buildDailyDigest()` fonksiyonu route'tan ayrıştırılıp yeniden kullanılabilir
  hale getirildi. Yeni `services/daily-digest-cron.ts` her saat kontrol ediyor, her
  kullanıcı için günde bir kez (audit_logs'ta kalıcı guard — bellekte değil, restart'ta
  tekrar göndermiyor) özeti üretip Resend ile e-posta olarak gönderiyor.
- **Dosyalar**: `routes/daily-digest.ts`, `services/daily-digest-cron.ts`, `index.ts`

### 6. [TAMAMLANDI] Telefon sağlayıcı kimlik bilgileri artık şifreli (2026-07-14)

- **Sorun**: `telephony_providers.config` (JSONB) — Twilio/Vonage/Telnyx vb. `authToken`,
  `apiSecret` gibi alanlar veritabanında düz metin olarak saklanıyordu.
- **Yapıldı**: `encryptProviderConfig()`/`decryptProviderConfig()` eklendi
  (`services/telephony-providers.ts`), sadece her sağlayıcının `configFields`
  tanımında `secret: true` işaretli alanları (authToken, apiSecret, apiToken —
  accountSid/fromNumber gibi sır olmayanlar düz kalıyor) `enc:v1:` ile şifreliyor.
  9 dosyada her yazma (POST/PATCH) ve her gerçek kullanım noktasına (Twilio API
  çağrıları, webhook imza doğrulama, SMS/WhatsApp gönderimi) bağlandı.
  Mevcut düz metin kayıtlar `decryptSensitiveData()`'nın geriye dönük toleransı
  sayesinde çalışmaya devam ediyor, bir sonraki güncellemede otomatik şifrelenir
  — ayrı bir migration script'ine gerek kalmadı.
- **Dosyalar**: `services/telephony-providers.ts`, `routes/telephony.ts`,
  `routes/twilio-voice.ts`, `routes/voice-receptionist.ts`, `routes/whatsapp.ts`,
  `routes/whatsapp-inbox.ts`, `services/automation-engine.ts`,
  `services/phone-reputation.ts`, `services/whatsapp-notify.ts`

### 7A. [TAMAMLANDI] Fatura hatırlatmalarını gerçek cron'a bağla (2026-07-14)

- **Sorun**: `POST /license-management/auto-reminders` sadece super_admin/administrateur
  panelindeki "Lancer les rappels" butonuna tıklanınca çalışıyordu — adı "auto" olsa da
  hiçbir cron onu çağırmıyordu, kimse tıklamazsa vadesi geçen faturalara asla otomatik
  hatırlatma gitmiyordu.
- **Yapıldı**: Fonksiyonun gövdesi `routes/license-management.ts` içinde dışa aktarılan
  `runAutoRemindersForOrg(orgId, triggeredByUserId?)` haline getirildi (route artık ince bir
  sarmalayıcı — aynı rol kontrolü ve HTTP sözleşmesi korunuyor). Yeni
  `services/invoice-reminder-cron.ts`, `daily-digest-cron.ts`/`autonomous-secretary-cron.ts`
  ile aynı kalıcı "günde bir kez" deseniyle (bellekte değil, `license_audit_log`'daki
  `auto_reminders_run` satırından türetilen guard) her saat kontrol edip her organizasyon
  için günde bir kez çalışıyor. `index.ts`'e `startInvoiceReminderCron()` eklendi.
- **Doğrulandı**: Cloud Build `592be01d` (commit `bb414fc`) başarıyla deploy edildi,
  canlı Cloud Run loglarında `[InvoiceReminderCron] Rappels de paiement automatiques
  démarrés` görüldü (revizyon `agent-de-bureau-api-00039-5gm`).
- **Dosyalar**: `routes/license-management.ts`, `services/invoice-reminder-cron.ts` (yeni),
  `index.ts`

### 7B. [TAMAMLANDI] Tanıtım sitesi deploy edildi + SEO yapılandırılmış veri (2026-07-14)

- **Sorun**: `tanitim` sitesinin SEO temelleri (robots.txt/sitemap/OG/canonical) zaten
  iyiydi ama site HİÇBİR YERDE deploy edilmemişti — şirket hakkında hiçbir şey web
  aramasıyla bulunamıyordu.
- **Yapıldı**: Yeni üçüncü Cloud Run servisi `agent-de-bureau-tanitim` (CI/CD'ye tam
  entegre, `cloudbuild.yaml`'a yeni build/push/deploy adımları eklendi). `index.html`'e
  `Organization` + `SoftwareApplication` (gerçek fiyatlandırmayla) JSON-LD; `home.tsx`'e
  görünen SSS içeriğinden otomatik türetilen `FAQPage` JSON-LD eklendi (tek doğruluk
  kaynağı `FAQ_ITEMS` — yapılandırılmış veri asla görünen içerikten sapamaz). Ayrıca
  eski/yanlış bir pazarlama iddiası (Google Drive yedekleme) gerçek mimariyle
  uyuşacak şekilde düzeltildi.
- **Kalan (kullanıcı adımı)**: Google Search Console doğrulaması — doğrulama HTML
  dosyasının kullanıcı tarafından Search Console'dan alınıp paylaşılması bekleniyor.
- **Dosyalar**: `deploy/cloudbuild.yaml`, `deploy/Dockerfile.tanitim.cloudrun` (yeni),
  `deploy/Caddyfile.tanitim.cloudrun` (yeni), `artifacts/tanitim/index.html`,
  `artifacts/tanitim/src/pages/home.tsx`

### 7C. [TAMAMLANDI] Tanıtım sitesi tam denetimi: erişilebilirlik, içerik, SEO, performans (2026-07-25)

- **Sorun**: Site canlıydı ama hiç uçtan uca gözden geçirilmemişti. Bulunanlar:
  1. **Tabletlerde menü yoktu**: navigasyon linkleri `lg` altında gizleniyor, hamburger
     yalnızca `sm` altında görünüyordu — 640–1024 px arası hiçbir bölüme erişilemiyordu.
  2. Logo `href="#"` (alt sayfadan ana sayfaya dönmüyordu) ve `#tarifs`/`#faq` gibi tüm
     ankrajlar /cgu, /mentions-legales üzerinde ölü bağlantıydı.
  3. **~170 Fransızca kelime aksansızdı** ("temps reel", "securite", "Jusqu'a 5
     utilisateurs"...) — Fransız pazarına satış yapan bir sitede doğrudan görünen kusur.
  4. Footer "Fait avec passion à Paris" diyordu; merkez Haguenau, altyapı europe-west9.
  5. `maximum-scale=1` mobilde parmakla yakınlaştırmayı engelliyordu (WCAG 1.4.4).
  6. Giriş JS paketi 1285 kB idi: three.js + @react-three/* ekranın altındaki 3D avatar
     için kritik yola gömülmüştü.
- **Yapıldı**: Kırılma noktası (`lg:hidden` + `aria-expanded`/`aria-controls`), tüm
  ankrajlar `/#...` biçimine, aksan düzeltmeleri (bölüm `id`'leri kasten ASCII bırakıldı),
  footer metni gerçek konumla hizalandı, viewport kısıtı kaldırıldı, her sayfaya
  "contenu principal" atlama linki + `<main id="contenu">`, `og:url`/`og:image:alt` +
  mutlak paylaşım görselleri, sitemap'e `/gizlilik` + fr/tr `hreflang`, ve 3D avatar
  görünüm alanına yaklaşınca yüklenen dinamik import'a alındı.
- **Ölçülen kazanç**: giriş paketi **1285 kB → 412 kB (gzip 363 → 127 kB)**.
- **Doğrulandı**: `tsc --noEmit` temiz, 7 test geçiyor, `vite build` başarılı.
- **Dosyalar**: `artifacts/tanitim/index.html`, `public/sitemap.xml`,
  `src/components/layout/{Navbar,Footer}.tsx`, `src/pages/*.tsx`, `src/components/AjanDemo.tsx`

### 8. [TAMAMLANDI — kullanıcı adımı bekliyor] AI destekli müşteri desteği e-posta triyajı (2026-07-14)

- **Neden önemli**: "maximum ne gerekiyorsa yap" talebinin ikinci yarısı — kullanıcı
  demo/destek e-postalarının okunup derlenmesini ve gerekli cevabın AI ile verilmesini
  istedi. Öncesinde bu tamamen manueldi.
- **Yapıldı**: Gmail OAuth onay gecikmesinden kaçınmak için Cloudflare Email Routing +
  bağımlılıksız (npm paketsiz, build gerektirmeyen) bir Cloudflare Email Worker
  (`deploy/cloudflare-email-worker/worker.js`) yazıldı — e-postayı ayrıştırıp (başlıklar,
  multipart/quoted-printable/base64, HTML→metin) yeni `POST /api/support-inbox/incoming`
  endpoint'ine gönderiyor, ayrıca kayıp olmaması için gerçek bir yedek adrese de
  (`BACKUP_FORWARD_TO`) her zaman iletiyor. Endpoint sabit-zamanlı karşılaştırmalı paylaşılan
  secret ile korunuyor (`SUPPORT_INBOX_WEBHOOK_SECRET`, Secret Manager'da oluşturuldu ve
  Cloud Run'a bağlandı), arka planda Gemini ile sınıflandırıp (`demande_demo/support/
  facturation/reclamation/autre/spam`) taslak cevap üretiyor, ve mevcut `agent_proposals`
  insan onay kuyruğuna (super-admin org'a bağlı, contact-request.ts/demo-request.ts'deki
  ayn aynı "platform genişliğinde lead" deseni) `toolName: "send_email"` olarak düşüyor —
  **hiçbir otomatik gönderim yok**, her zaman bir insan onaylar (send_email zaten
  `requiresConfirmation: true`).
- **Canlıda uçtan uca doğrulandı** (üç gerçek test e-postası ile): 202 kabul, arka planda
  AI sınıflandırma, `agent_proposals` tablosuna doğru şekilde düşme — "File d'approbation"
  ekranında görünür.
- **Test sırasında bulunan ve düzeltilen 2 ayrı gerçek hata** (bu özelliğin ötesinde
  platform geneli etkisi var):
  1. `isModelRetiredError()` (ai-utils.ts) Google'ın yeni retirement mesaj formatını
     ("...is no longer available to new users...") tanımıyordu — otomatik model-repli
     güvenlik ağı SESSİZCE devre dışıydı, `gemini-2.5-flash` her çağrıldığında (bu özellik
     dahil TÜM Gemini Flash çağrı noktalarında) düz 404 ile patlıyordu. Regex'e yeni bir
     desen eklendi, doğrulandı (loglar artık repli'nin gerçekten tetiklendiğini gösteriyor).
  2. `DRAFT_MAX_OUTPUT` (support-inbox.ts) 700 token çok düşüktü — JSON çıktısı (özet +
     taslak + yapı) düzenli olarak yarıda kesiliyor, `JSON.parse` başarısız oluyordu.
     1400'e çıkarıldı.
- **Kalan (kullanıcı adımı, ben yapamam — Cloudflare hesabına erişimim yok)**:
  `deploy/cloudflare-email-worker/README.md`'deki 5 adımı takip ederek Worker'ı Cloudflare
  panelinden oluşturmak, `support@agentdebureau.fr`'i ona yönlendirmek, ve
  `SUPPORT_INBOX_WEBHOOK_SECRET` değerini Worker'a girmek gerekiyor.
- **Dosyalar**: `routes/support-inbox.ts`, `services/support-inbox.ts`,
  `middleware/security.ts` (CSRF bypass), `routes/index.ts`, `services/ai-utils.ts`,
  `deploy/cloudflare-email-worker/` (worker.js + README.md)

### 7. [DOĞRULANDI — sorun yok, sertleştirildi] AI/e-posta sağlayıcı BYOK anahtarları (2026-07-26)

- **Şüphe**: `routes/ai-providers.ts` ve `routes/email-providers.ts`, telephony ile
  birebir aynı `config`/`maskAiConfig`/`maskEmailConfig` desenini kullanıyor
  (madde 6'daki düzeltmeden önceki telephony.ts ile aynı yapı). Muhtemelen aynı
  şifreleme eksikliği burada da var — doğrulanmadı, sadece madde 6'yı düzeltirken
  fark edildi.
- **Doğrulama sonucu (2026-07-26)**: Şüphe yersizmiş. Her iki serviste de
  `encryptAiConfig`/`encryptEmailConfig` mevcut ve **her iki yazma yolunda da**
  (POST + PATCH) çağrılıyor; okuma tarafında `aiProvidersTable`/`emailProvidersTable`
  config'ini okuyan TEK yer bu iki dosya ve ikisi de `decryptSensitiveData` uyguluyor
  (bağlantı testi uçları dahil — Twilio BYOK'taki "kaydediliyor ama hiç kullanılmıyor"
  hatasının burada karşılığı yok).
- **Yine de sertleştirildi**: şifrelenecek alan listesi (`SECRET_KEYS`) elle tutuluyordu,
  `configFields`'taki `secret: true` bayrağından bağımsızdı. Bugün ikisi örtüşüyor (her
  yerde tek secret alan `apiKey`), ama ileride ikinci bir gizli alanı olan bir sağlayıcı
  eklenirse (SMTP parolası, webhook imza secret'ı) sessizce düz metin kaydedilirdi.
  Liste artık `configFields`'tan türetiliyor (telephony'deki desenle aynı hale geldi).
- **Test**: `provider-secrets-encrypted.test.ts` (8 test) — her sağlayıcının her
  `secret: true` alanının şifrelendiğini, gizli olmayan alanların okunur kaldığını ve
  şifrelemenin idempotent olduğunu (route'lar mevcut config'i birleştirip yeniden
  şifreliyor; çift şifreleme müşterinin anahtarını kullanılamaz hale getirirdi) kilitliyor.
- **Dosyalar**: `services/ai-providers.ts`, `services/email-providers.ts`

### 9. Cep uygulaması baştan aşağı denetimi (2026-07-25)

`artifacts/mobile` (Expo/React Native, ~44k satır, 101 dosya) tamamen denetlendi.
`tsc --noEmit` temiz, testler geçiyor. İki bulgu bu oturumda düzeltildi, kalanlar
aşağıda açık duruyor.

**Düzeltildi:**

- **[YÜKSEK] Çevrimdışı önbellek kullanıcıya göre ayrılmamıştı ve çıkışta
  silinmiyordu** — `useOfflineCache` sabit anahtarlar kullanıyordu
  (`contacts_list`, `calls_list`, `tasks_list`, `dashboard_*`) ve `logout()` yalnız
  token'ı siliyordu. Ortak cihazda B kullanıcısı, A'nın kişilerini/aramalarını/
  görevlerini şifrelenmemiş AsyncStorage'dan görebiliyordu (çok kiracılı üründe
  kiracılar arası sızıntı). → Yeni `lib/offline-cache.ts`: anahtarlar
  `adb_cache_v1:<userId>:<key>` altında; çıkış, 401 ve soğuk başlangıçta reddedilen
  token yollarının hepsinde tam purge; eski global anahtarlar kancanın montajında
  tek seferlik temizleniyor. 7 yeni test (`lib/__tests__/offline-cache.test.ts`).
- **[YÜKSEK] Biyometrik giriş sorulmadan açılıyor, kapatılamıyordu** —
  `login.tsx` her başarılı manuel girişten sonra sessizce `enableBiometric()`
  çağırıyor, **parolayı** trousseau'ya yazıyordu; `disableBiometric()` hiçbir
  yerden çağrılmıyordu. Ayrıca parola değişince saklanan parola bayatlıyor ve
  kendini onaramıyordu (biyometri açıkken yeniden kaydedilmiyordu). → Açık onay
  diyaloğu; ayarlarda kapatma anahtarı (`Confidentialite et securite` kartında);
  başarılı manuel girişte kimlik bilgilerinin sessizce tazelenmesi
  (`refreshBiometricCredentials`); sunucunun reddettiği biyometrik girişte
  trousseau'nun otomatik temizlenmesi (2FA ile karışmasın diye `LoginOutcome`
  ayrımı); anahtarlar artık `WHEN_UNLOCKED_THIS_DEVICE_ONLY` ile yazılıyor
  (yedeklere ve başka cihaza taşınmaya kapalı).

- **[YÜKSEK] Uzaktan bildirim (push) altyapısı yoktu** — tüm bildirimler in-app
  SSE ile üretilen *yerel* bildirimlerdi, yani sadece JS çalışırken; uygulama
  kapalıyken (iOS'ta arka plana geçtikten saniyeler sonra) hiçbir uyarı
  gitmiyordu. Ayrıca `Notifications.setNotificationHandler` hiç ayarlanmamıştı →
  uygulama önplandayken gelen bildirim hiç gösterilmiyordu. → Uçtan uca kuruldu:
  yeni `push_tokens` tablosu (jeton = cihaz, çakışmada sahip yeniden yazılıyor —
  el değiştiren telefon eski hesabın bildirimlerini almasın diye);
  `POST /api/push/register` + `/unregister` (tenant-scope, rate limit, Expo jeton
  format doğrulaması); `services/push-notifications.ts` webhook motoruyla aynı
  `broadcaster.onEvent` akışına bağlanıp Expo push API'sine relay ediyor (eylemi
  yapan kullanıcıya gönderilmiyor, `DeviceNotRegistered` jetonları otomatik
  siliniyor, hata hiçbir zaman olay yayınını kırmıyor); mobilde
  `lib/push-registration.ts` + `components/PushRegistrar.tsx` (girişte kayıt,
  `AuthContext.logout()` içinde oturum düşmeden ÖNCE kayıt silme);
  `setNotificationHandler` eklendi; push aktifken yerel bildirim planlanmıyor
  (çift bildirim önlendi), push yoksa yerel yol yedek olarak duruyor.
  9 yeni test (`push-notifications-content.test.ts`) — derin bağlantı rotalarının
  mobildeki beyaz listeyle uyumu dahil.
  **Kalan kullanıcı adımları**: (a) `pnpm --filter @workspace/db push` ile
  `push_tokens` tablosunun canlıya alınması; (b) Android için EAS/FCM kimlik
  bilgileri (`google-services.json`), iOS'ta APNs anahtarı EAS tarafından
  yönetiliyor.

- **[ORTA] Store gönderimi ve build API adresi** — `eas.json`'daki
  `REMPLACER_PAR_VOTRE_APPLE_ID_EMAIL` / `REMPLACER_PAR_APP_STORE_CONNECT_APP_ID`
  yer tutucuları `eas submit --profile production`'ı "geçersiz kimlik" hatasıyla
  düşürüyordu. → Yer tutucular kaldırıldı; `eas submit` bu iki değeri ilk
  gönderimde interaktif soruyor ve hatırlıyor (`appleTeamId` zaten gerçek).
  CI'da (TTY yok) otomatikleştirilecekse doldurulması gerektiği
  `IOS_DEPLOY.md` Etape 3'e yazıldı. Ayrıca preview+production build'lerinin
  `EXPO_PUBLIC_API_URL`'i ham `*.run.app` yerine `https://agentdebureau.fr`
  yapıldı — Caddy `/api*`'i gerçek ziyaretçi IP'sini koruyarak
  (`X-Real-Client-IP`, 2026-07-14 incidenti) proxy'liyor ve bu adres
  `MOBILE_APP_ORIGIN` ile aynı, yani CSRF kontrolüyle tutarlı.
  Canlıda doğrulandı: `https://agentdebureau.fr/api/health` → 401 (API'ye
  ulaşıyor), kök → 200.

- **[ORTA] Üç ekran ikiye katlanmıştı** — `app/calls.tsx`, `app/contacts.tsx`,
  `app/tasks.tsx` (~1500 satır), `(tabs)` altındaki muadillerinin eskimiş
  kopyalarıydı ve ikisi de menüden/asistandan erişilebiliyordu. Ayrışmışlardı:
  yalnız sekme sürümleri üretilmiş API istemcisini kullanıyor ve `open=<id>`
  parametresini okuyor — yani "yeni görev" bildirimine dokunup `/tasks`'a
  düşen kullanıcıya görev açılmıyordu. → Üç dosya, parametreleri aktaran
  `Redirect` bileşenlerine indirildi. Rotalar korundu (menü, arama, proaktif
  asistan, komutan IA bağlantıları kırılmasın diye), tek bakılan sürüm sekmeler.
- **[DÜŞÜK] Çökme raporlaması yoktu** — `ErrorBoundary` `onError` destekliyordu
  ama kimse geçmiyordu; kullanıcıdaki beyaz ekran hiçbir iz bırakmıyordu. →
  `POST /api/client-errors` (kimlik istemez — açılıştaki ve giriş ekranındaki
  çökmelerin oturumu yoktur; buna karşılık hiçbir şey veritabanına yazılmıyor,
  yalnızca kırpılmış hâlde Cloud Logging'e düşüyor, IP başına saatte 10 istek)
  + mobilde `lib/crash-report.ts` (oturum başına en fazla 3 rapor, sessiz).
- **[DÜŞÜK] Test kapsamı** — bildirim rota beyaz listesi ve payload normalizasyonu
  `_layout.tsx` içinden `lib/notification-routes.ts`'e çıkarıldı (test edilemez
  bir dosyadaydı, üstelik dış girdiyi doğrulayan bir güvenlik sınırı) ve 8 testle
  kapatıldı. Mobil toplam: 3 dosya / 24 test; sunucu tarafı push: 13 test.

- **[DÜŞÜK] SSE ayrıştırıcı testsizdi** — blok/`event:`/`data:` ayrıştırma mantığı
  ağ okuma döngüsünün içine gömülüydü (`expo/fetch` importu yüzünden test
  edilemiyordu). Oysa buradaki bir regresyon hiçbir hata üretmez: ekran boş
  kalır ya da cevabın ortasında donar — kullanıcı bunu "yapay zekâ cevap
  vermiyor" diye okur. → `lib/sse-parser.ts`'e çıkarıldı (`parseSseBuffer` +
  `decodeSseData`), `sse-stream.ts` onu kullanıyor, 11 test: paket sınırında
  ikiye bölünen olay, proxy'nin araya soktuğu `:` yorum satırı, çoklu `data:`
  satırı, JSON olmayan yük.

**Denetimin tüm bulguları kapatıldı.** Mobil test toplamı: 5 dosya / 39 test
(denetim öncesi 1 dosya / 9 test).

---

## Tamamlanmış işler (referans için)

- ✅ Mobil Origin/CSRF düzeltmeleri (2026-07-13)
- ✅ Backend güvenlik denetimi ve düzeltmeleri (tenant izolasyonu, DoS koruması, bağımlılık
  güncellemeleri) (2026-07-13/14)
- ✅ Cloud Run altyapı sertleştirme (non-root container, güvenlik header'ları) (2026-07-14)
- ✅ Cloud SQL native otomatik yedekleme aktif edildi (2026-07-14)
- ✅ Google Drive otomatik yedekleme kapatıldı (istenmeyen veri akışı) (2026-07-14)
- ✅ E-posta altyapısı (Resend) bağlandı (2026-07-14)
- ✅ Telefon sağlayıcı kimlik bilgileri (Twilio/Vonage/vb.) artık şifreli
  saklanıyor (2026-07-14)
- ✅ Yasal kimlik düzeltmesi (SK GROUP, gerçek SIRET/TVA) (2026-07-14)
- ✅ Custom domain (agentdebureau.fr) Cloudflare'e taşıma — **devam ediyor** (DNS
  yayılması bekleniyor)
- ✅ Google Drive otomatik yedekleme kalıcı olarak kapatıldı, Cloud SQL native yedekleme
  aktif (2026-07-14)
- ✅ Günlük özet artık gerçekten otomatik e-posta gönderiyor (2026-07-14)
- ✅ Vertex AI üzerinden Claude entegrasyonu — kod tamam, Anthropic erişimi onaylandı,
  kota artırımı bekleniyor (2026-07-14)
- ✅ OpenAI bağlandı ve doğrulandı (2026-07-14)
- ✅ Twilio BYOK düzeltildi: webhook doğrulama + otomasyon SMS aksiyonu artık her
  müşterinin kendi sağlayıcısını kullanıyor (2026-07-14)
- ✅ Tanıtım sitesi (`agent-de-bureau-tanitim`) deploy edildi + SEO yapılandırılmış veri
  (Organization/SoftwareApplication/FAQPage JSON-LD) eklendi (2026-07-14)
- ✅ Tanıtım sitesi tam denetimi: tabletlerde menüsüz kalma hatası, ölü ankrajlar,
  ~170 aksansız Fransızca kelime, WCAG zoom kısıtı, SEO/paylaşım meta'ları ve
  giriş paketi 1285 kB → 412 kB (three.js tembel yükleme) (2026-07-25)
- ✅ Fatura hatırlatmaları gerçek günlük cron'a bağlandı, deploy doğrulandı (2026-07-14)
- ✅ AI destekli müşteri desteği e-posta triyajı — Cloudflare Email Worker + AI
  sınıflandırma/taslak + onay kuyruğu, canlıda uçtan uca doğrulandı; ayrıca yol boyunca
  platform geneli bir Gemini model-repli algılama hatası bulunup düzeltildi (2026-07-14)

---

## Notlar

- Bu dosyayı okuyup güncellemek her yeni "otomasyon" görevi öncesi ilk adım olmalı.
- Kullanıcı kararı gerektiren maddeler (1, 2, 3) üçüncü taraf hesap/ödeme gerektirdiği
  için otomatik yapılamaz — sadece kullanıcı onayı + kimlik bilgisi ile ilerlenebilir.
- Kod değişikliği gerektiren maddeler (4, 5) istenirse doğrudan uygulanabilir.

---

## 10. [TAMAMLANDI] Denetim halkasının kapatılması — "insan denetiminde tam otomasyon" (2026-07-25)

**Tespit (5 turluk inceleme):** Otomasyon üretim tarafı olgun (14 cron, 37 araç, kural
tabanlı + AI ajanlar, hepsi `enqueueProposal` üzerinden onay kuyruğuna düşüyor). Eksik olan
üretim değil, **denetim** tarafıydı — insan halkanın içinde ama halka onu hiç çağırmıyordu:

1. **Öneriler sessizdi.** `enqueueProposal` hiçbir olay yaymıyordu: ne SSE, ne push, ne
   e-posta. Kuyruk yalnızca birisi ekranı açarsa görülüyordu; görülmeyen öneri 14 gün sonra
   `expiree` olup sessizce siliniyordu. Yani "altın kural" (onaysız hiçbir gerçek etki yok)
   pratikte "kimse bakmazsa hiçbir şey olmaz"a dönüşüyordu — ajan boşa çalışıyordu.
2. **Denetim ölçeklenmiyordu.** Tek tek onay/ret vardı; bir cron aynı türden on öneri
   ürettiğinde (fatura relansı, geciken görev) her sabah on tıklama gerekiyordu.
3. **Denetimin körlüğü.** "12 bekliyor" sayısı dışında hiçbir gösterge yoktu: en eskisi ne
   kadar bekliyor (kuyruk tıkanıyor mu), ajanın önerileri onaylanıyor mu (%95 ise daha çok
   yetki verilebilir, %20 ise kurallar düzeltilmeli).

**Yapıldı:**

- **Öneri artık insanı uyandırıyor**: `broadcaster`'a `proposition` olay tipi eklendi ve
  `enqueueProposal` başarılı her eklemede yayın yapıyor (doğrudan mükerrerlerde yapmıyor —
  cron'lar aynı sinyali her turda tekrar görüyor, aksi halde aynı relans her saat çalardı).
  Tek nokta, çünkü TÜM üreticiler (otonom sekreter, e-posta triyajı, SaaS ajanı, app-audit,
  otomasyon motoru) bu fonksiyondan geçiyor. Aynı akış zaten push + SSE + giden webhook'ları
  besliyor, yani hiçbir çağıran değiştirilmedi.
- **Mobil push**: `pushContentForEvent` → "Action a approuver", derin bağlantı
  `/file-approbation` (mobil beyaz listeye eklendi). **Yalnızca haute/urgente/critique**
  önceliklerde bildirim — bir cron on öneriyi birden koyabilir, on bildirim uygulamayı
  gürültü kaynağına çevirir ve kullanıcı bildirimleri işletim sistemi düzeyinde kapatır
  (bu kapatma geri dönüşsüzdür).
- **Gürültüsüz olanların emniyet ağı**: günlük özet e-postasına "N action(s) en attente de
  votre validation" bloğu; 3 günden eskiyse yaşı ve 14 günde expire olacağı yazılıyor.
  Sadece sayaç — kuyruk organizasyon ölçekli, özetin geri kalanı kişisel, içerik sızmıyor.
- **Toplu karar**: `POST /agent-queue/bulk-decide` (ids + approve/reject). Kimlikler
  AÇIK — "filtreye göre hepsini onayla" yok, insan ekranda ne onayladığını görmüş olmalı.
  Sıralı çalışıyor (her onay gerçek etki + DB bağlantısı; paralellik üretimde havuzu
  doldurmuştu), lot 25 ile sınırlı, ve toplu kararlar da `bumpProposalPreference` ile
  öğrenmeyi besliyor (aksi halde patron toplu moda geçince ajan öğrenmeyi bırakırdı).
- **Denetim panosu**: `GET /agent-queue/stats` (bekleyen sayısı, öncelik/kategori dağılımı,
  en eski bekleyenin yaşı, 30 günlük onay oranı). Web'de "File d'approbation" başlığının
  altında şerit + kart başına seçim kutusu + seçim yapılınca beliren toplu karar çubuğu.
  Onay oranında `echouee` onaylanmış sayılıyor: insan "evet" demişti, teknik hata oranı
  ayrı bir şey — aksi halde metrik ajanın yargısını değil altyapının sağlığını ölçerdi.
- **Testler**: `proposal-queue-broadcast.test.ts` (3 test — yayın var, mükerrerde yok, yayın
  patlarsa kuyruğa ekleme yine başarılı) + push içerik testine 4 yeni test (öncelik filtresi
  ve derin bağlantının mobil beyaz listeyle uyumu). `tsc --noEmit` api-server ve web'de
  temiz, `vite build` başarılı.
- **Dosyalar**: `services/broadcaster.ts`, `services/proposal-queue.ts`,
  `services/push-notifications.ts`, `routes/agent-queue.ts`, `routes/daily-digest.ts`,
  `services/daily-digest-cron.ts`, `mobile/lib/notification-routes.ts`,
  `buro-ajani/src/pages/file-approbation.tsx`

**Mobil ayak (2026-07-26)**: push artık `/file-approbation`'a derin bağlantı verdiğine göre
badge'in de anında güncellenmesi gerekiyordu — yoksa kullanıcı bildirimle uygulamayı açıyor
ve rozet 60 saniyeye kadar sıfır görünüyordu. Yeni `lib/approvals-signal.ts` (küçük bir
pub/sub): `UnreadBadgesContext` SSE'de `proposition` görünce yayınlıyor,
`usePendingApprovals` dinleyip sunucuyu yeniden okuyor. **Yerel bildirim eklenmedi** —
öncelikli öneriler zaten push ile geliyor, ikisi üst üste binerdi. Mobilde onay/ret sonrası
da sinyal atılıyor (rozet bir dakika boyunca yanlış sayı göstermesin). 4 test
(`lib/__tests__/approvals-signal.test.ts`): abonelik kesiliyor mu, patlayan bir abone
diğerlerini engelliyor mu, yayın sırasında abonelikten çıkma diffüzyonu kırıyor mu.

**Otomasyonun kendisinin denetimi (2026-07-26)**: Bir üst katmanda aynı boşluk vardı.
`health-agents.ts`'teki `schedulerAgent` ölü cron'u zaten doğru tespit ediyor (her battement'ı
beklenen aralığın iki katıyla karşılaştırıyor), ama bu tespit hiçbir yere GİTMİYORDU:
`health_checks` tablosuna bir satır ve bir `logger.warn`. Yani `autonomous-secretary` veya
`invoice-reminder` ölse, büro sessizce otomasyonu bırakıyordu — uygulama normal cevap veriyor,
ekranlar sadece boş. "Otonom" bir üründe en tehlikeli arıza biçimi: hiçbir şey kırılmıyor,
her şey duruyor. Yeni `services/health-alert.ts` her sağlık turundan sonra çalışıyor:
`echec` + haute/critique olan tespitler için super-admin'lere uygulama içi bildirim ve
`ADMIN_EMAIL`'e e-posta (uygulama zaten kullanılamaz durumdayken de ulaşsın diye iki kanal).
Tespit başına günde bir uyarı, guard `audit_logs`'tan türetiliyor (bellekte değil — tur 15
dakikada bir, bellekte guard günde 96 e-posta demekti). `degrade` durumlar bilerek uyarmıyor:
zaten sağlık panosunda görünüyorlar ve çoğu bir sonraki turda kendiliğinden düzeliyor.
7 test (`health-alert-selection.test.ts`) gürültü eşiğini kilitliyor.

**Kalan (bilinçli olarak yapılmadı):** güven eşiğine göre otomatik onay. Altyapı hazır
(öğrenilen tercihler + kategori bazlı onay oranı), ama bu "insan denetiminde" sözünü
gevşetir; ancak kullanıcı açıkça isterse ve kategori bazında açılıp kapanabilir şekilde
yapılmalı.

---

## Super-Admin (SaaS) Tarafı Tam AI Otomasyonu — 2026-07-25

**Talep:** Super-admin tarafının (platform sahibinin tüm organizasyonları yönetmesi:
lisans, abonelik, fatura, prospect) tam AI otomasyonu. Kural: mevcut mimariye uygun —
IA önerir, super-admin onaylar, sonra uygulanır (otonom uygulama YOK).

**Karar (kullanıcı, 2026-07-25):** Kural tabanlı (deterministik eşikler, AI maliyeti yok)
+ fazlı yaklaşım (önce salt-okunur temel, sonra otonom ajan).

**Tespit:** Mevcut AI otomasyon altyapısının TAMAMI org-scoped (her tenant kendi içinde).
`ToolContext={orgId,userId}`, 37 aracın hepsi orgId ile filtreli, `proposal-queue`
organisationId zorunlu kılıyor. Super-admin/SaaS düzeyinde hiçbir AI ajanı/aracı yoktu.
SaaS cron'ları (billing/trial-warning/quota-warning/stripe-sync auto-suspend) sadece
e-posta/bildirim üretiyor, onay kuyruğuna gitmiyor.

### ✅ Faz 1 — TAMAM (commit f6b19f2, canlı)
- `services/saas-attention.ts`: tüm org'ları tek batch sorgularla tarayıp önceliklendirilmiş
  "aksiyon gerektirenler" listesi üretir. Kategoriler: trial_expiring, trial_expired,
  payment_failed, subscription_past_due, quota_breach, overdue_saas_invoice, suspended.
- Saf `classifyOrganisation(input, now)` fonksiyonu (eşik/kategori/severity mantığı),
  13 testle kilitli — Faz 2 ajanı da BU fonksiyonu kullanacak (tek doğruluk kaynağı).
- `GET /admin/saas-attention` (requireSuperAdmin), organisations.tsx SaaS sekmesinde panel.
- Salt-okunur, mutasyon yok.

### ✅ Faz 2 — TAMAM (commit 0edc6e2, canlı; ajan üretimde 2 öneri üretti)
Tasarım: SaaS önerilerini super-admin'in kendi org'u (`agent-de-bureau-sas` slug,
proactive-engine.ts:1042'de tanımlı) altında toplayarak MEVCUT onay kuyruğu altyapısını
yeniden kullan (agent_proposals, agent-queue UI, executeProposal, öğrenme — hepsi hazır).
Yeni gerekenler:
1. SaaS-scoped araçlar (hedef org args'ta): saas_extend_trial, saas_suspend_subscription,
   saas_reactivate_subscription, saas_send_invoice_reminder, saas_advance_prospect.
   GÜVENLİK: bu araçlar cross-org mutasyon yapar (org-izolasyon değişmezini kırar) —
   sadece gerçek super_admin bağlamında ve super-admin org'unun kuyruğunda çalışmalı.
2. Kural tabanlı otonom ajan (cron): classifyOrganisation sinyallerini alıp her biri için
   uygun aracı enqueueProposal ile super-admin org kuyruğuna öneri olarak koyar.
   sourceRef ile dedup (aynı org+kategori için günde bir öneri).
3. Frontend: super-admin'in agent-queue'da bu SaaS önerilerini görüp onaylaması.

---

## Satış→Fatura→E-Fatura zinciri — 2026-07-26

Denetim: prospect/devis/facture bağımsız CRUD'du, tutar aktarımı yok, KDV hesabı
yok, elektronik fatura hiç yok (Factur-X/Chorus/UBL 0 eşleşme). Kullanıcı tam
zincir istedi (A+B+C+D).

### ✅ Faz A — TAMAM (commit 04f84c9, canlı)
services/invoice-totals.ts: saf hesaplama motoru (satır=qte×PU, HT, KDV oranına
göre gruplu, kuruş yuvarlama, autoliquidation BTP→KDV 0). Devis+facture POST/PATCH
artık kalemlerden hesaplıyor, client toplamlarını yok sayıyor. 10 test.
Frontend: LineItemsEditor bileşeni (canlı önizleme) devis+facture formlarında.

### ✅ Faz B — TAMAM (commit 50b5acc, canlı)
POST /devis/:id/convert-to-facture: kalemler+müşteri+tutarlar devis'ten faturaya
kopyalanıyor (echeance 30g), devisId↔convertedToInvoice bağlanıyor. Advisory lock
ile çift-dönüşüm engelli. Frontend'de "Facturer" düğmesi. Tutarlar birebir kopya.

### ✅ Faz C — TAMAM (2026-09-02, commit 900ed995)
`services/invoice-pdf.ts`: yasal A4 fatura PDF'i. Saf `buildInvoiceDocument`
(satıcı kimliği: hukuki form/sermaye/adres/SIRET/TVA, alıcı kimliği, kalemler,
orana göre KDV dökümü, HT/KDV/TTC, ödenen ve kalan tutar, IBAN/BIC, zorunlu
ibareler) ile pdfkit'te çizen `renderInvoicePdf`. Uç: `GET /factures-client/:id/pdf`
(org-kapsamlı), ön yüzde fatura satırında PDF düğmesi. 22 test.

Zorunlu ibareler: gecikme faizi (L441-10 Ticaret Kanunu), 40 € tahsilat tazminatı
(D441-5), erken ödeme iskontosu beyanı, otoliquidation (283-2 nonies CGI) ve
franchise en base (293 B CGI) — uygun olduğunda. Eksik zorunlu veri PDF'i
düşürmüyor: loglanıyor ve `X-Invoice-Warnings` başlığıyla dönüyor.

İki not: (1) yeni bağımlılık GEREKMEDİ, `pdfkit` zaten kuruluydu — yol haritasının
"pdf-lib gerekir" notu eskimişti; (2) render sırasında gerçek bir hata çıktı:
`Intl` binlik ayracı olarak dar bölünmez boşluk (U+202F) kullanıyor, bu karakter
PDF standart fontlarının WinAnsi kodlamasında yok ve pdfkit onu EĞİK ÇİZGİ olarak
çiziyordu — 999'dan büyük her tutar "1 /800,00 €" görünüyordu. Çizilen tüm metin
artık `toWinAnsiText`'ten geçiyor; bir test PDF içerik akışını açıp tutarın sayfaya
bozulmadan ulaştığını kanıtlıyor.

### ⏳ Faz D — BEKLİYOR (Factur-X)
EN 16931 CII XML üretimi + PDF/A-3'e gömme (hibrit). Fransa 2026 e-fatura
zorunluluğu. Chorus Pro/PDP iletimi ayrı sonraki adım.

---

## Satış zinciri sessizce kapalıymış — 2026-09-02

**Bulgu.** Faz A/B'yi (tutar motoru + devis→fatura dönüşümü) canlıda kullanan
hiç kimse yoktu: `b61de530` ("security: restrict super admin data", 31 Temmuz)
`prospectsRouter`, `devisRouter` ve `facturesClientRouter`'ı router'dan tamamen
çıkarmış, yerlerine her kimlikli role `403 tenant_content_forbidden` dönen bir
handler koymuştu. O commit gerçek bir açığı kapatıyordu — bu üç router'ın
varsayılan `organisation_id` filtresi yoktu, yani SaaS kapsamı her müşterinin
pipeline'ını sayabiliyordu — ama düzeltmeyi router'ları tenant kapsamına
taşıyarak değil, tamamen kaldırarak yaptığı için satış zinciri sahiplerine de
kapandı. `/admin/factures-b2b` sayfası o günden beri hata gösteriyordu ve
kimse fark etmemişti.

**Yapıldı (`245348e3`).** Üç router `requireTenant` altına geri bağlandı ve
organizasyon artık pazarlık konusu değil: her listeleme/okuma/güncelleme/silme/
hatırlatma `getOrgId(req)` ile sınırlı, `?organisationId=` ve `body.organisationId`
kaldırıldı, referans tekilliği organizasyon başına kontrol ediliyor, bir fatura
yalnızca kendi organizasyonundaki bir devis'e bağlanabiliyor. Super-admin'in
ayrıcalıklı yolu yok: kendi organizasyonunun satış zincirini görür, SaaS kapsamı
yalnızca toplu metrik döndürmeye devam eder.

`admin-isolation.test.ts` artık gerçek sınırı sürüyor (üç rol × üç kaynak:
org B satırları listede yok, okuma/güncelleme/silmede 404, silme denemesinden
sonra veritabanında hâlâ duruyor, org B isteyen bir create org A'ya düşüyor).
`tenant-boundary-static.test.ts` router'ların `requireTenant`'tan SONRA
bağlandığını ve çağıran-seçimli organizasyonun geri gelmediğini kilitliyor.
Ön yüz route'ları `1cbd4967` ile geri geldi (sayfaların kendi super-admin
kontrolü korundu).

**Kalan karar — ÇÖZÜLDÜ (2026-09-02):** sayfalar sıradan müşteri rollerine açıldı
(`df15ee63`). Org sütunu/filtresi/form alanı üç sayfadan da kaldırıldı (sunucu
zaten oturumdan türetiyor ve `/api/organisations` sadece super-admin'e açık
olduğu için müşteri yöneticisinde boş seçici + "organizasyon seç" doğrulaması
her oluşturmayı bloke ederdi). Yeni yollar: `/prospects`, `/prospects/:id`,
`/devis`, `/factures` — lisans kapısı arkasında, kenar çubuğunda "Ventes" grubu
ile 6 dilde. `/admin/factures-b2b` super-admin route'unda kaldı ve artık
`/factures`'ın neredeyse birebir kopyası; bilerek silinmedi (ayrı bir temizlik).

### Faz D için not (2026-09-02)
Factur-X, CII XML'i PDF/A-3 olarak GÖMMEYİ gerektiriyor; pdfkit bunu desteklemiyor.
O adımda ya pdf-lib (saf JS, dosya gömme destekli) eklenecek ya da PDF/A-3
üretimi başka bir yolla çözülecek. Faz C bunu bilerek kapsamadı.

---

## Zamanlanmış işlerin yarısı canlıda çalışmıyormuş — 2026-09-02

**Bulgu.** Cloud Run `min-instances=0` ile çalışıyor: trafik kesilince örnek
kapanıyor ve `setInterval` onunla birlikte duruyor. `cron-registry` tam bu yüzden
var — dış tetikleyici (`/api/cron/tick`, Cloud Scheduler) kayıtlı işleri uyandırıp
çalıştırıyor. Ama **yedi iş motoru kayıt dışıydı**: ham `setInterval` ile
başlatılıyor, ne kayıt ne kalp atışı veriyorlardı. Yani yalnızca birisi tam o anda
uygulamayı kullanıyorsa çalışıyorlardı — ve sessiz kalmaları da fark edilemiyordu.

Etkilenenler ve yol haritasının onlar için söyledikleri:

| İş | Yol haritası iddiası | Gerçek |
|---|---|---|
| `automation-engine` | "5 dk'da bir çalışıyor" | örnek uyanıksa |
| `proactive-engine` | "10 dedektör, 10 dk'da bir" | örnek uyanıksa |
| `ai-insights` | günlük içgörü üretimi | örnek uyanıksa, üstelik kilitsiz |
| `ai-learning` | "AI öğrenme (deterministik)" | örnek uyanıksa |
| `webhook-service` (retry) | giden webhook yeniden denemeleri | örnek uyanıksa |
| `google-auto-pointage` | 30 dk'da bir otomatik pointage | örnek uyanıksa |
| `data-protection-monitor` | veri koruma denetimi | örnek uyanıksa |
| `ai-utils` purge | `ai_usage` saklama süresi temizliği | örnek uyanıksa |

**Yapıldı.** Sekizi de `withHeartbeat(...)` ile sarıldı — bu tek çağrı hem dış
tetikleyici registry'sine kaydediyor hem kalp atışı yayınlıyor (sağlık panosu
gecikmeyi görebiliyor). `ai-insights` ayrıca organizasyon başına `withCronLock`
aldı: iki örnek aynı anda üretirse her biri kendi IA çağrısını ödüyor, sonra
ikincisi birincinin yeni eklediği içgörüleri "dismissed" işaretliyordu.

`ai-cache` bilerek dışarıda: yalnızca bellekteki bir Map'i süpürüyor, örnek
kapanınca yakalanacak bir şey kalmıyor.

`cron-registration.test.ts` bu değişmezi kilitliyor (kayıt, kalp atışı, kilit
ad alanı tekilliği) — sarmalayıcıyı kaldırdığımda düştüğü doğrulandı.

---

## Şema ↔ kod ve ölü kod denetimi — 2026-09-02

**Şema (76 tablo, 1122 sütun).** 19 sütun (%1.7) koda hiç değmiyor ve hepsi
şema olarak var ama hiç yazılmamış özelliklerde kümeleniyor (`compte_client`
yaşlandırma kovaları, `objectifs_commerciaux` hedef/gerçekleşen). Bu bir kusur
değil, şema kayması; sütun düşürmek riskli bir migrasyon ve karşılığı yok.
Bilerek dokunulmadı.

**İndeksler: temiz.** İlk ölçüm üç tenant tablosunu indekssiz gösterdi; ikisi
ölçüm körlüğüydü (`geofences` indeksini `(t) => [...]` yazımı yüzünden
göremedim, `subscriptions.organisation_id` zaten `.unique()` — Postgres bunun
için indeks yaratır). Geriye `organisation_closures` kaldı: organizasyon başına
birkaç satır tutuyor, tarama zaten ucuz. Değişiklik yapılmadı.

**Hiç yazılmayan iki tablo.** `commandes_fournisseur` ve
`google_app_credentials` yalnızca okunuyor, hiçbir yerde `insert` yok.
İkincisi yol haritasının 1 numaralı bekleyen maddesi için önemli: Google OAuth
kimlik bilgileri organizasyon başına bu tablodan okunuyor
(`lib/google-auth.ts:168-186`) ama onları oraya yazacak ne bir uç ne bir ekran
var. Yani kullanıcı Google Cloud Console'da istemciyi oluşturduktan sonra tek
işleyen yol **ortam değişkenleri** (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`);
müşteri başına BYOC yolu şema ve okuma tarafında hazır, yazma tarafı yok.

**Ölü ihracatlar.** 72 ihracat başka hiçbir dosyada (testler dahil)
kullanılmıyor. Çoğu zararsız (MIME sabitleri, `stopX` kapatıcıları). Biri
gerçek bulguydu: `startGoogleDriveBackupScheduler` hiç çağrılmıyor — Drive'a
otomatik yedek yalnızca elle tıklandığında alınıyor, oysa servis kendi log
satırında "6 saatte bir planlayıcı başladı" diyor. Yerel `auto-backup`
başlatılıyor, bu başlatılmıyor.

**Karar bekleyen:** Drive otomatik yedeklemesi açılsın mı? Açmak, müşteri
verisini zamanlayıcıyla onların Google Drive'ına yazmaya başlamak demek — bu bir
ürün kararı, sessizce yapılacak bir düzeltme değil. Şimdilik durum
`cron-registration.test.ts` içinde gerekçesiyle yazılı ve biri onu bağladığı an
test düşüp registry'ye kaydını zorunlu kılıyor.

---

## Ön yüz denetimi — 2026-09-02

**Efekt temizliği: bir gerçek sızıntı.** Uygulamadaki her `useEffect`
temizlenmeyen dinleyici / interval / observer / socket için tarandı. Tek bulgu
`useBatteryStatus`'tu: tarayıcının `BatteryManager` singleton'ına iki dinleyici
ekleyip hiç kaldırmıyordu, yani her mount iki abonelik daha bırakıyor ve
demonte bileşende `setState` çağırmaya devam ediyordu. Düzeltildi (`d762eeaf`),
async yarış da kapatıldı: bileşen `getBattery()` uçuştayken demonte olursa artık
hiç abone olmuyor. 4 test.

**React Query önbelleği: temiz.** 27 mutasyonun tamamı değiştirdiği veriyi
yeniliyor; etkisiz (hayalet) invalidation yok. Tek aday rapor üretip yerel
state'e yazıyor, sunucu verisi değiştirmiyor.

**Yanıt sözleşmesi: temiz.** 31 GET çağrısında ön yüzün okuduğu her üst düzey
anahtar sunucunun döndürdükleri arasında. İki paket arasında tip bağı olmadığı
için bu, satış zinciri kesintisini üreten sınıfın aynısı — statik olarak
ölçüldü, ayrışma yok.

Not: bu üç ölçümün ilk sürümleri sırasıyla 2, 1 ve 16 "bulgu" verdi; ikisi
ölçüm körlüğüydü (kısayol özellikler `{ logs, total }`, iç içe nesneler, 400
karakterlik pencerenin yanlış fetch'e atfı). Elle doğrulanmadan hiçbiri
bulgu olarak kaydedilmedi.

---

## Müşteri-başına günlük yedek — 2026-09-02

**Talep:** her müşteri kendi verisini kaybetmesin; günlük yedek olsun ve müşteri
bunu **kendi tarafından** yapabilsin.

**Bulunan durum (üçü de gerçek kusurdu):**
- `auto-backup.ts` hiçbir veri yedeklemiyordu: satır **sayıyor**, özeti
  hash'leyip bir kayıt satırı yazıyordu. Geri yüklenecek hiçbir şey yok.
- `google-drive-backup.ts` gerçek veri çıkarıyor ama `SELECT * FROM table`
  ile, filtre olmadan — yani **tüm kiracıların** satırları. Bir müşterinin
  Drive'ına bağlansaydı ona herkesin verisini verecekti. Hiç başlatılmamış
  olması tek şanstı.
- Müşterinin "Sauvegardes" ekranı `/api/workspace/backups*` çağırıyordu; o
  uçlar **hiç yok**. Ekran bir cepheydi.
- Cloud SQL yedekleri açık (doğrulandı: her gün 03:00, 7 yedek saklanıyor,
  7 günlük PITR). Bu **veritabanını** korur, müşteriyi değil: yanlışlıkla
  silinen bir kayıt onun için yine kayıptır ve bize başvurmadan hiçbir şey
  geri alamaz.

**Yapılan (`267278c5`):** organizasyon-başına gerçek yedek.
`organisation_id` taşıyan 77 tablonun tamamı artı organizasyon kaydı, partiler
halinde okunup JSON'a yazılıyor, gzip'leniyor, sha256 ile mühürleniyor ve
saklanıyor. Sırlar sütun adına göre çıkarılıyor (parola hash'i, MFA sırrı,
OAuth access/refresh jetonları, şifreli client secret, API anahtarı hash'i):
indirilip kaybolan bir dosya müşterinin entegrasyonlarını teslim etmemeli.

Müşteri kendi yönetiyor: `/api/my-backups` listeler, oluşturur (15 dakikada
bir), indirir, siler — hepsi oturumun organizasyonuyla sınırlı ve organizasyon
yöneticilerine ayrılmış (bir yedek tüm müşteri ve fatura verisini taşır).
Ayarlar → Yedekler sekmesinin başına 6 dilde bir kart eklendi.

Günlük iş 02:00 UTC'de, organizasyon başına kilitle, "bugün zaten alındı"
güvencesi **yazılmış satırlardan** türetilerek çalışıyor ve dış tetikleyici
registry'sine kayıtlı — yoksa yalnızca uyanık örnek varken çalışırdı.

Uçlar **bilerek `licenseCheck` öncesine** bağlandı: kendi verisini almak
güncel aboneliğe bağlı olmamalı; lisans biterken müşterinin ona en çok
ihtiyacı olur.

**Testler:** 13 birim (kapsamın şemayla karşılaştırılması, sır çıkarma,
bütünlük, dosya adı sertleştirme) + gerçek veritabanına karşı 6 test; en
önemlisi iki organizasyonu yan yana kurup birinin yedeğinde diğerinden hiçbir
iz olmadığını gösteriyor. Kapsam testi, listeden bir tablo çıkarıldığında
düştüğü doğrulanarak sabitlendi.

**⚠️ Üretimde gereken tek adım:** `organisation_backups` tablosu için şema
itmesi. CI şemayı yalnızca test veritabanına uyguluyor; üretim şeması elle
gidiyor (`deploy/gcp-schema-push.sh` veya `DATABASE_URL=<prod> pnpm db:push`).
Bu yapılana kadar yedek uçları hata döner. Canlı veritabanına `--force` şema
itmesini bilerek yapmadım — kullanıcının kararı.

---

## Geri yükleme + bir gün boyunca fark edilmeyen dağıtım hatası — 2026-09-02

### Geri yükleme (`318a464c`)
İndirilebilen ama geri konulamayan bir yedek dosyadan ibarettir. `tenant-restore.ts`
**yalnızca ekleyen** bir kurtarma sağlıyor: eksik satırları yeniden ekler, hiçbir
satırı güncellemez ve silmez. Dünkü yedeği geri yükleyen müşteri bugün yaptığı
her şeyi korur — üzerine yazan bir kurtarma, insanın verisini korumaya çalıştığı
anda bir günlük emeğini alırdı.

İki adım: `GET /my-backups/:id/restore-preview` hiçbir şey yazmadan tablo tablo
neyin eksik olduğunu döndürür; ekran bu sayıları gösterip onay ister; sonra
`POST .../restore`. Kapsam ebeveyn-önce sıralı, seçilmiş iş tabloları; kimlik
doğrulama/abonelik, append-only günlükler ve telemetri bilerek dışarıda. Her
satır oturumun `organisation_id`'siyle yeniden yazılır. 6 test (gerçek veritabanı),
"üzerine yaz" mutasyonuyla düştüğü doğrulandı.

### Dağıtım: bir gün boyunca hiçbir şey canlıya inmemiş
`gcloud builds list` bölge belirtmeden çalıştırıldığında **başka projelerin**
(`assise`, `batiflow`) build'lerini döndürüyor. Hepsi `SUCCESS` olduğu için
oturum boyunca "canlıya indi" diye rapor edildi. Gerçek: Bureau-Agent build'leri
`europe-west9`'da ve bugünkü push'ların **hepsi FAILURE** idi.

Sebep: `lib/api-spec` çalışma zamanı rota envanteri. Bu oturumda üç grup rota
eklendi (prospects/devis/factures-client yeniden bağlama, fatura PDF ucu, yedek
uçları) ama `runtime-routes.generated.json` yeniden üretilmedi. Build ilk adımda
(`quality-gate` → `routes:check`) duruyor, dağıtım adımına hiç gelmiyor — yani
push sessizce hiçbir şey yapmıyor.

Düzeltme `8cd2d0f3`: envanter üretildi (648 rota), build geçti, API `00275` ve
web `00233` 15:06 UTC'de dağıtıldı.

**Kalıcı ders (hafızaya da işlendi):** dağıtımın indiğinin kanıtı build listesi
değil, çalışan sürecin durumudur. Bu kez kanıt cron kaydı oldu:
`/api/cron/registered` 14'ten **23**'e çıktı ve bu oturumda kaydettiğim dokuz
işin hepsi göründü. Uç yoklaması kanıt değil — var olmayan bir yol da 401 döner.
