# Tam Yapay Zeka Otomasyonu — Yol Haritası

> Bu dosya, "Ajant Bureau" uygulamasının tam yapay zeka destekli / tam otomasyonlu
> hale gelmesi için yapılan denetimlerin ve kalan işlerin **kalıcı** kaydıdır. Her
> oturumda güncellenir, silinmez — yeni bulgu/tamamlanan iş oldukça buraya eklenir.
>
> Son güncelleme: 2026-09-03 (silinen veri artık geri gelebiliyor — çöp kutusu 24 silme
> noktasını kapsıyor ve kapsam testi bütçe değil kural — altı haftadır bağlanmamış
> güvenlik taraması purge'ü cron'a bağlandı ve beyan edildi, eksik tek tablonun bütün
> müşterilerin yedeğini yok ettiği hata düzeltildi; **üretim şeması aynı gün 17:11'de
> push edildi — `deleted_rows` artık üretimde, çöp kutusunun açık adımı kalmadı**;
> ve **AI konseyi ilk kez gerçekten üç sağlayıcılı**: Anthropic'in harcama tavanı
> 1 Eylül'de kalkmış, ölçüldü (HTTP 200), tek nokta bağımlılığı bitti;
> aynı gün daha önce: satılabilirlik denetimi: hukuki belgeler tamamlandı — CGV
> ve RGPD işleme sözleşmesi yayında — arayüz erişilebilirliği isimsiz buton borcunu
> sıfıra indirdi, ve RGPD akışı kapandı: kişi kendi verisini indirebiliyor, talep
> kapatılabiliyor, bir aylık süre görünür; önceki güncelleme 2026-09-02: satış zincirinin 31 Temmuz'dan beri kapalı olduğu bulundu ve
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
  doğrudan Anthropic API anahtarına geçildi. Kod + yapılandırma canlıda.
  **2026-09-03'te gerçek bir `POST /v1/messages` ile ölçüldü: HTTP 200** —
  anahtar geçerli, harcama tavanı kalkmış, Claude canlıda çalışıyor. Konsey
  artık gerçekten üç sağlayıcılı (bkz. madde 3)

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
- **2026-09-03 — Console dışındaki her şey scriptlendi**: `deploy/setup-google-oauth.sh`
  sırları oluşturuyor (rotasyonda yeni sürüm ekliyor), çalışma servis hesabına
  `secretmanager.secretAccessor` veriyor, `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/
  `GOOGLE_REDIRECT_URI`'yi Cloud Run'a bağlıyor ve **servisi geri okuyarak**
  doğruluyor — komutlar hata vermedi diye "oldu" demiyor. Anahtarlar yoksa,
  Console'da yapılacak beş adımı ve tam olarak yapıştırılacak redirect URI'yi
  yazdırıp çıkıyor. `deploy/gcp-deploy.sh` de artık bu iki sırrı görürse
  otomatik bağlıyor, yani tam bir yeniden dağıtım OAuth'u düşürmüyor.
- **Kullanıcının yapması gereken** (sadece Console kısmı — proje sahibi olmak
  gerekiyor): Gmail/Calendar/Drive API'lerini aç, OAuth consent screen'i
  "External" olarak yayınla, "Web application" tipinde bir OAuth client ID
  oluştur, yetkili redirect URI olarak yukarıdaki adresi ekle. Sonra:

      GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... bash deploy/setup-google-oauth.sh

- **Durum**: Console adımı kullanıcıda; gerisi hazır ve tek komut.

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

### 3. [TAMAMLANDI] OpenAI / Anthropic platform-seviyesi yedek anahtarı ekle (2026-09-03)

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
- **KAPANDI — 2026-09-03, ölçüldü**: `bash scripts/check-anthropic-key.sh` →
  **HTTP 200** (`claude-sonnet-4-6`). Harcama tavanı 1 Eylül'de kendiliğinden
  kalktı; hiçbir kod veya yapılandırma değişikliği gerekmedi. Konsey artık
  gerçekten üç sağlayıcılı (Gemini + OpenAI + Anthropic) — 14 Temmuz'dan beri
  ilk kez tek nokta bağımlılığı yok.
- **Kalan tek kırılganlık**: anahtar hâlâ batiflow ile PAYLAŞILIYOR. Orada bir
  iptal/rotasyon agent-de-bureau'yu da durdurur; ayrıştırma tek komutluk
  (yukarıda). Bunu ölçen script repoda, tekrar çalıştırılabilir.
- **Durum**: OpenAI tamam. Anthropic tamam. Vertex yolu opsiyonel olarak açık
  kaldı (doğrudan anahtar varken `getAnthropicMode()` onu yok sayar).
- **Doğrulama komutu** (tekrar ölçmek gerektiğinde, PowerShell'den de çalışır):

      bash scripts/check-anthropic-key.sh

  Script anahtarı Cloud Run'ın bağladığı sırdan okur — elle kopyalanan bir
  anahtarı denemek üretimi değil başka bir şeyi ölçerdi — ve gerçek bir
  `POST /v1/messages` çağrısı yapar: "anahtar geçerli" ile "hesap açık" ancak
  bu çağrı ayırır. `200` → konsey üç sağlayıcıyla çalışıyor, madde kapanır.
  `429 enforced_spend_limit_reached` → Anthropic Console → Plans & Billing'den
  tier yükseltilmeli. Ölçmeden "çalışıyor" yazılmayacak.

### 4. [TAMAMLANDI] Super Agent: durum kalıcı + günlük cron (2026-09-03)

- **Sorun**: `ai-agents.ts:2819` — `superAgentStates = new Map()` bellekte tutuluyor,
  her redeploy/restart'ta kayboluyor. Ayrıca sadece manuel tetiklemeyle çalışıyor
  (`POST /ai/super-agent/run`), zamanlanmış bir cron yok.
- **Yapılacak**: Durumu bir DB tablosuna taşı, `autonomous-secretary-cron.ts` gibi
  zamanlanmış bir cron ekle.
- **Ertelenme gerekçesi ölçünce çürüdü (2026-09-03)**: "~37 kullanım noktası"
  kaba bir sayımdı; gerçekte `Map`'e dokunan **dört** satır vardı, geri kalanı
  aynı getter'ın döndürdüğü nesnenin alanlarıydı. Ve OAuth beklemesi de yanlış
  gerekçeydi: durumun bozukluğu e-posta ayağıyla ilgili değil — `process-report`
  ve şantiye/görev/arama ayakları Gmail olmadan da çalışıyor, sayaçları ve
  günlüğü de onlar yazıyordu.
- **Gerçek hata, Faz 1'dekiyle aynı sınıftan**: servis `maxScale=3` ile
  çalışıyor. `POST /ai/super-agent/run` bir instance'a, `GET /status` başka
  birine düşünce kullanıcı, gerçekten çalışmış bir cyclein ardından "hiç bir şey
  olmamış" ekranı görüyordu (günlük boş, sayaçlar sıfır). Ayrıca `running`
  bayrağı süreç başına olduğu için **üç instance aynı organizasyonda aynı
  cycle'ı paralel çalıştırabiliyordu**.
- **Yapıldı**: `super_agent_state` (organizasyon başına tek satır, sayaçlar
  ayrı tamsayı sütunlar) ve `super_agent_logs` (satır başına bir olay) tabloları
  + `services/super-agent-state.ts`. Bayrak tek bir koşullu SQL ile alınıyor —
  iki instance ikisi birden kazanamaz —, sayaçlar SQL'de artırılıyor (oku-yaz
  yaparsak eşzamanlı cycle'lar birbirini ezerdi), günlük satır ekleyerek
  yazılıyor (JSON dizisi yeniden yazmak kayıp üretirdi). Ölen bir instance'ın
  bıraktığı bayrak 30 dakika sonra devralınıyor, yoksa organizasyon bir daha
  hiç cycle başlatamazdı.
- **Şema penceresi bilerek ele alındı**: tablolar üretimde henüz yok. `42P01`
  görülürse eski davranışa (instance başına bellek) düşülüyor, saatte bir kez
  loglanıyor ve `GET /status` yanıtına `degraded: true` ekleniyor — cycle asla
  günlüğü yazamadığı için başarısız olmuyor. **Kullanıcı adımı: `bash
  deploy/gcp-schema-push.sh`.**
- **Doğrulama**: 11 yeni test (`super-agent-state.test.ts`) — eşzamanlı üç
  başlatmadan yalnız birinin kazandığı, terk edilmiş cycle'ın devralındığı,
  beş eşzamanlı sayaç artışının toplandığı ve kiracı sınırının aşılmadığı
  dahil. Tablolar `TENANT_TABLES`'a eklendi (kapsam testi kural).
- **Cron da eklendi (aynı gün) — ama açık değil, açılabilir**:
  `services/super-agent-cron.ts` saatte bir tikliyor, günlük kapı
  `super_agent_state.lastRun`'dan geliyor (süreç değişkeninden değil: yeniden
  başlatma yapılmış bir cycle'ı tekrarlamıyor), organizasyon başına advisory
  kilit var, askıya alınmış organizasyon atlanıyor ve dış tetikleyiciye
  (`registerRunnableCron`) kaydediliyor — `min-instances=0` ile `setInterval`
  tek başına neredeyse hiç çalışmıyor.
- **Neden varsayılan KAPALI**: Super Agent rapor yazmıyor, **yazıyor** — görev
  yaratıyor ve öncelik yükseltiyor, üstelik onay kuyruğundan geçmeden. Cron'u
  herkes için açmak, ertesi sabah her müşteride kimsenin istemediği görevlerin
  belirmesi olurdu. Bu ürün kararı her organizasyonun kendisine bırakıldı:
  `super_agent_state.auto_run_enabled` (varsayılan `false`),
  `PATCH /ai/super-agent/auto-run` (yalnız yönetici) ve mobil Super Agent
  ekranında bir anahtar. Sunucu reddederse anahtar açık görünmüyor — okunmayacak
  bir ayarı açık göstermek, kapalı göstermekten kötü.
- **Doğrulama**: 7 yeni test — kapalı organizasyonun seçime hiç girmemesi,
  günde ikinci kez alınmaması, hiç çalışmamış organizasyonun alınması ve
  varsayılanın gerçekten `false` olması dahil.
- **Üretim şeması aynı gün 18:11'de push edildi**: `super_agent_state`,
  `super_agent_logs` ve `auto_run_enabled` artık üretimde. Degraded pencere
  kapandı — sayaçlar üç instance arasında paylaşılıyor ve otomatik çalıştırma
  anahtarı gerçekten kaydediliyor.
- **Durum**: Kalıcılık ve cron tamam, şema üretimde. Madde 4 kapandı; e-posta
  ayağı hâlâ madde 1'e (Google OAuth) bağlı.

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

### ✅ Faz D — YAPILDI (Factur-X), bir parçası bilerek yayıncıya bırakıldı
EN 16931 CII XML üretiliyor ve PDF'e gömülüyor. Ayrıntı için aşağıdaki
2026-09-03 bölümüne bak. Chorus Pro/PDP iletimi ayrı sonraki adım olarak duruyor.

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

---

## Google BYOC + teslim zincirinin doğrulanması — 2026-09-02

### Müşteri-başına Google uygulaması (`42e5e986`)
Yol haritasının 1 numaralı maddesinin sunucu tarafı tamamlandı. Tablo, şifreleme
(`encryptSecret`/`decryptSecret`) ve okuma yolu zaten vardı — **hiçbir şey oraya
yazmıyordu**, dolayısıyla Google'ı bağlamanın tek yolu platformun paylaşılan
ortam değişkenleriydi. Üç uç eklendi (`/org-google-credentials`), hepsi
`getOrgId` ile sınırlı ve organizasyon yöneticilerine ayrılmış. İstemci sırrı
AES-256-GCM ile şifreli girer ve **hiçbir yanıtta geri dönmez**; okuma yalnızca
"yapılandırılmış mı" ve maskelenmiş istemci kimliği verir. Ekran, Console'a
yapıştırılacak yönlendirme URI'sini kopyalama düğmesiyle gösteriyor (bir karakter
farkı `redirect_uri_mismatch` ile sessizce düşürür). 8 test.

Kullanıcıda kalan: Console'da OAuth istemcisini oluşturmak.

### Teslim zinciri ölçüldü (varsayılmadı)
- Cloud Scheduler `agent-de-bureau-cron` (europe-west1): `*/10 * * * *`, gece
  dahil, hedef `/api/cron/tick`.
- Elle bir tick çalıştırıldı: **23 iş kontrol edildi**, `tenant-backup` listede,
  vadesi gelen ikisi çalıştı.
- API revizyonu `00277` (15:59 UTC), web `00233`.

Yani günlük yedek 02:00 UTC'de gerçekten ateşlenecek; kayıt, zamanlayıcı ve
saat kapısı üçü de yerinde.

---

## Müşterinin AI anahtarı hiçbir zaman kullanılmıyormuş — 2026-09-02

### Bulgu
`ai_providers` tablosu, AES şifreleme, ayar ekranı ve **hatta per-org istemci
kuran tam bir katman** (`services/ai-providers.ts`: `getOrgGeminiClient`,
`callOrgGemini`, geçersiz anahtarda plataforma geri düşme…) zaten vardı. Ama bu
katmanı **sunucudaki tek bir dosya** kullanıyordu: `ai-stream.ts`.

Diğer her yerde — 22 dosya, 44 çağrı — kod şuydu:

```ts
const { ai } = await import("@workspace/integrations-gemini-ai");
```

yani platformun paylaşılan singleton'ı. Tüm çağrıların neredeyse tamamının
geçtiği `ai-failover.ts` de dahil: `orgId`'yi **sadece kotayı saymak ve kullanımı
kaydetmek** için alıyordu, çağrıyı yine platform anahtarıyla yapıyordu.

**Sonuç:** kendi Gemini/OpenAI/Anthropic anahtarını yapıştıran müşteri, yine
sahibin kredisinden harcıyordu. "Kendi anahtarınızı getirin" özelliği faturada
hiçbir şey değiştirmiyordu. Kod incelemesiyle görünmeyen cinsten: her parça tek
başına doğruydu, sadece hiçbiri diğerine bağlı değildi.

### Yapılanlar
1. **`services/ai-key-policy.ts` (yeni)** — tek yetkili: *bu çağrıyı kim ödüyor?*
   Anahtar okumaz/çözmez (o iş `ai-providers.ts`'te kalır; aynı tablo üzerinde
   ikinci bir cache, ekranın temizlemediği için dakikalarca iptal edilmiş anahtar
   servis ederdi). Verdiği cevap `payerOrgId`: `null` = platform kredisi.
2. **`services/ai-client.ts` (yeni)** — `aiForOrg(orgId)`, o tek satırın yerine
   geçen ikame. Organizasyon **açıkça** geçirilir; AsyncLocalStorage'lı örtük
   bağlam bilerek reddedildi — bağlamdan düşen bir cron sessizce "organizasyon
   yok"a, yani sahibin kartına düşerdi.
3. **44 çağrı yeri göç etti** (22 dosya): ai-agents, ai-analysis, ai-commandant,
   ai-inline-suggest, calls, documents, face-recognition, gmail, integrations,
   math, voice-command, voice-receptionist, voice-site-ops, workforce-*,
   workspace, ai-insights, call-processor, document-ai, math-engine,
   performance-analyzer, support-inbox, web-search, whatsapp-inbox.
   Sekiz yerde `orgId` fonksiyon zincirinden geçirilmek zorunda kaldı
   (`askDocumentQuestion`, `runGeminiAnalysis`, `analyzeWithAI`,
   `analyzeWithGemini`, `parseCommandAI`, `extractActions`,
   `transcribeVoicemail`, `multiAiAnalyze`).
4. **`ai-failover.ts`** artık üç sağlayıcı çağrısına da `payerOrgId` taşıyor.
   Sağlık sondası ve Gemini uyumluluk yolu açıkça `null` — orada gerçekten
   arkada bir müşteri yok.
5. **19 yeni test** + mevcut failover testinin mock'ları güncellendi.
   Bütün takım: **805 geçti, 0 kaldı**. `tsc` temiz, `routes:check` 651 rota OK.

### Uygulama kademeli — bilerek
Refüz **varsayılan olarak kapalı**: `AI_REQUIRE_OWN_KEY=true` verilene kadar,
anahtarı olmayan organizasyon eskisi gibi platform kredisiyle çalışır
(`platformReason: "enforcement-off"`). Doğrudan "anahtar yoksa AI yok"a geçmek,
ilk dağıtımda mevcut tüm müşterilerin AI'ını kapatırdı — bu ticari bir karar,
teknik bir karar değil. Bu commit önce **atfı** doğru yapıyor: anahtarını girmiş
müşteri artık gerçekten kendi anahtarını kullanıyor.

Sahibin organizasyonu ve `AI_PLATFORM_KEY_ORG_IDS` listesi, refüz açıldığında
bile platform kredisinde kalır.

### Refüz yolu da kapatıldı (aynı gün)
`AiKeyRequiredError` 402 taşıyordu ama rota işleyicilerinin çoğu kendi
`catch`'inde `500 / "Erreur interne"` döndürüyordu — yani bilerek konmuş bir
kısıt, ürün arızası gibi görünecekti. Bunun için `services/ai-guard.ts`:

- **`assertAiUsable(orgId)`** — kota + ödeme aracı, tek çağrıda. Rotaların zaten
  `assertAiQuota`'yı çağırdığı **ön kapıya** kondu, çünkü orada `catch` cevabı
  verip çıkıyor; sadece derinden fırlatmak son `catch`'in 500'üne düşerdi.
- **`respondAiError(err, res)`** — iki reddi de çeviren tek yanıtlayıcı:
  429 (kota) / **402 + `aiKeyRequired: true`** (anahtar). Tanımadığı hatada
  `false` döner, gerçek arızalar eskisi gibi 500 ve loglu kalır.

Bağlandığı yerler: ai-analysis (10 ön kapı), ai-commandant (paylaşılan
`handleCommandantError` → tüm komutan rotaları), ai-agents (3), face-recognition
(2), voice-command (2), voice-site-ops, web-search, knowledge-base (2), calls (3),
workforce-agent, documents (belge Q&A). 7 yeni test.

Bilerek dokunulmayanlar: `ai-inline-suggest` (tasarımı gereği sessiz — kota
bittiğinde de öneri vermiyor), `gmail`/`integrations`/`workspace` içindeki
"engellemeyen" iç `catch`'ler (akış devam edip başka bir yanıt gönderiyor;
oraya yanıt yazmak "headers already sent" olurdu) ve SSE/arka plan işleri
(zaten stream/log üzerinden bildiriyorlar).

Arayüz tarafı için `getAiKeyStatus(orgId)` hazır: hangi sağlayıcı yapılandırılmış,
platform kredisi kullanılıyor mu, refüz açık mı.

**Artık `AI_REQUIRE_OWN_KEY=true` güvenle açılabilir** — ama açmadan önce
müşterilere haber verilmeli, çünkü anahtarı olmayan herkes o anda 402 görmeye
başlar.

---

## Derinlemesine denetim programı — 2026-09-02

Kullanıcı "eksik, yanlış ve yenilikler" için beş turluk bir inceleme istedi ve
çıkan yedi fazın **hepsinin sırayla uygulanmasını** onayladı. Bulgular ve
ilerleme burada.

### Ölçüm
~255.000 satır TS/TSX, 5 uygulama (api-server 98k, buro-ajani 73k, mobile 45k,
tanıtım 11k, lib 27k), 654 rota, 86 tablo, 92+26 test dosyası.

### Doğrulanmış bulgular
1. **Ölçek ↔ süreç-içi durum**: `maxScale=3`, `concurrency=80` (canlıdan
   ölçüldü). Buna karşılık modül seviyesinde **55 `Map`/`Set`** güvenlik ve iş
   durumu tutuyor: Guardian yasak listesi, lisans önbelleği, hız sınırı sayacı,
   çalışan-iş kayıtları. Üç örnek arasında hiçbiri paylaşılmıyor.
2. **Çok kiracılılık**: 1331 `db.select`, Postgres tarafında **RLS yok**;
   izolasyon tamamen el disiplinine bağlı.
3. **Girdi doğrulama**: 654 rotaya karşılık 60 zod şeması. (Kimlik doğrulama
   merkezî ve sağlam: `routes/index.ts:129` → `router.use(requireAuth)`.)
4. **Şema**: `drizzle-kit push`, sürümlü migration yok; 7 `ensure-*.mjs`
   betiği bunu telafi ediyor.
5. **Repo hijyeni**: `schema_files_aa..aq` (17 çöp dosya izleniyor),
   `cloud-sql-proxy.exe` (ikili), `apps/api-py` (44 dosyalık FastAPI, CI'da
   test ediliyor ama hiçbir yere dağıtılmıyor), `attached_assets` 9.8 MB.
6. **E2E testi yok** (Playwright repoda değil).

### Düzeltilen bir yanlış hüküm
İlk sunumda "dağıtım sonrası gözü kapalı" dedim — **yanlıştı**. `health-agents.ts`
sekiz ajanla 15 dakikada bir koşuyor ve `health-alert.ts` kritik arızaları
e-postayla sahibe iletiyor. Gerçek boşluk daha dar: sekiz ajan **altyapıyı**
izliyor, ürünün **sonuç üretip üretmediğini** izlemiyor.

## Faz 0 — TAMAM (uygulamanın kendi kendini ihbar etmesi)

Olayları mevcut kapsamla karşılaştırınca üç somut kör nokta çıktı; üçü de
kapatıldı.

**1. Sonuç ajanı** (`services/health-agents-outcome.ts`, 9. ajan). Dört kontrol,
hepsi **koşullu** — girdi yoksa susar, çünkü boşuna bağıran ajan kapatılır ve
asıl sinyal o zaman kaybolur:
- `invoice_reminders`: 7 günden eski vadesi geçmiş fatura **var** ve aynı
  sürede hiç hatırlatma gitmemiş → echec/haute. *31 Temmuz panasının tam şekli.*
- `tenant_backups`: aktif organizasyon var ve 48 saattir otomatik yedek yok →
  echec/critique.
- `ai_activity`: geçen hafta çağrı vardı, bu hafta sıfır → echec. Sadece
  kendisiyle kıyaslar.
- `ai_failure_rate`: `ai_usage.status` üzerinden 24 saatlik hata oranı. "Sonda
  yeşil ama gerçek çağrılar kırmızı" ayrımını yapar.

**2. 403 kör noktası** (`health-agents-external.ts`). `errors` ajanı yalnız
**5xx ve 429**'a bakıyordu; Guardian yasağı **403** döndürür ve `s4xx` içinde
401/404 ile birlikte gömülüydü. 14 Temmuz'da site tamamen kapalıyken sağlık
paneli yeşildi. Artık 403 ayrı sayılıyor ve `blocked_requests` kontrolü var;
düzeltme metni suçu ziyaretçilere değil `X-Real-Client-IP` zincirine
yönlendiriyor — ilk seferinde zaman kaybettiren yanlış sonuç buydu.

**3. Sahte derleme kimliği** (`routes/health.ts`). `APP_BUILD_HASH`, **süreç
başlama dakikasının MD5'iydi**. İki sonucu vardı:
- "Değişikliğim canlıda mı?" sorusunun cevabı yoktu — 2 Eylül'de build'ler bir
  gün boyunca başarısızken bu fark edilmedi.
- `update-banner.tsx` bu değeri karşılaştırıp "yeni sürüm var" gösteriyor. Değer
  başlama saatinden türediği için **her soğuk başlatma** bunu değiştiriyordu ve
  üç örnek arasında iki ardışık istek iki farklı değer dönebiliyordu: hiç sürüm
  yayınlanmadan çıkan bir bildirim.

Artık Cloud Build'in kısa SHA'sı (`BUILD_SHA`, `deploy/cloudbuild.yaml`'da
`--update-env-vars` ile — `--set-env-vars` tüm yapılandırmayı silerdi).
`/api/healthz` artık `build` alanını oturumsuz döndürüyor.

**18 yeni test**, toplam **830 geçti**, tsc temiz.

## Faz 1 — TAMAM (paylaşılan durum paylaşılan yere)

`maxScale=3` canlıda ölçüldü; üç süreç aynı alan adını sunuyor ve ziyaretçi
aynı örneğe düşmek zorunda değil. Modül seviyesindeki 55 `Map`/`Set`'in hepsi
yanlış değil — bazıları doğru şekilde süreç-içi (SSE `EventEmitter`,
`AbortController`). Hangisinin gerçekten paylaşılması gerektiğine tek tek
bakıldı; şunlar **zaten doğruydu ve dokunulmadı**: `agentAutoRunLastRunAt`
üzerinden atomik `UPDATE ... RETURNING` ile sahiplenme (`runAutoCycle`), ve 30
saniyelik TTL'iyle kendini iyileştiren `licenseCache`.

### 1a. Advisory kilidin kendisi bozuktu
En önemli bulgu, düzeltmek için yola çıktığım şey değildi. `lib/cron-lock.ts`
kilidi `db.execute(...)` ile alıyor, **ikinci bir** `db.execute(...)` ile
bırakıyordu. Ama `db` sekiz bağlantılık bir havuz ve her `execute` rastgele
birini ödünç alıyor: `pg_advisory_lock` **oturuma**, yani bağlantıya ait olduğu
için ikisi farklı bağlantıya düştüğünde Postgres bırakmayı reddediyor, dönen
değeri kimse okumuyor, ve kilit ilk bağlantıda kalıyor — o bağlantı boşta kalıp
kapanana (30 sn) veya yük altında çok daha uzun süre kullanılmaya devam edene
kadar. O süre boyunca korunan cron **her döngüde kilidi alamayıp kendini
sessizce atlıyordu**.

Bu kilit şunları koruyor: `dailyDigest`, `invoiceReminder`,
`autonomousSecretary`, `billing`, `aiInsights`, `tenantBackup` — yani
"hatırlatmalar neden gitmiyor?" sorusunun tam ortası. Kusur **belirsiz**di:
havuz genelde en son bırakılan bağlantıyı geri verdiği için çoğu zaman aynı
bağlantı düşüyor ve her şey çalışıyordu. Bu yüzden "çalıştı mı" diye bakan bir
test asla yakalayamazdı.

Düzeltme: kilit süresince havuzdan **tek bir bağlantı** ayrılıyor, alma ve
bırakma aynı bağlantıda. Test, sonucu değil bu eşliği doğruluyor.

### 1b. Guardian yasakları paylaşılıyor
Yeni `ip_bans` tablosu + `services/ip-ban-store.ts`. Guardian hâlâ bellekteki
`Map`'ten **okuyor** (her istekte çalışıyor, bekleyemez) ama artık yazma
tabloya geçiyor ve senkronizasyon **tembel** — `setInterval` yok, çünkü bu depo
Cloud Run'ın yalnız istek sırasında CPU verdiğini sağlık ajanlarında zaten
öğrenmişti. Eskalasyon sayacı **veritabanında** artıyor: üç örnek ikişer kez
yasaklarsa toplam altı olur, yani kalıcı yasak — üç ayrı "iki" değil.

Tablo yoksa modül kendini kapatıyor ve Guardian eski davranışına dönüyor.
Tablosu eksik diye çöken bir güvenlik duvarı, düzeltmeye çalıştığı kusurdan
kötüdür.

### 1c. Eşzamanlı otopilot döngüsü
`runningAutopilotJobs` süreç-başına bir gardı. Üç örneğe dağılmış üç tık, aynı
organizasyon için üç tam döngü başlatıyordu: üç kat ajan konseyi, üç kat AI
faturası, üç seri eşzamanlı yazma. Artık paylaşılan advisory kilit; kilit
alınınca hemen yanıt dönüyor, kilit ise arka plandaki iş bitene kadar tutuluyor.

### 1d. Oturum yapışkanlığı
`--session-affinity` eklendi. SSE iş akışı bir `EventEmitter` ve
`AbortController` taşır — bunlar **paylaşılamaz**, yalnız işi başlatan süreçte
vardır. Yapışkanlık olmadan ilerlemeyi okumaya gelen tarayıcı, işi tanımayan
bir örneğe düşüp boş akış görüyordu. Bu, paylaşılan durumun yerine geçmez;
yalnızca paylaşılamayanın vurduğu yeri kaldırır.

**16 yeni test**, toplam **846 geçti**, tsc temiz, 651 rota.

### ⚠️ Kullanıcıdan beklenen adım
`ip_bans` tablosu **üretimde henüz yok**. Dağıtım hattındaki `drizzle-kit push`
yalnız CI test veritabanına uygulanıyor; üretim şeması elle gidiyor:

    bash deploy/gcp-schema-push.sh

Bu yapılana kadar Guardian eski (örnek-başına) davranışında kalır ve günde bir
kez uyarı loglar — çökme yok.

**KAPANDI — 2026-09-03.** Bu adım da bugünkü üretim şema push'uyla kapandı:
`schema-guard` 89 tabloyu karşılaştırdı ve `drizzle-kit push` bütün eksik
tabloları uyguladı, `ip_bans` dahil. Guardian artık paylaşılan yasak tablosunu
kullanabilir.

## Faz 2 — TAMAM (kiracı izolasyonu: ölçüldü, sızıntı yok, kapı kondu)

### Sonuç önce: gerçek bir sızıntı bulunamadı
İlk taramamda "571 sorguda `organisationId` geçmiyor" demiştim. **O sayı kaba
bir sezgisel yöntemin eseriydi**, bulgu değil. Nedenini yazmak önemli, çünkü
aynı hataya bir daha düşülmesin: ifade seviyesinde bakınca, sahipliği on satır
önce doğrulanmış bir belge üzerindeki `update ... where id = :id` "filtresiz"
görünüyor — ve bunlardan yüzlerce var.

Analiz birimini **ifadeden işleyiciye** yükseltince soru netleşti ve
kararlaştırılabilir hale geldi: *kiracı verisine dokunan bu işleyici, hangi
organizasyonda olduğunu biliyor mu?* Hiç bilmeyen bir işleyici izolasyon
yapamaz — bu şüphe değil, kesin kusurdur. Bilen bir işleyicide noktasal bir
unutma hâlâ mümkündür ama o insan gözü ister, her commit'te bağıran ve üç gün
sonra kapatılan bir kapı değil.

624 blok tarandı, 31'i organizasyondan hiç söz etmiyordu, **31'inin de meşru
olduğu tek tek doğrulandı**:
- kimlik akışları (`auth.ts`): şifre sıfırlama, doğrulama e-postası, yeni giriş
  bildirimi — bunlar oturumdan **önce** çalışır, filtrelenecek organizasyon
  henüz yoktur; e-posta platform genelinde benzersiz.
- kullanıcıya anahtarlı altyapı (Google jetonları, API anahtarları, jeton
  iptali, isim çözümleme): `userId` ile kapanıyor. Bir kullanıcı tek
  organizasyona ait olduğu için bu kapsam **daha dar**, daha geniş değil.
- `requireSuperAdmin` arkasındaki platform yüzeyleri: amaçları zaten
  organizasyonlar arası görünüm.
- vitrin demosu: arkasında müşteri yok.

Yol boyunca iki "şüpheli" de elle açıldı ve ikisi de zaten doğruydu:
`/data-protection/status` platform sağlığını yalnız super_admin'e döndürüyor
(gerekçesi yorumda yazılı), `/audit/stats` `tenantCondition(req)` kullanıyor.

### Kalıcı olan kısım: kapı
Bulgu yokluğu bir garanti değil — bugünkü doğruluğu yarın koruyan bir şey lazım.
`scripts/tenant-scope-check.mjs` artık hem GitHub Actions'ta hem **dağıtım
hattının quality-gate'inde** koşuyor (`pnpm --filter @workspace/api-server
tenant:check`). Kiracı tablosuna dokunup organizasyondan habersiz yeni bir
işleyici build'i düşürür.

Muafiyet listesi bilerek **gerekçe yazmaya zorluyor**: bir girdi, "bu sorgunun
organizasyon filtresine ihtiyacı yok, çünkü…" diye okunan bir iddiadır ve kod
incelemesinde tartışılabilir. Ayrıca super-admin muafiyeti dosya **adına** değil
`requireSuperAdmin` montajına bakıyor: koruma kaldırılırsa muafiyet de kalkar.

### Neden RLS değil (şimdilik)
Postgres Row-Level Security asıl yapısal cevap olurdu, ama istek başına bir
oturum değişkeni (`SET LOCAL app.current_org`) gerektirir — yani **her HTTP
isteğini bir transaction'a sarmak**. Bu bir düzeltme değil, mimari değişiklik ve
havuzlu bağlantılarla gerçek bir performans bedeli var. Bulgu sayısı sıfırken bu
bedeli ödemek orantısız; kapı, "bir daha sessizce unutulamaz" özelliğini çok daha
ucuza veriyor. RLS, kiracı sayısı veya ekip büyüdüğünde yeniden değerlendirilmeli.

## Faz 3 — TAMAM (sınırda doğrulama: öncül daraldı, kusur netleşti)

### Öncül yine ölçümle düzeldi
"654 rota, 60 zod şeması" demiştim. Ölçünce doğrulama beklediğim yerde ince
değilmiş: bu depo `req.body`'yi **hiçbir yerde blok halinde yazmıyor**, alanları
tek tek seçiyor, ve **kütle atama (mass assignment) hiç yok** — üç `...body`
yayılımının üçü de zaten doğrulanmış zod çıktısından (`body.data`,
`parsed.data`) geliyor. 654 rotaya şema eklemek çoğunlukla kod eklemek olurdu.

### Gerçekten eksik olan, daha dar ve ölçülebilir
URL'den gelen sayılar korumasızdı:

- **`parseInt(String(req.params.id))` → `NaN`.** `eq(table.id, NaN)` olarak
  veritabanına kadar gidiyor, Postgres reddediyor ve istemciye **500** dönüyor.
  Yani URL'deki bir yazım hatası sunucu arızasına dönüşüyordu. Dahası bu, Faz
  0'da yeni kurduğum 5xx alarmını besliyordu: gürültü, az önce taktığım uyarıyı
  kemiriyor.
- **`parseInt(String(req.query.limit || "50"))` plafonsuz.** `?limit=99999999`
  bir organizasyonun tüm telefon kayıt tablosunu tek istekte isteyebiliyordu;
  `?limit=abc` ise `LIMIT NaN` üretiyordu.

`audit.ts` doğru yardımcıya (`safeInt`) zaten sahipti — **yerel** olarak. Kusur
doğru davranışın bilinmemesi değil, elin altında olmamasıydı.

### Yapılan
`lib/request-params.ts`: `rowId` (`NaN` yerine **`null`** döner — `null`
görmezden gelinemez, çağıranı karar vermeye zorlar), `safeInt`, `pageLimit`.
15 kimlik okuması + 3 limit okuması bunlara bağlandı; `audit.ts`'in yerel
kopyası paylaşılan hale geldi.

Testler yazarken uygulamanın **iki gerçek boşluğunu** yakaladı ve sıkılaştırdım:
`?id=1&id=2` Express'te dizi olur, `String(["1","2"])` → `"1,2"`, `parseInt` de
oradan 1 okur — kimsenin istemediği bir satır üzerinde işlem. Aynı şekilde
`"1.5"` → 1 ve `"12abc"` → 12 kabul ediliyordu. Artık yalnız salt rakam kabul
ediliyor: **tahmin edilen bir kimlik, reddedilen kimlikten kötüdür.**

**15 yeni test**, toplam **861 geçti**, tsc temiz, kiracı kapısı sıfırda.

## Faz 4 — TAMAM ama kapsamı bilerek değiştirildi

### Planladığım şey
Sürümlü migration'lara geçmek (`push` yerine `migrate`).

### Neden yapmadım
Üretim veritabanını bir migration günlüğüne "baseline"lamak, canlı şemaya
dokunmayı ve bu oturumdan doğrulayamayacağım bir durumu varsaymayı gerektirir.
Yanlış baseline, ilk migration'da tüm şemayı yeniden yaratmayı deneyebilir.
Doğrulayamadığım bir şeyi üretim şemasına uygulamak, çözdüğü sorundan büyük bir
risk. Bu yüzden asıl tehlikeyi hedef aldım.

### Asıl tehlike, ve kanıtı
`drizzle.config.ts`'in kendi yorumu **yaşanmış bir kazayı** anlatıyor: `push`,
connect-pg-simple'a ait olan (dolayısıyla Drizzle şemasında bulunmayan)
`user_sessions` tablosunu öksüz sanmış ve yeni eklenen bir tabloya "yeniden
adlandırmak" üzereymiş. `--force` altında bu, **giriş yapmış tüm kullanıcıların
oturumlarının silinmesi** demekti. Alınan önlem isimle korumaydı: adını
yazabildiğini korur, başkasını korumaz.

Ve bu komut üretimde **elle** çalışıyor (`deploy/gcp-schema-push.sh`), `--force`
ile — yani hiçbir soru sormadan, tablo silmek için bile.

### Yapılan
`lib/db/scripts/schema-guard.mjs`: push'tan **önce** canlı şema ile kaynak şemayı
karşılaştırır ve bir şey kaybolacaksa **durdurur**. Silmek hâlâ mümkün, sadece
kazara olmaktan çıktı:

    ALLOW_DESTRUCTIVE_SCHEMA=true pnpm push

En sık rastlanan kayıp biçimini de yakalar: **yeniden adlandırma**. Drizzle bir
kolonun adının değiştiğini bilemez; siler ve yeniden yaratır, veri gelmez.

Bağlandığı yerler: `pnpm push`, `pnpm push-force`, üretim betiği ve dağıtım
hattı. Hattaki çağrı **kendi kendini denetliyor**: CI veritabanı az önce
senkronlandığı için hiçbir şey bulmamalı; bir silme bildiriyorsa bozulan şey
şemanın kendisi değil, **korumanın şema okuması**dır — ve sapmış bir koruma,
elle çalıştırılan `push --force`'un önündeki tek engel olduğu üretimde artık
koruma değildir.

Karşılaştırma mantığı saf bir fonksiyon olarak ayrıldı ve **8 testle** kaplandı
— müşteri verisi üzerinde geri alınamaz bir işleme izin veren tek karar noktası
orası.

Toplam **869 test geçti**.

### Sürümlü migration'lar için kalan
Hâlâ doğru hedef, ama önce güvenli bir baseline gerekiyor: üretim şemasının
dökümü alınıp `drizzle-kit generate` ile karşılaştırılmalı, ve ilk migration
"zaten uygulanmış" olarak işaretlenmeli. Bu, canlı veritabanına erişimle
yapılacak bir iş; koruma bu arada kaza riskini kapatıyor.

## Faz 5 — TAMAM (gerçek tarayıcı testi)

En pahalı arızalar kod okunarak görünmüyordu: 14 Temmuz'da Guardian tüm siteyi
kapattı (her fonksiyon tek başına doğruydu; bozulan, proxy arkasında gerçek IP'yi
kaybeden zincirdi), 2 Eylül'de build'ler bir gün boyunca düştü ve canlıda eski
sürüm kaldı. İkisini de **tarayıcı istekleri** ortaya çıkardı, kod incelemesi
değil.

Playwright kuruldu; `e2e/tanitim.spec.ts` **10 test**, Chromium, GitHub
Actions'ta ayrı bir iş olarak koşuyor. Dağıtım kapısına **bilerek konmadı**:
tarayıcı indirmesi her dağıtımı yavaşlatır ve bu testler dağıtımın *ürettiğini*
değil, *göründüğünü* denetler.

Kapsam: `vite preview` ile **build edilmiş** site (dev sunucusu değil — dağıtılan
dosyanın açıldığını görmek istiyoruz). Denetlenenler: ana sayfa boş sayfa
değil ve konsol hatası yok; `<title>` ve meta açıklama var; tam bir `h1`;
**dört zorunlu hukuki sayfa** (mentions légales, confidentialité, CGU,
accessibilité) erişilebilir ve dolu; footer bağlantısı çalışıyor; bilinmeyen
adres kullanılabilir bir 404 veriyor; mobilde yatay taşma yok.

Hukuki sayfalar sıradan içerik değil, yükümlülük: boş veya 404 bir sayfa onları
dayanaksız kılar ve bunu başka hiçbir bariyer görmez.

### Testlerin yakaladığı ilk şey benim testlerimdi
İlk koşuda dört hukuki sayfa "boş" düştü — 223 karakter. Sayfa gerçekten boş
değildi: `lazy()` ile kod-bölünmüşler ve Suspense fallback'i **boş bir div**,
yani `goto` sonrası okunan metin yalnızca çerez bandıydı. Aynı zayıflık
navigasyon testinde de vardı: "gövdede metin var" iddiasını çerez bandı tek
başına karşılıyor ve test, hiçbir şey render etmemiş bir sayfada yeşil
yanabiliyordu. İkisi de artık `h1`'i bekliyor — bu aynı zamanda kod parçasının
gerçekten yüklendiğini de doğruluyor.

### Kapsam dışı, bilerek
Kimlik doğrulamalı uygulama tohumlanmış bir veritabanı ve test hesabı istiyor.
Yarım yapılacak bir şey değil; ayrı bir iş olarak durmalı.

## Faz 6 — TAMAM (temizlik) + iki karar kullanıcıda

### Temizlenenler
- **`schema_files_aa` … `schema_files_aq`** silindi: 17 dosya, tamamı bir
  `split` çıktısı — içlerinde yalnız şema dosyalarının **isimleri** var. Hiçbir
  şey onlara bakmıyordu.
- **`cloud-sql-proxy.exe` (32 MB) izlemeden çıkarıldı** ve `.gitignore`'a
  eklendi. `git rm --cached` ile: **yerel dosyan duruyor**, sadece depoda
  taşınmıyor. Güvenli olduğu doğrulandı — `deploy/gcp-schema-push.sh` zaten
  yoksa kendisi indiriyor (satır 33-48).

  Not: bu dosyayı HEAD'den çıkarmak **geçmişten silmez**; 32 MB blob commit
  geçmişinde duruyor. Geçmişi yeniden yazmak (`filter-repo`) klonu olan herkesi
  etkiler, o yüzden tek taraflı yapmadım.

### Karar bekleyen iki şey — bilerek dokunmadım

**1. `apps/api-py` (44 Python dosyası).** `pyproject.toml`'un kendi tarifi:
*"Python (FastAPI) rewrite of the Ajant Bureau Express API — Phase 1
foundation"*. Son gerçek çalışma 14-16 Temmuz; Eylül'deki dokunuş yalnız depo
geneli bir yeniden adlandırma. **CI'da hâlâ test ediliyor, hiçbir yere
dağıtılmıyor.**

Bu bir mimari karar, temizlik değil. Yaşayan bir plansa yol haritasına girmeli
ve neden beklediği yazılmalı; değilse silinmeli. Arada kalması en kötüsü: her
build'de zaman harcıyor ve okuyan herkese "acaba Express tarafı mı ölüyor?"
sorusunu sordurtuyor. **Silmedim — gerçek bir emek ve senin kararın.**

**2. `attached_assets` (9.8 MB, 46 dosya).** Replit dönemi ekran görüntüleri ve
yapıştırılmış metinler; koddan hiçbiri referans almıyor. Ama içlerinde ürün
şartnamesi gibi duran Türkçe belgeler var ("BTP Operasyonel Risk ve Maliyet
İstihbarat Motoru" gibi). Kullanılmıyor olması değersiz olduğu anlamına gelmez;
**senin malzemen, silmek benim kararım değil.**

## Faz 7 — TAMAM (yenilik: harcamanın kime ait olduğu görünür oldu)

Yenilik listesindeki ilk madde "kiracı-başına AI maliyet paneli"ydi. Bakınca
panel **zaten vardı** — `/ai-usage/summary` jetonları, maliyeti, modelleri,
rotaları, günlük dağılımı ve son hataları veriyor. Eksik olan tek şey vardı ve
tam da bugünkü işin çekirdeğiydi: **kimin ödediği.**

Bu, ekleme değil düzeltmeydi. 2 Eylül'e kadar müşterinin yapıştırdığı anahtar
hiçbir yerde okunmuyordu; tüm çağrılar platform kredisinden gidiyordu ve panel
bu tutarları **müşterinin harcaması gibi** gösteriyordu. Doğru bir sayının
yanlış hesaba yazılması, sayının hiç olmamasından kötüdür — çünkü ona inanılır.

- `/ai-usage/summary` artık `billing` alanı döndürüyor.
- Yeni `/ai-usage/key-status`: ayar ekranı tek çağrıda "kendi anahtarın
  kullanılıyor mu?" sorusunu sorabiliyor — ve cevap **"hayır" olduğunda da**
  söylüyor, ki düzeltilebilsin.

Bu aynı zamanda ilk fazda yazıp **hiçbir yerde kullanmadığım** `getAiKeyStatus`'u
devreye alıyor: yazılmış ama bağlanmamış kod, bu depoda tam da bugün düzelttiğim
hatanın şekli.

**6 uçtan uca test** (gerçek veritabanı + oturum): kendi anahtarı olan/olmayan
iki organizasyon, oturumsuz 401, ve **anahtarın kendisinin asla sızmadığı** —
yapılandırma ekranını ekransızlıktan tehlikeli yapacak tek şey odur.

Rota envanteri yeniden üretildi: **652 rota** (`routes:write`). Bu adım
unutulduğunda dağıtım bir gün boyunca sessizce durmuştu.

Toplam **875 test geçti**.

### Faz 7'de kalan yenilik adayları (yapılmadı)
- RGPD taşınabilirlik / unutulma hakkı akışının tamamlanması
- Factur-X (Faz D, zaten bekliyor)
- Arayüz erişilebilirlik denetimi (EAA) — `sellability-audit` ajanı bunun için

## Koruma ilk build'de kendi hatasını yakaladı — 2026-09-02

`f58f5717` dağıtımı **başarısız** oldu. Sebep, kod değil, Faz 4'te yazdığım
korumanın kendisiydi: `whatsapp_messages` ve `whatsapp_processed_messages`
tablolarını "silinecek" sanıp build'i durdurdu.

**Ve tam da bunun için oradaydı.** Hattaki çağrının gerekçesini yazarken şöyle
demiştim: *"CI veritabanı az önce senkronlandığı için hiçbir şey bulmamalı; bir
silme bildiriyorsa bozulan şey şemanın kendisi değil, korumanın şema
okumasıdır."* Bu, ilk build'de aynen gerçekleşti.

**Kusur:** ayrıştırıcım tablo gövdesini **sütun 0'daki** `\n}` ile kapatıyordu.
Çok satırlı biçimi — çağrının bölündüğü ve kapanış parantezinin girintili
olduğu hali — sessizce atlıyordu:

    export const t = pgTable(
      "whatsapp_messages",
      { ... },
    );

**Düzeltme:** regex yerine parantez sayma. Bir mizanpaj varsayan düzenli ifade
kod okuması değildir; parantez saymak öyledir.

### İkinci, daha sinsi sonuç
**Aynı regex `tenant-scope-check.mjs`'te de vardı.** Yani Faz 2'nin "sızıntı
yok" sonucu, iki kiracı tablosunu **hiç görmeden** verilmişti. Koruma bir
build'i düşürerek kendini ihbar etti; kiracı kontrolü ise süresiz susacaktı.

Düzeltince kontrol hemen kör olduğu yeri gösterdi:
`whatsapp.ts markProcessed`. İncelendi ve **meşru** — `whatsapp_processed_messages`
Twilio'nun evrensel benzersiz `MessageSid`'i ile kapanıyor, ki o tablonun
birincil anahtarı; organizasyon filtresi hiçbir şey eklemez ve organizasyon
çözülmeden gelen bir rejeuda tekilleştirmeyi bozardı. Gerekçesiyle kaydedildi.
Blok sayısı 624 → **626**, açıklanmayan **0**.

### Regresyon testi
Sabit bir sayı tutmuyor (bir sonraki tabloda bayatlardı): depodaki **her**
`pgTable("...")` korumanın okumasında bulunmalı. Okunmayan bir tablo, korumayı
iki yönde birden tehlikeli yapar — meşru poüşeleri bloke eder, ve asıl
korumadığı tabloları korumaz.

**877 test geçti.**

---

## 2026-09-03 — Satılabilirlik: hukuki belgeler ve erişilebilirlik

Faz 7'nin "kalan yenilik adayları" listesinde duran iki madde bu gün kapandı.
Her ikisi de **ürünü satılabilir kılan** cinsten: yokluğu bir özelliği eksik
bırakmıyor, satışın kendisini hukuka aykırı hale getiriyor.

### Satış öncesi zorunlu belgeler yayında

- **CGV (satış koşulları)** — `artifacts/tanitim/src/pages/cgv.tsx`. Uzaktan
  satışta tüketici/profesyonel ayrımı, cayma hakkı, fiyat ve süre koşulları.
- **RGPD işleme sözleşmesi (DPA)** — `artifacts/tanitim/src/pages/dpa.tsx`,
  287 satır. Madde 28.3 bunu **yazılı** olarak zorunlu kılıyor; yokluğunda
  ihlalde olan taraf **müşteri**. Kurumsal alımlarda satın alma biriminin
  istediği ilk belge de budur, ve ana sayfa var olmayan bir belgeyi vaat
  ediyordu.

  En çok özen isteyen kısım ek 1 idi ve formalite değil: telefon/mesajlaşma
  sağlayıcıları (Twilio, Telnyx, Plivo, Vonage, Sinch, Bandwidth) **müşterinin
  kendi kimlik bilgileriyle** bağlanıyor — kuruluş başına saklanıyor, yayıncının
  ortamında değil — dolayısıyla yayıncının alt-işleyeni **değiller**. Platform
  anahtarları (`RESEND_API_KEY`, `GEMINI_API_KEY` vb.) ise öyle. AI
  sağlayıcıları, müşterinin kendi anahtarını girip girmediğine göre iki tarafa
  da düşebiliyor.

Böylece yasal sayfa seti tamamlandı: mentions légales, CGU, **CGV**,
confidentialité, **DPA**, accessibilité.

### Erişilebilirlik: isimsiz buton borcu sıfırlandı

İkon-butonların erişilebilir adı yoksa ekran okuyucu yalnızca "buton" diyor —
WCAG 2.2 4.1.2 (A seviyesi). Avrupa Erişilebilirlik Yasası (EAA) bunu bir
incelik değil, **satış koşulu** yapıyor.

Önceki iki tur sayıyı 105 → 39'a indirmiş, orada durmuştu; kalan dosyaları
başka oturumlar tutuyordu. O iş birleşince engel kalmadı:

- **39 → 0**, ve bütçe de sıfıra çekildi. Sıfır tavan, bir sonraki isimsiz
  ikon-butonu doğrudan başarısız teste çeviriyor — regresyonun saklanabileceği
  bir bakiye bırakmıyor.
- Yalnızca **iki yeni çeviri anahtarı** gerekti (`notificationBell.markRead`,
  `prospectDetail.removeTag`, altı dilde); gerisi zaten var olan `common.*`
  etiketlerini kullanıyor.
- `smart-browser-panel`in beş butonu zaten çevrilmiş bir Tooltip taşıyordu;
  `aria-label` **aynı anahtarı** kullanıyor, ki metin ilk düzenlendiğinde
  seslendirilen ad ile görünen yazı ayrışmasın.

### Dokunma hedefleri: 12 → 2 (WCAG 2.2 2.5.8, AA)

Onu doğrudan 24px'e büyütüldü. On birincisi, proje kilometre taşı kutucuğu,
**14px'lik çizimini koruyor** — büyüyen şey tıklamayı alan **yüzey**; kriter
boyanan piksele değil, tıklamayı karşılayan alana bakıyor.

Kalan 2 borç değil, kriterin kendi istisnası — ve test artık hangisi olduğunu
söylüyor:
- `ui/sidebar.tsx` rayı: sekme sırası dışında (`tabIndex={-1}`) bir yeniden
  boyutlandırma tutamağı; aynı işi yapan SidebarTrigger zaten var → "eşdeğer
  hedef" istisnası.
- `knowledge-base.tsx` atıf rozeti: cümlenin **içinde** duruyor, metin
  satırını takip ediyor → "satır içi" istisnası.

İkisini de 24px'e zorlamak yerleşimi bozar, kimseye bir şey kazandırmaz.

### Aynı gün yapılan diğer işler

- `ci: run the customer app's tests in both gates, and the full schema chain`
- `fix: the invoice dialog crashed the moment a deep link opened an invoice`
- `build: add eslint on a ratchet, and raise three vulnerable dependency floors`
  — cıvata **687 uyarıda** duruyor; erişilebilirlik turu bunu bir tık bile
  yükseltmedi.
- `test: the tenant isolation check could not see raw SQL`
- `fix: the browser headers protected the JSON API, not the application` +
  `test: open the application itself in a browser, under its real headers`

**96 test (müşteri uygulaması) geçti, typecheck temiz.**

### Erişilebilirlik beyanı ölçümle hizalandı (aynı gün)

Yukarıdaki iş, beyanı kendisi eskitti: sayfa hâlâ "arayüz bileşenlerinin
erişilebilir adı tümüyle doğrulanmadı" diyordu, bu artık doğru değildi. Beyan
şimdi ne tuttuğunu ve ne tutmadığını ayırıyor; uygunluk durumu **değişmedi**
(hâlâ *non conforme*, hâlâ oran yok — zorunlu örneklem üzerinde RGAA denetimi
yapılmadı, oran ilan etmek yanlış beyan olurdu).

Asıl kazanç sayfa değil, **yeni `accessibilite.test.ts`**: halka söylenen
rakamlar onları üreten `a11y-budget.test.ts` bütçelerine bağlandı. Bu sapmanın
hiçbir belirtisi yoktu — sayfa render olmaya devam eder, tip kırılmaz, yerleşim
oynamaz. Testin yakaladığı, bütçeler 1 ve 3 yapılarak kanıtlandı.

## 2026-09-03 — RGPD akışı: kişi kendi verisini alabiliyor, talep kapatılabiliyor

Faz 7'nin kalan listesindeki "RGPD taşınabilirlik / unutulma hakkı akışı"
maddesi. Bulgu okuyarak değil, **grep'le** çıktı: `data_subject_requests`
tablosu depoda **yalnızca INSERT ve SELECT** ediliyordu, hiçbir yerde UPDATE
edilmiyordu.

### İki yarım, aynı boşluk

1. **Talep açılıyor, asla kapanmıyordu.** Kayıt `pending` girip sonsuza dek
   orada kalıyordu — API'nin kendi cevabı kişiye "30 gün içinde yanıt"
   sözü verirken. `processedAt`, `processedByName`, `responseNotes` kolonları
   zaten vardı, **kimse yazmıyordu**: bu deponun tekrar tekrar bulduğu hatanın
   tam şekli — yazılmış, bağlanmamış kod.

   Madde 12(3) bir ay veriyor ve **gecikme ihlalin kendisi**; ama süre hiçbir
   yerde temsil edilmiyordu. Hiçbir şey son tarihi hesaplamıyordu, dolayısıyla
   hiçbir kuruluş zaten ihlalde olup olmadığını göremiyordu.

2. **Sıradan çalışan kendi verisini alamıyordu.** Tek export, kuruluşun TÜM
   dosyasını döndürüyor ve yöneticilere kısıtlı — haklı olarak, çünkü madde 20
   kişinin *kendi* verisi üzerinde bir hak, işverenin müşterileri üzerinde
   değil. Geriye kalan: arayüzde ilan edilmiş, uçtan uca **uygulanamaz** bir
   hak, çünkü elle talep kanalı da kapatılamıyordu.

### Yapılanlar

- **`GET /data-protection/my-data`** — her kimliği doğrulanmış kullanıcıya
  açık. Ayrım işin çekirdeği: kişi **hakkındaki** veriyi döndürüyor, kişinin
  yalnızca **girdiği** veriyi asla. Kişiler, aramalar, görevler ve prospect'ler
  `createdBy` taşıyor; onları buradan servis etmek, `/export`'un kısıtlanmasıyla
  kapatılan CRM sızdırmasını bireysel hak kılıfında geri açardı — üstelik bu
  rotada hiç rol koruması yok.

  Kolonlar tek tek sayılıyor, asla çıplak `select()` değil: bu tablolar parola
  özeti, MFA sırrı, sıfırlama jetonları, Google OAuth jetonları ve cihaz
  bildirim jetonu tutuyor — ve RGPD export'u tam da dışarı verilen şey. Google
  için yalnızca bağın **varlığı** dönüyor: hesabın bağlı olması kişisel veri,
  jetonlar ise erişim kimlik bilgisi.

- **`POST /data-protection/requests/:id/process`** — yönetici sonucu kaydediyor.
  Ret bir başarısızlık değil, hukuken geçerli bir sonuç; madde 12(4) o zaman
  **gerekçe** ve şikâyet hakkının hatırlatılmasını zorunlu kılıyor. Bu yüzden
  reddederken not zorunlu: sessiz bir ret ihlalin kendisi olur ve ihmalden
  ayırt edilemez. `organisationId` ile sınırlı, ve yalnızca hâlâ `pending` olan
  bir talep yazılabiliyor — kimin ne zaman ne yanıtladığının izi sonradan
  yeniden yazılamasın diye.

- **Bir aylık süre** artık türetiliyor ve talebin göründüğü her yerde
  gösteriliyor; "bekleyen" sayısının yanında bir de **gecikmiş** sayacı var.
  Saklanmıyor, türetiliyor: başvuru tarihinin fonksiyonu, ve bir kolon ondan
  sapabilirdi.

### Silme (madde 17) bilerek otomatikleştirilmedi

Madde 17(3), saklama bir yasal yükümlülük gereğiyse silme hakkını devre dışı
bırakıyor. Bu ürün böyle yükümlülükler taşıyor ve bunları **kendi** summary
ucunda ilan ediyor: pointage'lar "5 ans (obligations légales)", muhasebe
belgeleri ticaret kanunu kapsamında. Kör bir cascade ya yasanın saklamayı
emrettiğini yok ederdi ya da silmiş gibi yapardı. İkisi de ihlal, birincisi
geri alınamaz. Bu takas yayıncıya ait, bu dosyaya değil — talep izleniyor,
tarihleniyor ve ne yaptığını yazan bir insan tarafından açıkça kapatılıyor.

### Doğrulama

**On test, her biri korumasını kaldırınca düştüğü kanıtlanmış**: tenant
filtresini silmek, rol korumasını kaldırmak ve export'a `passwordHash` eklemek
— üçü de takımı kırmızıya çeviriyor. Rota envanteri yenilendi (652 → **654**);
bu adım unutulduğunda dağıtım bir gün boyunca sessizce durmuştu.

eslint cıvatası bu iş sırasında **bir yeni uyarı yakaladı**; tavan
yükseltilmedi, uyarı düzeltildi — hâlâ tam 687.

### Buradan sonrası

- Factur-X (Faz D, hâlâ bekliyor)
- `apps/api-py` kararı (Faz 6'da kullanıcıya bırakılmıştı, hâlâ açık)
- Silme akışının yayıncı kararı: hangi veri anonimleştirilir, hangisi yasal
  süre dolana dek saklanır — koda dökülmeden önce cevaplanması gereken soru

---

## 2026-09-03 — Dağıtım indi, ve doğrularken hep-yeşil bir test bulundu

PR #1 `main`'e alındı (`af542f0`), bölgesel trigger dağıtımı yaptı:
build **SUCCESS**, `/api/healthz` → `"build":"af542f0"`, yeni revizyon
`agent-de-bureau-api-00282-znc`. Canlıya inenler: CGV + DPA, erişilebilirlik
turu, RGPD akışı, ve gün içindeki düzeltmeler.

### Doğrulama sırasında çıkan asıl bulgu

Playwright suite'i localhost'a çiviliydi: "kod doğru" diyebiliyordu, **"servis
edilen bu kod"** diyemiyordu. `playwright.config.ts`'in kendi yorumu 2 Eylül
için "canlı eski kaldı ve hiçbir şey bunu söylemedi" diyor — suite de
söyleyemiyordu. `VITRINE_BASE_URL` / `APP_BASE_URL` eklendi; bunlar verilince
ilgili yerel sunucu başlatılmıyor (yoksa kimsenin bakmadığı bir kopya
dakikalarca derlenir, ve canlının hatası yerel build'in hatası gibi görünürdü).

**İlk kullanımda daha kötü bir şey çıktı.** Suite, `/cgv` ve `/dpa` daha
dağıtılmamışken canlıya karşı çalıştırıldı: "pages obligatoires"in **altı testi
de geçti** — ikisi, o an internette **var olmayan** sayfalar için.

Sebep: bu bir tek-sayfa uygulaması. Bilinmeyen bir adres **HTTP 200** dönüyor,
bir `<h1>` gösteriyor ("Page introuvable") ve **333 karakter** ağırlığında —
eşik olan 300'ün hemen üstünde. Üç iddia da **herhangi bir adres** için doğruydu.

Test tam olarak eksik bir hukuki sayfayı yakalamak için vardı — kendi yorumu
"bunu depoda başka hiçbir şey doğrulamaz" diyor — ve göremediği tek durum
buydu. **Hep yeşil bir test, testsizlikten kötüdür: kanıt yerine geçer.**

Düzeltme: her sayfa artık **kendi başlığını** render etmek zorunda; gerçek
sayfayı hata sayfasından ayıran tek şey bu. İki yönde de canlıya karşı
kanıtlandı — dağıtımdan önce suite tam olarak `/cgv` ve `/dpa`'da düştü,
diğer dördünde geçti; dağıtım indikten sonra on ikisi de geçti.

### Bundan çıkan kural

Bir testin geçmesi, ölçtüğü şeyin var olduğunu göstermez. Bu depoda aynı ders
üçüncü kez çıkıyor (erişilebilirlik bütçesi 16 sanıyordu, gerçek 105'ti;
`getAiKeyStatus` yazılmıştı, çağrılmıyordu; şimdi bu). Yeni bir koruma
yazıldığında, **kaldırıldığında düştüğü** de ayrıca gösterilmeli.

---

## 2026-09-03 — Faz D: fatura artık yapısal veri olarak da çıkıyor

Fransa'nın elektronik fatura reformu **1 Eylül 2026'da** yürürlüğe girdi. Code
de commerce'e ne kadar uygun olursa olsun bir PDF, reform anlamında artık
elektronik fatura değil: aynı olguların **makinece okunabilir** biçimde de
gitmesi gerekiyor. Factur-X bunu tek dosyayla çözüyor — insan PDF'i okur,
makine içine gömülü CII XML'ini.

### Engel olduğu sanılan şey engel değilmiş

Yol haritası Faz D'yi "pdfkit dosya gömmeyi desteklemiyor" gerekçesiyle
bekletiyordu. **Ölçtüm, öyle değil**: pdfkit 0.18 gömüyor ve `/EmbeddedFiles`,
`/Filespec`, `/AFRelationship /Data` üretiyor. Yeni kütüphane gerekmedi.

Gerçek engel başka yerde ve çok daha dar — aşağıda.

### Yapılanlar

- **`services/facturx.ts`** — saf modül, CII XML'ini **aynı**
  `buildInvoiceDocument`'ten üretiyor ve hiçbir şeyi yeniden hesaplamıyor. İki
  paralel hesap er geç ayrışır, ve bir PDF ile kendi XML'inin çelişmesi tam da
  bir denetimin aradığı şeydir.
- **Profil: BASIC.** Satır detayı taşıyan ilk seviye, ve üründe zaten var.
  MINIMUM/BASIC WL yalnız toplam gönderirdi. EN 16931 (COMFORT) iddia etmek,
  modelin veremeyeceği alanları (alıcı referansı, kodlu ödeme yöntemi) vaat
  etmek olurdu — **tutulamayan bir profil, mütevazı olandan kötüdür.**
- **`GET /factures-client/:id/facturx.xml`** — XML'i tek başına servis ediyor;
  PDP ve Chorus Pro'nun tükettiği şey bu. PDF rotası da aynı XML'i ekli
  taşıyor, **aynı istekte aynı kayıttan** üretilerek: iki ayrı çağrı olsaydı
  ek, faturanın eski bir sürümünü anlatabilirdi ve bu hiçbir ekranda görünmezdi.
- **TVA kategori kodları** işin sonucu ağır olan kısmı: **vergiyi kimin
  borçlandığını** söylüyorlar. Otoliquidation `AE`'dir, `S` değil — `S` olarak
  gönderilirse müşteri hiç faturalanmamış bir TVA'yı indirir, üstelik PDF
  Fransızca doğru mention'ı göstermeye devam eder. Kategori `S` değilse
  muafiyet gerekçesi her zaman var (BR-E-10 / BR-AE-10 / BR-Z-10).
- **Adresler** elden geldiğince yapılandırılıyor, **başarısızlık uyduruluyor
  değil bildiriliyor**: yanlış tahmin edilen bir posta kodu başkasının
  muhasebesine kadar gider.

### Bilerek iddia EDİLMEYEN şey: PDF/A-3 uygunluğu

Factur-X PDF/A-3 şart koşuyor ve onun merkezi kurallarından biri **bütün
fontların gömülü olması**. pdfkit `subset: "PDF/A-3b"` üretebiliyor, ama burada
kullanılan standart fontlarla **hiçbir font dosyası gömmüyor** — ölçüldü,
çıktıda tek bir `/FontFile` yok. Yani belge, ihlal ettiği bir uygunluğu
**beyan** ederdi.

Bu, aynı gün test tarafında düzeltilen "hep yeşil" hatasının ta kendisi olurdu —
üstelik hukuki bir belge üzerinde. **Bir test bu iddianın yokluğunu kilitliyor.**

Kalan adım küçük ve belli: gömülebilir özgür bir font eklemek, sonra `subset`'i
açmak. Ama bu depoya bir ikili dosya ekler ve hukuki bir belgenin görünümünü
değiştirir — **yayıncının kararı.**

### Doğrulama

**53 test.** Gözle görünmeyen ve her şeyi belirleyen iki özellik — ekin zorunlu
dosya adı ve `/AFRelationship /Data` — kaldırıldığında takımın düştüğü ayrı ayrı
kanıtlandı. Rota envanteri 654 → **655**, typecheck temiz, eslint cıvatası bu
işin doğurduğu tek uyarı düzeltildikten sonra yine tam **687**.

### Buradan sonrası

- **Yayıncı kararı**: gömülebilir font → gerçek PDF/A-3b → tam Factur-X uygunluğu
- Chorus Pro / PDP iletimi (ayrı adım, alıcı tarafı)
- `apps/api-py` kararı (Faz 6'dan beri açık)
- Silme akışının yayıncı kararı (RGPD, 2026-09-03 bölümü)

## 2026-09-03 — Silinen veri geri gelebiliyor, ve yazılıp bağlanmayan kod kuralla kapatıldı

Aynı gün, aynı kökten çıkan beş iş (PR #5–#9, hepsi main'de). Ortak kök iki
tane: **hiçbir silme geri alınamıyordu**, ve **yazılmış ama hiç çağrılmayan kod**
bu depoda tekrar eden bir kusur — belirtisi yok, derleniyor, sunucu kalkıyor,
hiçbir şey düşmüyor; sadece iş yapılmıyor.

### 1. Yazılıp bağlanmayan purge (PR #5)

`purgeOldSecurityScans` 23 Temmuz'da, "tablo sınırsız büyüyor" yorumuyla
yazılmış ve **altı hafta boyunca hiç çağrılmamış**. Mesele disk değil: her satır
bir `userId` ve bir `target` taşıyor — analiz edilen dosya, adres veya numara,
gelen e-posta ve WhatsApp ekleri dahil. Yani **süresiz tutulan kişisel veri**,
madde 5.1.e'nin yasakladığı şey ve `retention-cron`'un tam da uygulamak için
yazıldığı ilke. Bu yüzden kendi döngüsünü almadı, o cron'a katıldı: Cloud Run'da
`min-instances=0` ile gerçekten çalışan tek şey kayıt (registry) üzerinden
tetiklenen iş.

**Asıl kazanç düzeltme değil, kural**: `purge-wiring.test.ts` her dışa açık
purge/cleanup/prune fonksiyonunun en az bir çağrı yeri olmasını zorunlu kılıyor,
ve bu vakayı yakaladığı mutasyonla kanıtlı. İlk sürümü ters yönde yanlıştı —
tanımlayan dosyayı saymadığı için hemen üstündeki döngüden çağrılan
`purgeExpiredCallRecordings` ve `purgeOldAiUsage`'ı suçluyordu. Dosya değil
**çağrı yeri** saymak bunu çözdü. `DELIBERATELY_UNWIRED` haritası boş: bir
istisna eklemek, o purge'ün neden çalışmadığını **yazmayı** zorunlu kılıyor —
altı hafta boyunca eksik olan bilgi tam buydu.

### 2. Beyan edilmeyen veri kategorisi (PR #6)

`security_scans` `/data-protection/summary`'de hiç görünmüyordu. Bir envanterin
eksik kategorisi madde 13/14 anlamında eksik bilgilendirmedir ve **görünmez**:
ekran kendisine verilen kategorileri sadakatle çiziyor. Bunu bir gün önce
"yayıncının hukuki kararı" diye bırakmıştım — yanlış içgüdü, çünkü soru
araştırılabilir bir soruydu.

Hukuki dayanak tahmin değil: **Gerekçe 49**, "güvenlik teknolojileri ve
hizmetleri sağlayıcıları"nın "ağ ve bilgi güvenliğini sağlamak için kesinlikle
gerekli ve ölçülü" işlemesini meşru menfaat olarak adıyla anıyor — madde
6(1)(f).

Süre 90 gün, ve beyan **purge'ün uyguladığı sabiti okuyor**
(`SECURITY_SCAN_RETENTION_DAYS`), sayıyı tekrar yazmıyor. Bağlama işin bütün
amacı: iki dosyada yaşayan ve kimsenin yan yana okumadığı iki sayı, beyan edilen
sürenin uygulanandan sapmasının tam yolu. Cıvata, sabit değer tesadüfen tutsa
bile düşüyor — mutasyonla kanıtlandı.

Kayda geçsin: 90 gün, CNIL'in loglama için önerdiği **altı ay–bir yıl
aralığının altında** (délibération n° 2021-122). Bu bilerek: öneri bir ihtiyat
tavanı, minimizasyon ters yöne bastırıyor, ve ödün — üç aydan eskisi için olay
sonrası analiz yok — örtük bırakılmayıp yazıldı. Kişinin kendi taramaları artık
bireysel ihracatında da var (madde 15 kendisine ilişkin veriyi kapsıyor); motor
ve kaynak kolonları dışarıda kaldı, çünkü onlar bireyi değil altyapıyı anlatıyor.

### 3. Çöp kutusu: yanlışlıkla silmenin geri dönüşü (PR #7)

Yanlışlıkla silmeye karşı **hiçbir koruma yoktu**. Sunucu tarafındaki 42 silme
kesin, hiçbir tablo `deleted_at` taşımıyor, ve tek başvuru günlük yedekti — ki o
da kimsenin düşene kadar görmediği bir boşluk bırakıyor: **iki yedek arasında
oluşturulup silinen şey, o kişi için hiç var olmamıştır.** Sabah yazılıp öğleden
sonra silinen fatura gitmiştir; üstelik geri yükleme yöneticilere ayrılmışken,
hatayı yapan kişi genelde o role sahip olmayan kişidir.

**Karar: `deleted_at` bayrağı değil, yanda bir günlük.** Silinen satır JSON
olarak `deleted_rows`'a bütün halinde yazılıyor. Ödün bilerek verildi: bir
bayrak depodaki **her okumayı** filtrelemeye zorlar, ve unutulan tek sorgu
silinmiş veriyi geri getirir — ya da bir toplamda iki kez sayar. Burada mevcut
hiçbir okuma değişmiyor; satır tablosunu gerçekten terk etmiş oluyor.

İki kural `tenant-restore`'dan geliyor ve yeniden tartışılmadı: yalnız onun
listesindeki tablolar geri gelebilir — asla `users`, `api_keys` veya abonelikler,
çünkü silinmiş bir hesabı veya aboneliği geri koymak hizmet değil **atlatma**
olurdu — ve ekleme yalnızca **EKLER** (`ON CONFLICT DO NOTHING`),
`organisation_id` zorlanmış olarak. Veriyi korumak için yazılmış bir özelliğin
en kötü sonucu, veri kurtardığını söyleyerek veri bozmak olurdu.

Sayfa bilerek **herkese açık**: yalnız yöneticinin açabildiği bir çöp kutusu,
hatayı henüz yapmış kişiye yardım etmez. Saklama süresi 30 gün
(`TRASH_RETENTION_DAYS`) ve purge retention cron'a bağlı — süresi olmayan bir
kutu, kimsenin bakmadığı ikinci bir kişisel veri deposudur (md. 5.1.e).

**Gerçek veritabanı testi yerini anında hak etti**: bütün statik kurallar
geçerken geri yükleme **çalışmıyordu**. `.returning()` JavaScript alan adlarını
veriyor (`organisationId`), yeniden ekleme kolon adı istiyor (`organisation_id`)
— yani kayıt ekranda kusursuz görünüp geri yüklemede düşüyordu, kusurun en kötü
biçimi: vermeyeceği şeyi tam olarak vaat ediyor. Yardımcı fonksiyon artık tablo
**adını değil tablonun kendisini** alıyor, eşlemeyi ve adı ondan türetiyor —
böylece hiçbir çağıran `devis` satırlarını `factures_client` etiketiyle
arşivleyemiyor.

Mevcut iki cıvata bu işi yakaladı ve ikisinde de haklıydı: yedek kapsamı testi
yeni tablonun dahil edilmesini istedi, asistanın rota envanteri yeni sayfanın
kaydını istedi. İkisi de susturulmadı, uygulandı.

### 4. Eksik tek tablo, herkesin yedeğini siliyordu (PR #8)

Sabah bir tablo eklemek neredeyse **her müşterinin günlük yedeğini bozuyordu**,
ve bu benim eserim olacaktı.

Deploy hattı üretimi migrate etmiyor: kalite kapısı CI veritabanını eşitliyor,
üretim ayrıca çalıştırılan bir `gcp-schema-push.sh` ile güncelleniyor. Yani
**her yeni tablo, dağıtılmış kodun veritabanının bilmediği bir tabloyu bildiği
bir pencere açıyor.**

O pencerede yedek bozulmuyordu — **yok oluyordu**. Beyan edilen tablolar
üzerindeki döngü hiçbir şey yakalamıyordu, tek bilinmeyen tablo **bütün
organizasyonlar için** bütün yedeği iptal ediyordu, hem de onların verisiyle
hiç ilgisi olmayan bir nedenle. Kimse fark etmezdi — biri geri yüklemeye
çalışana kadar, ki bu bunu keşfetmek için mümkün olan en kötü an.

Artık yalnız **42P01** (undefined_table) yakalanıyor: bağlantı hatası veya yetki
sorunu yedeği hâlâ düşürüyor, çünkü onlar tek tabloyla sınırlı olmaz ve
saklanmaları kimsenin sorgulamadığı boş dosyalar üretir. Eksik tablo hata olarak
loglanıyor ve üretilen dosyada `meta.unavailableTables` altında adıyla yazılıyor.
**Eksik olduğu bilinen bir yedek hâlâ işe yarar; kendini tam sanan bir yedek
tuzaktır.**

Tablo listesi parametre oldu — esneklik için değil, **bunu test edilebilir
kılmak için**. Aksi halde bu yolu denemenin tek yolu gerçek bir tabloyu düşürmek
olurdu, yani davranış tam da önemli olduğu yerde doğrulanmamış kalırdı. Test
durumu gerçekten yaratıyor ve Postgres'in mesajını değil **hata kodunu** okuyor
(mesaj sunucu diline göre çevriliyor). Mutasyonla kanıtlı: `catch` kaldırılınca
takım kızarıyor.

### 5. Kapsam bütçesi kurala çevrildi — ve sabahki hatam (PR #9)

İki şey, ve birincisi aynı sabah benim gönderdiğim bir hata: **tasks rotası çöp
kutusuna arşivlemeyi DELETE değil GET handler'ında yapıyordu.** Bir görevi
okumak onu silinmiş diye kaydediyor, silmek hiçbir şey kaydetmiyordu. Betiğim
dosyadaki ilk `if (!task)` bloğunu eşleştirmişti — o blok okuma yoluna ait — ve
testim bunu **göremezdi**: dosyanın `archiveDeletedRows(tasksTable` **içerdiğini**
doğruluyordu, ki bu doğruydu — yanlış fonksiyonda. Mutasyon kontrolü de aynı
nedenle geçti. **Bir dosyada bulunmak, doğru handler'da bulunmak değildir**, ve
sayı temelli kapsam testi de bunu asla göremezdi.

Bu yüzden kapsam testi **tavan yerine kural** oldu: rotalardaki her
`db.delete(XTable)`'ı okuyor, tabloyu veritabanı adına eşliyor, ve tablo geri
yüklenebilirse **aynı route handler'ı içinde** bir arşivleme çağrısı istiyor.
"En fazla 36 kapsanmamış" bütçesi, o 36'nın yapılacak iş mi kapsam dışı vaka mı
olduğu hakkında hiçbir şey söylemiyordu, ve toplam sabit kaldığı sürece **yeni
bir arşivlenmemiş silmeye sessizce izin veriyordu**. Gerçek kusura karşı
kanıtlandı: çağrıyı okuma handler'ına geri taşı, takım dosyayı ve satırı adıyla
söylüyor.

**Handler sınırı** kendisi de bir düzeltmeydi: sabit birkaç satırlık pencere,
zaten doğru olan dört rotayı suçladı — çünkü çok satırlı bir `.returning()` ve
bir 404 kontrolü silmeyle arşivleme arasına giriyor — ve onları temizleyecek
kadar genişletmek eninde sonunda **bir sonraki rotaya ait** bir arşivlemeyi
kabul ederdi.

Kuralla birlikte kapsam **6 silme noktasından 24'e** çıktı. En çok önemseyeni 14
toplu işlem: tek tık onlarca satırı götürüyor ve hiçbir şey onları
yakalamıyordu. Gerisi — takvim olayları, check-in'ler, belgeler, mesajlar —
insanın yasını tutacağı kalan tablolar. Hâlâ kapsanmayan her şey, zaten geri
getirilemeyen bir tabloyu siliyor: entegrasyon kimlik bilgileri, hesaplar,
yedeklerin kendisi. Onları arşivlemek, çöp kutusunun **geri koyamayacağı** bir
kayıt göstermek olurdu — hiçbir şey göstermemekten kötü — ve `RESTORABLE_TABLES`
bunu zaten çözmüştü.

### Doğrulama

22 çöp kutusu testi, sunucu genelinde 946; kapsanan bütün silme noktalarının
arşivlemesi kaldırıldığında takımın düştüğü ayrı ayrı kanıtlandı, kiracı sınırı
ve kapsam kuralı dahil. Rota envanteri **657**. Beş PR'ın hepsi main'de, son
Cloud Build (13:15) yeşil, site ayakta.

### ⚠️ Buradan sonrası — üretim şeması

`deleted_rows` yeni bir tablo, ve **madde 4'te yazılan pencere şu an açık**:
dağıtılmış kod çöp kutusunu biliyor, üretim veritabanı bilmiyor olabilir. Bu
oturumda `bash deploy/gcp-schema-push.sh` çalıştırılamadı (harness üretim
veritabanı yazmasını engelledi). **Çalıştırılana kadar** çöp kutusu sayfası
üretimde 42P01 verebilir — ve yedekler, PR #8 sayesinde artık bu yüzden yok
olmuyor, sadece o tabloyu `meta.unavailableTables` altında eksik bildiriyor.

**KAPANDI — 2026-09-03 17:11.** Komut repo kökünden çalıştırıldı, push temiz
geçti: `schema-guard` 89 tabloyu karşılaştırıp veri kaybı olmadığını doğruladı,
`drizzle-kit push --force` "Changes applied" verdi, append-only trigger'lar
yeniden kuruldu. Pencere kapandı — dağıtılmış kod ve üretim şeması artık aynı
çöp kutusunu biliyor.

İki ders: (1) komut **repo kökünden** çalışmalı — ilk deneme ev dizininden
yapıldığı için "No such file or directory" verdi; (2) bu adım harness tarafından
iki oturum üst üste engellendi (üretim veritabanına yazma), yani böyle kalan
işler kodda değil izinde bekliyor.

## Canlı akış instance sınırında duruyormuş — 2026-09-03

Faz 1'in kapattığı sanılan bir boşluk açık kalmış. `--session-affinity` bir
tarayıcıyı **tek bir instance'a** sabitliyor, ama olayın nerede DOĞDUĞU hakkında
hiçbir şey söylemiyor: Twilio/WhatsApp webhook'u, cron, ya da bir meslektaşın
işlemi üç instance'tan herhangi birine düşüyor. `broadcaster` süreç-içi olduğu
için kullanıcının canlı akışı yalnız kendi instance'ında doğan olayları
görüyordu — aynı anda bağlı iki çalışan birbirinin işlemlerini görmüyordu, ve
hiçbir yerde hata çıkmıyordu.

### Yanlış çıkan varsayım

`push-notifications.ts` ve `webhook-service.ts` yıllardır "hypothèse
mono-instance: çok instance aynı bildirimi birden fazla kez gönderirdi" diyordu.
Ölçünce korku haklı, sonuç yanlış çıktı: bir olayın **tek** emitörü var — onu
üreten isteği hangi instance servis ettiyse o. Doğru düzeltme bu yüzden
"kilit koymak" değil, uzaktan gelen olayı **yalnız SSE'ye** dağıtmak oldu.

### Yapılan

Postgres `LISTEN/NOTIFY` üzerinden instance'lar arası bir olay yolu
(`lib/db/src/notify.ts` + `services/event-bus.ts`). Yeni bağımlılık yok.

- Uzak olay **sadece** tarayıcı SSE istemcilerine gidiyor; sunucu dinleyicileri
  (mobil push, giden webhook'lar) rejoue edilmiyor — edilseydi aynı push
  instance sayısı kadar giderdi. Eski yorumlar da bu gerçeğe göre düzeltildi.
- Kendi yayınını tanımak için instance kimliği taşınıyor; yoksa her instance
  zaten servis ettiği tarayıcıya olayı ikinci kez yazardı.
- Yayın "fire and forget": bu noktaya gelindiğinde yerel dağıtım çoktan
  yapılmış olur, veritabanı düşerse uzak canlı akış bozulur ama kullanıcının
  işlemi bozulmaz. Bus hatası dakikada bir loglanıyor, her olayda değil.
- `pg_notify`'ın 8000 baytlık sınırı aşılırsa olay yayınlanmıyor (kesilmiyor).
- Dinleme bağlantısı havuzdan **alınmıyor**: `LISTEN` oturuma bağlıdır, havuza
  iade edilen bağlantı aboneliğini taşımaya devam ederdi. Instance başına +1
  bağlantı; bütçe içinde (2 x 3 x 8 = 48 + 6 = 54 / 60).

### Doğrulama

7 yeni test: uzak olayın yerel tarayıcıya ulaştığı, sunucu dinleyicilerini
**tetiklemediği**, komşu organizasyona sızmadığı, relai patlasa bile yerel
dağıtımın sürdüğü, ve gerçek bir Postgres bağlantısından diğerine yükün
taşındığı dahil.

## Formda etiket borcu: ölçüldü, yarısı kapandı, gerisi cırcıra bağlandı — 2026-09-03

Faz 7'nin "yapılmadı" listesindeki **arayüz erişilebilirlik denetimi (EAA)**
kalemine girdim. Kaba sayım "478 alana karşılık 66 `htmlFor`" diyordu; bu bir
bulgu değil sezgiydi, o yüzden ölçen bir script yazdım:
`artifacts/buro-ajani/scripts/a11y-form-labels.mjs`.

### Bulgu

**478 form alanının 382'sinin erişilebilir adı yoktu.** Tipik hâli, hemen
üstünde görünür bir `<Label>` duran ama ona hiç bağlanmamış bir `<Input>`:
ekranda etiket var, ekran okuyucuda yok. İkinci hâli yalnızca `placeholder` —
ki kullanıcı yazmaya başlar başlamaz kaybolur, yani ad değildir. Görsel olarak
hiçbir şey bozuk görünmüyor; sayfa güzel, sadece klavye ve ekran okuyucuyla
kullanılamıyor.

### Yapılan

Aynı satırda etiket-alan komşuluğu olan yerler, etiketin **kendi i18n**
anahtarıyla bağlandı (placeholder anahtarıyla değil — ad, görünen metinle aynı
olmalı): 31 dosyada **204 alan**. Kalan **208**, kapıya bağlandı:
`pnpm --filter @workspace/buro-ajani a11y:check` CI'da koşuyor ve tavan
yükselirse build düşüyor. Yani borç bir daha büyüyemez, her düzeltme tavanı
indirir.

### Neden sıfır değil

382'yi tek seferde sıfırlamak, okunamayacak bir revizyon üretirdi. Cırcır, hemen
işe yarayan şeyi veriyor — gerileme imkânsız — ve kalanı görünür tutuyor.
Script'in sınırı da yazıldı: metin okuyor, sözdizim ağacı değil; boş ya da
anlamsız bir `aria-label` onun gözünden kaçar.

### Doğrulama

tsc temiz, 96 ön yüz testi geçti, üretim build'i başarılı, lint cırcırı 686/687.
