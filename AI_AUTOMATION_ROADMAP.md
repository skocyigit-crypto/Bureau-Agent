# Tam Yapay Zeka Otomasyonu — Yol Haritası

> Bu dosya, "Agent de Bureau" uygulamasının tam yapay zeka destekli / tam otomasyonlu
> hale gelmesi için yapılan denetimlerin ve kalan işlerin **kalıcı** kaydıdır. Her
> oturumda güncellenir, silinmez — yeni bulgu/tamamlanan iş oldukça buraya eklenir.
>
> Son güncelleme: 2026-07-14 (Vertex AI Claude entegrasyonu + günlük özet cron eklendi)

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

**Şu an canlıda ÇALIŞMAYAN / erişilemez olanlar** (eksik yapılandırma yüzünden):
- Autonomous Inbox taraması (Gmail OAuth yok — her org için "bağlı Gmail yok" dönüyor)
- Super Agent'ın e-posta ayağı (aynı Gmail OAuth eksikliği)
- Anthropic/Claude (Vertex AI) — erişim onaylandı ama kullanım kotası hâlâ sıfır, kota
  artırım talebi bekleniyor (bkz. madde 3)

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
  `https://agent-de-bureau-api-.../api/google-oauth/callback` eklenmeli, sonra
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` Secret Manager'a eklenip Cloud Run'a
  bağlanmalı.
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
  artık `ANTHROPIC_VERTEX_PROJECT_ID` tanımlıysa Vertex AI üzerinden Claude'a bağlanıyor
  (ayrı Anthropic hesabı/API key gerekmez, mevcut GCP faturasına eklenir). Model isim
  çevirisi (`claude-sonnet-4-6` → `claude-sonnet-4.6`) otomatik. Cloud Run servis hesabına
  `roles/aiplatform.user` izni verildi.
  **Kalan tek adım (otomatikleştirilemez)**: Kullanıcının Vertex AI Model Garden'da
  ("console.cloud.google.com/vertex-ai/model-garden" → "Claude" ara → Enable) Anthropic'in
  kullanım şartlarını kabul etmesi gerekiyor — bu bir EULA onayı, API ile yapılamıyor.
  Onaylandıktan sonra `ANTHROPIC_VERTEX_PROJECT_ID=gwmme-1771577941260` env değişkenini
  Cloud Run'a eklemek yeterli.
- **OpenAI — TAMAMLANDI (2026-07-14)**: Bağlandı, Secret Manager üzerinden, `/api/ai/status`
  ile doğrulandı (`available: true`).
- **Anthropic/Claude — erişim onaylandı, kota bekleniyor**: Vertex AI Model Garden'da
  Claude Opus 4.8 için erişim talebi Anthropic tarafından onaylandı (artık 404 yok),
  ama varsayılan kullanım kotası sıfır (429 "Quota exceeded"). Kullanıcının Cloud
  Console → IAM & Admin → Quotas'tan `online_prediction_input_tokens_per_minute_per_base_model`
  (model: anthropic-claude-opus-4-8) için artırım talebi göndermesi gerekiyor.
- **Dosyalar**: `lib/integrations-anthropic-ai/src/client.ts`, `services/ai-providers.ts:223-329`
- **Durum**: OpenAI tamam. Anthropic: kota artırım talebi bekleniyor (kullanıcı).

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

### 7. [DÜŞÜK] Aynı düz-metin deseni AI/e-posta sağlayıcı BYOK anahtarlarında da olabilir

- **Şüphe**: `routes/ai-providers.ts` ve `routes/email-providers.ts`, telephony ile
  birebir aynı `config`/`maskAiConfig`/`maskEmailConfig` desenini kullanıyor
  (madde 6'daki düzeltmeden önceki telephony.ts ile aynı yapı). Muhtemelen aynı
  şifreleme eksikliği burada da var — doğrulanmadı, sadece madde 6'yı düzeltirken
  fark edildi.
- **Durum**: Doğrulanmadı/düzeltilmedi — istenirse kontrol edip aynı deseni
  (`encryptProviderConfig`/`decryptProviderConfig` benzeri) uygularım.

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

---

## Notlar

- Bu dosyayı okuyup güncellemek her yeni "otomasyon" görevi öncesi ilk adım olmalı.
- Kullanıcı kararı gerektiren maddeler (1, 2, 3) üçüncü taraf hesap/ödeme gerektirdiği
  için otomatik yapılamaz — sadece kullanıcı onayı + kimlik bilgisi ile ilerlenebilir.
- Kod değişikliği gerektiren maddeler (4, 5) istenirse doğrudan uygulanabilir.
