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
- AI Telefon Santrali (Twilio yoksa sabit kodla 403 veriyor — bir org kendi Twilio'sunu
  bağlasa bile devreye girmiyor)
- Otomasyon motorunun SMS aksiyonu (Twilio env yok, sessizce no-op)
- Autonomous Inbox taraması (Gmail OAuth yok — her org için "bağlı Gmail yok" dönüyor)
- Super Agent'ın e-posta ayağı (aynı Gmail OAuth eksikliği)
- OpenAI/Anthropic'e platform-seviyesi yedek anahtar yok (bir org kendi anahtarını
  girmezse sessizce Gemini'ye düşüyor — çalışıyor ama "konsey" tek sağlayıcıya iniyor)

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

### 2. [YÜKSEK] Twilio hesabı bağla (AI telefon santrali için)
- **Neden önemli**: `twilio-voice.ts:110-116` — `TWILIO_AUTH_TOKEN` yoksa prod'da HER
  webhook 403 ile reddediliyor, bir org kendi Twilio kimlik bilgisini uygulama içinden
  girse bile devreye girmiyor. Bu, "sesli AI resepsiyonist" özelliğinin tamamen kapalı
  olduğu anlamına geliyor.
- **Ne gerekiyor**: Twilio hesabı (twilio.com), bir telefon numarası, `TWILIO_ACCOUNT_SID`
  / `TWILIO_AUTH_TOKEN` / `TWILIO_PHONE_NUMBER` Secret Manager'a eklenmeli. Ayrıca
  otomasyon motorundaki SMS aksiyonu (`automation-engine.ts:550-559`) de aynı anahtarla
  aktifleşir.
- **Durum**: Bekliyor — kullanıcı kararı gerekiyor (Twilio hesabı + numara satın alma,
  ücretli).

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
- **OpenAI**: Ayrı hesap şart (Google'da alternatifi yok). Kullanıcı yeni bir API key
  oluşturup verecek, `OPENAI_API_KEY` olarak Secret Manager'a eklenecek.
- **Dosyalar**: `lib/integrations-anthropic-ai/src/client.ts`, `services/ai-providers.ts:223-329`
- **Durum**: Kod tamamlandı — Model Garden onayı + OpenAI key'i bekliyor (kullanıcı).

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

---

## Tamamlanmış işler (referans için)

- ✅ Mobil Origin/CSRF düzeltmeleri (2026-07-13)
- ✅ Backend güvenlik denetimi ve düzeltmeleri (tenant izolasyonu, DoS koruması, bağımlılık
  güncellemeleri) (2026-07-13/14)
- ✅ Cloud Run altyapı sertleştirme (non-root container, güvenlik header'ları) (2026-07-14)
- ✅ Cloud SQL native otomatik yedekleme aktif edildi (2026-07-14)
- ✅ Google Drive otomatik yedekleme kapatıldı (istenmeyen veri akışı) (2026-07-14)
- ✅ E-posta altyapısı (Resend) bağlandı (2026-07-14)
- ✅ Yasal kimlik düzeltmesi (SK GROUP, gerçek SIRET/TVA) (2026-07-14)
- ✅ Custom domain (agentdebureau.fr) Cloudflare'e taşıma — **devam ediyor** (DNS
  yayılması bekleniyor)
- ✅ Google Drive otomatik yedekleme kalıcı olarak kapatıldı, Cloud SQL native yedekleme
  aktif (2026-07-14)
- ✅ Günlük özet artık gerçekten otomatik e-posta gönderiyor (2026-07-14)
- ✅ Vertex AI üzerinden Claude entegrasyonu (kod tamam, Model Garden onayı bekleniyor)
  (2026-07-14)

---

## Notlar

- Bu dosyayı okuyup güncellemek her yeni "otomasyon" görevi öncesi ilk adım olmalı.
- Kullanıcı kararı gerektiren maddeler (1, 2, 3) üçüncü taraf hesap/ödeme gerektirdiği
  için otomatik yapılamaz — sadece kullanıcı onayı + kimlik bilgisi ile ilerlenebilir.
- Kod değişikliği gerektiren maddeler (4, 5) istenirse doğrudan uygulanabilir.
