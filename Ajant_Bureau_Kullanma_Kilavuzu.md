# Ajant Bureau - Kullanma Kilavuzu

## Icindekiler

1. [Giris](#1-giris)
2. [Hesap Islemleri](#2-hesap-islemleri)
3. [Kontrol Paneli](#3-kontrol-paneli)
4. [Arama Yonetimi](#4-arama-yonetimi)
5. [Kisi Yonetimi (CRM)](#5-kisi-yonetimi-crm)
6. [Gorev Yonetimi](#6-gorev-yonetimi)
7. [Mesajlar](#7-mesajlar)
8. [Musteri Adaylari (Prospects / CRM Pipeline)](#8-musteri-adaylari-prospects-crm-pipeline)
9. [Faturalama](#9-faturalama)
10. [Proje Yonetimi](#10-proje-yonetimi)
11. [Stok Yonetimi](#11-stok-yonetimi)
12. [Takvim](#12-takvim)
13. [Analiz ve Raporlar](#13-analiz-ve-raporlar)
14. [Yapay Zeka Ozellikleri](#14-yapay-zeka-ozellikleri)
15. [Onay Kuyrugu (File d'approbation)](#15-onay-kuyrugu-file-dapprobation)
16. [Sesli Asistan ("Hey Bureau")](#16-sesli-asistan-hey-bureau)
17. [Telefon Sistemi](#17-telefon-sistemi)
18. [Otomasyon](#18-otomasyon)
19. [Google Workspace Entegrasyonu](#19-google-workspace-entegrasyonu)
20. [Belge Yapay Zekasi](#20-belge-yapay-zekasi)
21. [Yuz Tanima](#21-yuz-tanima)
22. [Personel Takibi (Puantaj)](#22-personel-takibi-puantaj)
23. [Yonetim Paneli](#23-yonetim-paneli)
24. [Ayarlar](#24-ayarlar)
25. [Mobil Uygulama](#25-mobil-uygulama)
26. [Sik Sorulan Sorular](#26-sik-sorulan-sorular)

---

## 1. Giris

**Ajant Bureau**, Fransizca konusan pazarlar icin gelistirilmis, yapay zeka destekli kapsamli bir ofis yonetim platformudur. Tek bir yerden aramalari, kisileri, gorevleri, faturalari, projeleri, stoku ve daha fazlasini yonetmenizi saglar.

### Platform Ozellikleri
- Web uygulamasi (tum tarayicilar)
- Mobil uygulama (iOS ve Android)
- PWA destegi (masaustune kurulum)
- Coklu kiracili mimari (birden fazla organizasyon)
- Yapay zeka entegrasyonu (Gemini, OpenAI, Anthropic)
- Sesli komut sistemi

### Sistem Gereksinimleri
- Modern bir web tarayicisi (Chrome, Firefox, Safari, Edge)
- Mobil: iOS 15+ veya Android 12+
- Sesli komutlar icin: Chrome tarayicisi (en iyi destek)

---

## 2. Hesap Islemleri

### Giris Yapma
1. Web uygulamasini acin
2. **Adresse email** alanina e-posta adresinizi girin
3. **Mot de passe** alanina sifrenizi girin
4. **Se connecter** butonuna tiklayin

### Yeni Hesap Olusturma
1. Giris ekraninda **Creer un compte gratuit** butonuna tiklayin
2. Gerekli bilgileri doldurun (ad, soyad, e-posta, sifre)
3. Hesabinizi olusturun

### Ilk Giris (Onboarding)
Ilk giris yaptiginizda bir karsilama ekrani gorursunuz. Bu ekrandan:
- Temel ayarlarinizi yapin
- Veya **Passer** butonuna tiklayarak atlayin

### Kullanici Rolleri
| Rol | Yetki |
|-----|-------|
| **Super Admin** | Tum sistem yonetimi, organizasyon yonetimi |
| **Administrateur** | Organizasyon ici tam yetki |
| **Agent** | Standart kullanim yetkileri |
| **Lecture seule** | Sadece okuma yetkisi |

---

## 3. Kontrol Paneli

Giris yaptiktan sonra ana kontrol panelini gorursunuz. Bu ekranda:

### Ozet Kartlari
- **Toplam Aramalar**: Gunluk arama sayisi
- **Toplam Kisiler**: Kayitli kisi sayisi
- **Bekleyen Gorevler**: Tamamlanmamis gorevler
- **Mesajlar**: Okunmamis mesajlar

### Haftalik Karsilastirma
Gecen haftaya gore performans degisimini yuzde olarak gosterir.

### Son Aktiviteler
En son yapilan islemlerin kronolojik listesi.

### Tahminler
Yapay zeka tarafindan olusturulan haftalik tahminler ve oneriler.

### Performans Grafikleri
- Saatlik performans dagalimi
- Gorev istatistikleri
- Haftalik rapor

---

## 4. Arama Yonetimi

**Erisim:** Sol menuden **Appels** veya ust menuden arama simgesi

### Arama Listesi
- Tum aramalarin tarih, sure, durum ve kisi bilgileriyle listesi
- Durum filtreleri: Tamamlanan, Cevapsiz, Gelen, Giden

### Yeni Arama Kaydi
1. **Nouvelle appel** butonuna tiklayin
2. Kisi bilgilerini girin (isim, telefon)
3. Arama turunu secin (gelen/giden)
4. Notlarinizi ekleyin
5. Kaydedin

### Arama Detayi
Bir aramayi tiklayarak detay sayfasina gidin:
- Arama suresi ve zamani
- Iliskili kisi bilgileri
- Arama notlari
- Yapay zeka analizi

---

## 5. Kisi Yonetimi (CRM)

**Erisim:** Sol menuden **Contacts**

### Kisi Listesi
- Tum kisilerin isim, sirket, telefon ve e-posta bilgileri
- Arama ve filtreleme
- Hizli erisim butonlari

### Yeni Kisi Ekleme
1. **Nouveau contact** butonuna tiklayin
2. Zorunlu alanlari doldurun:
   - Ad ve soyad
   - Telefon numarasi
   - E-posta
   - Sirket (istege bagli)
3. **Enregistrer** ile kaydedin

### Kisi Detayi
Bir kisiye tiklayarak goruntuleyin:
- Iletisim bilgileri
- Arama gecmisi
- Iliskili gorevler
- Notlar ve etiketler

---

## 6. Gorev Yonetimi

**Erisim:** Sol menuden **Taches**

### Gorev Listesi
Gorevler duruma gore filtrelenebilir:
- **En attente** (Beklemede)
- **En cours** (Devam ediyor)
- **Termine** (Tamamlandi)

### Yeni Gorev Olusturma
1. **Nouvelle tache** butonuna tiklayin
2. Gorev basligini girin
3. Oncelik secin:
   - **Haute** (Yuksek)
   - **Moyenne** (Orta)
   - **Basse** (Dusuk)
4. Aciklama ekleyin
5. Son tarih belirleyin
6. Kaydedin

### Gorev Durumunu Guncelleme
- Goreve tiklayarak durumunu degistirin
- Surukle-birak ile durumlar arasinda tasiyin

---

## 7. Mesajlar

**Erisim:** Sol menuden **Messages**

- Dahili mesajlasma sistemi
- Sesli notlar
- Ekip ici iletisim

---

## 8. Musteri Adaylari (Prospects / CRM Pipeline)

**Erisim:** Sol menuden **Prospects** veya Mobilde **Prospection CRM**

### Pipeline Gorunumu
Musteri adaylari asagidaki asamalarda takip edilir:
- **Nouveau** (Yeni)
- **Contact** (Iletisim kuruldu)
- **Qualification** (Degerlendirme)
- **Proposition** (Teklif verildi)
- **Negociation** (Muzakere)
- **Gagne** (Kazanildi)
- **Perdu** (Kaybedildi)

### Lead Skorlama
Yapay zeka her musteri adayina otomatik puan verir (0-100):
- **A** (80-100): Cok yuksek potansiyel
- **B** (60-79): Yuksek potansiyel
- **C** (40-59): Orta potansiyel
- **D** (20-39): Dusuk potansiyel
- **F** (0-19): Cok dusuk potansiyel

### Yeni Musteri Adayi Ekleme
1. **Nouveau prospect** butonuna tiklayin
2. Kisi/sirket bilgilerini girin
3. Tahmini deger belirleyin
4. Pipeline asamasini secin
5. Kaydedin

---

## 9. Faturalama

**Erisim:** Sol menuden **Comptes Clients** veya Mobilde **Factures**

### Fatura Durumlari
- **Brouillon** (Taslak): Henuz gonderilmedi
- **Envoyee** (Gonderildi): Musteriye gonderildi
- **Payee** (Odendi): Odeme alindi
- **Annulee** (Iptal): Iptal edildi

### Yeni Fatura Olusturma
1. **Nouvelle facture** butonuna tiklayin
2. Musteriyi secin
3. Kalemleri ekleyin (urun/hizmet, miktar, birim fiyat)
4. KDV oranini belirleyin
5. Vade tarihini secin
6. Kaydedin veya gonderin

### Fatura Ozellikleri
- **Coklu para birimi**: EUR, USD, GBP, CHF, TRY, CAD, MAD, XOF
- **Gecikme faizi**: Fransiz yasalarina gore otomatik hesaplama (%10 yillik + 40 EUR sabit tazminat)
- **Otomatik odeme hatirlatma**: Vadesi gecen faturalar icin her sabah
  hatirlatma **hazirlanir** ve **File d'approbation** ekranina duser (bkz. bolum
  15). Metni okuyup gerekirse duzelttikten sonra onaylayin — musteriye ancak o
  zaman gider. Ayni fatura icin 7 gun icinde ikinci bir hatirlatma cikmaz.
  Bu ozelligi organizasyon bazinda tamamen kapatabilirsiniz.
- **PDF olusturma**: Profesyonel fatura PDF'i

### Musteri Hesap Sagligi
Her musteri hesabi icin otomatik saglik skoru:
- Odeme gecmisi analizi
- Risk siniflandirmasi
- Kredi limiti takibi

---

## 10. Proje Yonetimi

**Erisim:** Sol menuden **Projets** veya Mobilde **Projets**

### Proje Durumlari
- **Planifie** (Planlanmis)
- **En cours** (Devam ediyor)
- **En pause** (Durakladi)
- **Termine** (Tamamlandi)
- **Annule** (Iptal)

### Yeni Proje Olusturma
1. **Nouveau projet** butonuna tiklayin
2. Proje adini ve aciklamasini girin
3. Baslangic ve bitis tarihlerini secin
4. Butce belirleyin
5. Oncelik secin
6. Kaydedin

### Proje Takibi
- Ilerleme cubugu (yuzde)
- Butce kullanim orani
- Kalan gun sayisi
- Iliskili gorevler

---

## 11. Stok Yonetimi

**Erisim:** Sol menuden **Stock** veya Mobilde **Stock**

### Stok Listesi
- Urun adi, referans, barkod
- Mevcut miktar ve minimum miktar
- Birim fiyat ve tedarikci
- Durum: Stokta / Dusuk stok / Stok yok

### Yeni Urun Ekleme
1. **Nouvel article** butonuna tiklayin
2. Urun bilgilerini doldurun
3. Minimum stok seviyesini belirleyin (otomatik uyari icin)
4. Kaydedin

### Stok Uyarilari
Miktar minimum seviyenin altina dustugunde otomatik uyari alinir.

---

## 12. Takvim

**Erisim:** Sol menuden **Calendrier** veya Mobilde **Calendrier**

### Etkinlik Turleri
- **Rendez-vous** (Randevu)
- **Reunion** (Toplanti)
- **Rappel** (Hatirlatma)
- **Tache** (Gorev)

### Yeni Etkinlik Ekleme
1. Takvimde bir gune tiklayin
2. Baslik, aciklama, saat girin
3. Hatirlatma suresi secin (15dk, 30dk, 1 saat)
4. Tekrarlama ayarlayin (istege bagli)
5. Kaydedin

### Google Takvim Senkronizasyonu
Ayarlar > Platformlar > Google uzerinden baglanarak Google Takvim ile cift yonlu senkronizasyon yapabilirsiniz.

---

## 13. Analiz ve Raporlar

### Analitik Sayfasi
**Erisim:** Sol menuden **Analyse**
- Arama, gorev, kisi istatistikleri
- Grafik ve tablolar
- Trend analizi

### Raporlar
**Erisim:** Sol menuden **Rapports**
- Genel is raporlari
- Donem bazli karsilastirmalar

### Yonetici Raporu
**Erisim:** Sol menuden **Rapport Executif**
- Ust duzey is ozeti
- KPI'lar ve hedefler
- Stratejik oneriler

### Performans Sayfasi
**Erisim:** Sol menuden **Performance**
- Calisan bazinda performans metrikleri
- Ekip karsilastirmalari
- Verimlilik analizi

### Tahminsel Analitik
Yapay zeka destekli tahminler:
- Gelecek hafta arama tahmini
- Gorev tamamlama tahmini
- Gelir projeksiyonu
- Risk uyarilari

---

## 14. Yapay Zeka Ozellikleri

Ajant Bureau, birden fazla yapay zeka motoru kullanir (Gemini, OpenAI, Anthropic).

### Yapay Zeka Asistani (AI SUPREME)
**Erisim:** Web'de sag altta mor buton / Mobilde **Assistant IA**

43 farkli eylem gerceklestirebilen ultra guclu asistan:
- Gorev, kisi, etkinlik olusturma/guncelleme
- Fatura olusturma ve odeme kaydi
- Nakit akisi ve gelir tahmini
- Musteri 360 derece analizi
- Gunluk brifing
- Toplanti hazirligi
- Risk analizi
- Performans denetimi
- Akilli kampanya onerileri

### Yapay Zeka Ajanlari
**Erisim:** Sol menuden **Agents IA** veya Mobilde **Agents IA**

10 uzman ajan farkli ofis rollerini kapsar:
- Satis analisti
- Musteri iliskileri uzmani
- Performans denetcisi
- Risk yoneticisi
- Ve daha fazlasi...

### Yapay Zeka Komutani
**Erisim:** Sol menuden **Commandant IA**

20 yetenegine sahip merkezi yapay zeka orkestrasyon motoru:
- Akilli arama yaniti
- Otomatik gorev/randevu olusturma
- E-posta akilli yanit
- Geciken fatura hatirlatma
- Gunluk yapay zeka brifigi
- Metin analizi (6 mod)

### Otomatik Duzeltme Motoru
Yapay zeka otomatik olarak:
- Sahipsiz aramalari ilgili kisilere baglar
- Geciken gorevleri yukselir
- Tekrar eden kisileri tespit eder
- Otomatik kategorilendirme yapar
- Negatif stoku duzeltir

---

## 15. Onay Kuyrugu (File d'approbation)

**Erisim:** Sol menuden **File d'approbation** · Mobilde **Plus > File d'approbation**

Bu ekran, uygulamanin **temel guvenlik kuralinin** karsiligidir:

> Yapay zeka bir isi hazirlar, size gosterir, siz onaylayana kadar **uygulamaz**.

Yapay zeka bir musteriye e-posta veya SMS gonderecsekse, bir randevuyu iptal
edecekse ya da bir borc hatirlatmasi cikaracaksa, once buraya bir **oneri**
birakir. Onaylamadiginiz hicbir sey disari cikmaz.

### Bir oneride ne gorursunuz

- **Baslik ve ozet** — ne yapilacagi
- **"Pourquoi"** — yapay zekanin bunu neden onerdigi (tetikleyen olay)
- **Gercek icerik** — musteriye gidecek metnin tamami. E-posta gövdesi, SMS
  metni, randevu bilgisi... Ozet degil, birebir gidecek hali.

### Onaylamadan once duzeltebilirsiniz

Metin alanlari **degistirilebilir**. Yapay zekanin yazdigi e-postayi begenmediyseniz
duzeltin, sonra onaylayin — gonderilecek olan sizin son halinizdir. Onay
penceresi de son degerleri gosterir, yani gonder demeden once tam olarak ne
gidecegini gorursunuz.

### Butonlar

| Buton | Ne yapar |
|---|---|
| **Approuver** | Eylemi hemen uygular (e-postayi gonderir, randevuyu iptal eder...) |
| **Rejeter** | Oneriyi siler, hicbir sey yapilmaz |
| **Lancer l'analyse** | Yapay zekadan hemen yeni oneriler uretmesini ister |

Kirmizi uyari cikan oneriler **geri alinamaz** islemlerdir (ornegin randevu
iptali) — onaylamadan once iki kez okuyun.

### Sekmeler

- **En attente**: karar bekleyenler. Sol menudeki rakam bunlari sayar.
- **Historique**: onayladiklariniz, reddettikleriniz ve sonuclari.

> 14 gunden eski, hic el degmemis oneriler otomatik olarak "expiree" olur ve
> listeden duser. Ilgili durum devam ediyorsa yapay zeka guncel bilgiyle
> yeniden onerir.

### Buraya ne duser, ne dusmez

**Onay ister** (disari cikan, geri alinmasi zor isler):
- Musteriye e-posta ve SMS
- Telefonda istenen randevu iptali
- Odeme/borc hatirlatmalari
- Otomasyon kurallarinin musteriye gonderdigi mesajlar

**Onay istemez** (kurum ici, zararsiz isler):
- Uygulama ici bildirimler
- Gorev olusturma
- Kayit guncellemeleri

Bu ayrimi otomasyon kurallari icin degistirebilirsiniz — bkz. bolum 18.

---

## 16. Sesli Asistan ("Hey Bureau")

### Web Uygulamasinda
Giris yaptiktan sonra ekranin **sol alt kosesinde** yuvarlak bir mikrofon butonu gorursunuz.

#### Manuel Kullanim
1. Mikrofon butonuna tiklayin
2. Panel acilir, "Je vous ecoute..." yazisini gorunce konusmaya baslayin
3. Komutunuzu soyleyin
4. Yapay zeka yanit verir ve ilgili sayfaya yonlendirir

#### "Hey Bureau" Modu
1. Paneli acin
2. **Mode "Hey Bureau"** butonuna tiklayin
3. Simdi eller serbest modda: "Hey Bureau" diyerek asistani aktive edin
4. Ardindan komutunuzu soyleyin

#### Kullanilabilir Sesli Komutlar
| Komut | Islem |
|-------|-------|
| "Briefing du jour" | Gunun ozetini verir |
| "Combien d'appels aujourd'hui" | Bugunun arama sayisini soyler |
| "Taches en attente" | Bekleyen gorev sayisini soyler |
| "Factures en retard" | Geciken fatura bilgisini verir |
| "Derniers appels" | Son 5 aramayi listeler |
| "Taches urgentes" | Yuksek oncelikli gorevleri soyler |
| "Cree une tache [baslik]" | Yeni gorev olusturur |
| "Appelle [isim]" | Kisiyi bulur ve arama baslatir |
| "Cherche [metin]" | Kisi ve gorevlerde arar |
| "Agenda du jour" | Bugunun etkinliklerini listeler |
| "Prospects" | CRM pipeline ozetini verir |
| "Projets" | Proje ozetini verir |
| "Stock" | Stok durumunu soyler |
| "Performance" | Haftalik istatistikleri verir |
| "Aide" | Komut listesini gosterir |

#### Yardim Gorunumu
Panel acikken sag ustteki **?** simgesine tiklayarak tum komutlarin listesini gorebilirsiniz.

### Mobil Uygulamada
**Erisim:** Plus > Intelligence Artificielle > **Assistant Vocal**

1. Buyuk mikrofon butonuna basin
2. Komutunuzu soyleyin
3. Sohbet tarzinda yanit gorursunuz
4. Yanit sesli olarak okunur
5. Ilgili sayfaya otomatik yonlendirilirsiniz

**Not:** "Hey Bureau" modu su an web tarayicisinda (Chrome) en iyi calisir. Yerel mobil uygulamada komut listesinden hizli erisim kullanilabilir.

---

## 17. Telefon Sistemi

**Erisim:** Sol menuden **Telephonie** veya Mobilde **Telephonie**

### Desteklenen Saglayicilar
Twilio, Vonage, Telnyx, Plivo, Sinch, Bandwidth

### Ozellikler
- Saglayici yapilandirmasi
- Arama baslatma ve SMS gonderme
- Arama ve SMS gecmisi
- Istatistik paneli

### Saglayici Ekleme

1. **Telephonie** sayfasinda **Providers** sekmesine gidin, **Ajouter un fournisseur** butonuna tiklayin
2. Listeden bir saglayici secin
3. Saglayiciya gore istenen bilgileri girin:
   - **Twilio:** Account SID, Auth Token, Expediteur numarasi
   - **Vonage:** API Key, API Secret, Expediteur numarasi
   - **Telnyx:** API Key, Connection ID, Expediteur numarasi
   - **Plivo:** Auth ID, Auth Token, Expediteur numarasi
   - **Sinch:** Project ID, API Token, Service Plan ID, Expediteur numarasi
   - **Bandwidth:** Account ID, Username, Password, Application ID, Expediteur numarasi
4. **Configurer** ile kaydedin, ardindan **Test** butonuyla baglantiyi dogrulayin

> **Test butonu hakkinda:** Bu test saglayiciya baglanmaz — sadece girdiginiz
> alanlarin eksiksiz oldugunu dogrular. Yanlis bir Auth Token da "basarili"
> gorunur. Gercek dogrulama, ilk arama veya SMS denemesinde ortaya cikar.

### Webhook Entegrasyonu

Saglayicilar arama durumu guncellemelerini otomatik olarak webhook uzerinden bildirir. Webhook adresi: `/api/telephony/webhook/{saglayici_adi}`

### Sesli Sekreter ve Randevu Iptali

Yapay zeka sekreter gelen aramalari karsilar, randevu alir ve mesaj kaydeder.

**Arayan bir randevuyu iptal etmek isterse**, sekreter iptali kendisi
gerceklestirmez. Talebi **File d'approbation** ekranina birakir ve arayana
"talebinizi ilettim, kisa surede teyit edecegiz" der. Randevu ancak siz
onayladiktan sonra iptal olur.

**Neden boyle:** Telefondaki kisinin kimligi yalnizca soyledigi isim ve arayan
numaradan ibarettir; ikisi de taklit edilebilir. Randevu iptali ise geri
alinamaz ve musteriyi dogrudan etkiler. Bu yuzden karar insana birakilir.

Iptal talepleri onay kuyrugunda **kirmizi uyari** ile gorunur. Bkz. bolum 15.

---

## 18. Otomasyon

**Erisim:** Sol menuden **Automatisations** veya Mobilde **Automations**

Tekrarlayan islemleri otomatiklestirmek icin kurallar olusturun:
- Tetikleyici olay secin (orn: yeni arama, gorev gecikme)
- Kosullari belirleyin
- Eylemi tanimlayin (orn: bildirim gonder, gorev olustur)

### Onay politikasi

Her kuralin kartinda bir rozet vardir. **Uzerine tiklayarak** politikayi
degistirebilirsiniz — uc secenek sirayla doner:

| Rozet | Anlami |
|---|---|
| **Envois a valider** (varsayilan) | Musteriye giden e-posta/SMS onay kuyruguna duser; bildirim ve gorev olusturma otomatik calisir |
| **Tout a valider** | Ic islemler dahil her sey onay bekler |
| **Tout automatique** | Hicbir sey onay beklemez, kural dogrudan uygular |

**Neden varsayilan boyle:** Bir kurali bir kez siz yazarsiniz, ama o kural
sonrasinda **5 dakikada bir kendi basina** calisir. Musteriye giden her mesaji
kimse okumamis olur. Varsayilan ayar, kurumun disina cikan seyleri insan
gozunden gecirir; ic islemleri yavaslatmaz.

Onay bekleyen kural eylemleri **File d'approbation** ekraninda, gonderilecek
metnin son hali (musteri adi, tarih vb. doldurulmus olarak) ile gorunur —
sablon degil, birebir gidecek hali. Bkz. bolum 15.

---

## 19. Google Workspace Entegrasyonu

**Erisim:** Sol menuden **Google Workspace**

14 Google hizmetine entegrasyon:
- **Gmail**: E-posta gonderme ve alma
- **Google Takvim**: Etkinlik senkronizasyonu
- **Google Drive**: Yedekleme ve dosya yonetimi
- Ve daha fazlasi...

### Baglanti Kurma
1. Google Workspace sayfasina gidin
2. Ilgili hizmeti secin
3. Google hesabinizla yetkilendirin
4. Senkronizasyonu baslayin

---

## 20. Belge Yapay Zekasi

**Erisim:** Sol menuden **Document IA**

Akilli belge analiz sistemi:
1. Belgeyi yukleyin (PDF, resim, metin)
2. Yapay zeka belgeyi analiz eder
3. Veri cikarir (tarihler, tutarlar, isimler)
4. Eylem onerir (fatura olustur, kisi ekle, gorev ata)
5. Onerileri onaylayin veya duzeltip uygulayin

---

## 21. Yuz Tanima

**Erisim:** Mobilde **Reconnaissance faciale**

- Kamera ile yuz tarama
- Profil kaydi ve kisi eslestirme
- Duygu durumu algilama
- Guvenlik seviyesi degerlendirmesi
- Taninma gecmisi ve istatistikler

---

## 22. Personel Takibi (Puantaj)

**Erisim:** Sol menuden **Pointage** veya Mobilde **Pointage**

- Calisan giris/cikis kaydi
- Google Takvim senkronizasyonu
- Devamsizlik takibi
- Ozet raporlar

---

## 23. Yonetim Paneli

### Organizasyonlar (Sadece Super Admin)
**Erisim:** Sol menuden **Organisations**
- Organizasyon ekleme, duzenleme, silme
- Lisans anahtari olusturma
- Abonelik yonetimi

#### Yeni organizasyon olusturma

**Nom de l'organisation** alanina firma adini yazmaya baslayin (en az 2 harf).
Uygulama Fransiz resmi sirket sicilinde arar ve bir liste acar. Listeden
sectiginizde **resmi unvan, adres ve SIRET** otomatik dolar.

Sicil erisilemezse liste bos gelir — elle yazmaya devam edebilirsiniz, hicbir
sey engellenmez.

Formu **Creer et envoyer** ile tamamladiginizda organizasyon olusturulur ve
lisans anahtari + yonetici giris bilgileri e-posta ile gonderilir.

#### E-posta gitmezse

Organizasyon olusur ama **kirmizi bir uyari** cikar ve **gercek hatayi** yazar
(ornegin gonderen alan adi dogrulanmamis, API anahtari eksik). Pencere kapanir
— cunku organizasyon zaten olusmustur, formu tekrar gondermek kopya yaratir.

Lisans kaybolmaz: listede ilgili organizasyonun satirindaki **Renvoyer la
licence** butonuyla, sorunu duzelttikten sonra yeniden gonderebilirsiniz.

#### Aylik faturalar (taslak onayi)

Platform faturalari her ay otomatik uretilir ama **taslak** olarak bekler;
hicbir borc/gecikme hesabina girmez. Super admin gozden gecirip onayladiktan
sonra kesinlesir. Mali belgelerin insan gormeden musteriye ulasmamasi icin
boyle tasarlanmistir.

> Not: Fatura taslaklari onay kuyrugunda (bolum 15) gorunmez — o kuyruk
> organizasyona ozeldir ve kiraci kendi faturasini onaylamis olurdu. Taslak
> onayi super admin tarafindadir.

### Lisans Yonetimi (Sadece Admin)
**Erisim:** Sol menuden **Gestion Licence**
- Abonelik durumu
- Guvenlik uyarilari
- Fatura yonetimi ve odeme takibi

### Kullanici Yonetimi
**Erisim:** Sol menuden **Utilisateurs**
- Kullanici ekleme/cikarma
- Rol atama
- Hesap durumu yonetimi

### Saglik Kontrolu / Sante technique (Sadece Super Admin)
**Erisim:** Sol menu > Super Admin > **Sante technique**

Uygulamanin **altyapisini** surekli denetleyen 7 ajan. Her ajan kendi dalindan
sorumludur ve 15 dakikada bir otomatik calisir. **Verifier maintenant** ile
istediginiz an elle de calistirabilirsiniz.

| Ajan | Ne kontrol eder |
|---|---|
| **Base de donnees** | Baglanti havuzu doygunlugu, sorgu gecikmesi, Postgres baglanti sayisi |
| **Services externes** | Resend / Gemini / Twilio / Stripe / Google'a **gercek** baglanti testi |
| **Configuration** | Eksik ortam degiskeni, hatali OAuth adresi, NODE_ENV |
| **Taches planifiees** | Zamanlanmis islerin canlilik takibi (olmus cron tespiti) |
| **Taux d'erreurs** | 500 ve 429 yanit oranlari |
| **Ressources serveur** | Bellek, islemci tikanmasi, calisma suresi |
| **Integrite des donnees** | Yetim kayitlar, yapisal tutarsizliklar |

Her bulgu uc durumdan birindedir: **OK** (yesil), **Degrade** (turuncu, dikkat
gerekiyor), **En panne** (kirmizi, arizali). Sorunlu bulgularda **ne yapilmasi
gerektigi** de yazar.

**Neden bu ekran var:** Isletme verisi kontrolleri (gecikmis gorevler, sessiz
musteriler) bir altyapi arizasini goremez. Yasanmis ornekler: veritabani
baglanti havuzunun dolmasi tum sayfalari 500 hatasina dusurmustu; dogrulanmamis
bir alan adi yuzunden e-postalar sessizce gitmemisti; yanlis kurulmus bir istek
limiti tum uygulamayi 429 ile kilitlemisti. Bu ekran o tur arizalari, kullanici
fark etmeden once yakalar.

### Denetim Gunlugu
**Erisim:** Sol menuden **Audit**
- Tum sistem aktivitelerinin kronolojik kayddi
- Guvenlik olaylarini izleme
- Kullanici bazinda filtreleme

---

## 24. Ayarlar

**Erisim:** Sol menuden **Parametres**

### Sekmeler
| Sekme | Aciklama |
|-------|----------|
| **Abonnement** | Plan ve abonelik yonetimi |
| **Plateformes** | Harici entegrasyonlar (Google vb.) |
| **Appels** | Telefon tercihleri |
| **Sauvegardes** | Veri yedeklemeleri |
| **Installation** | PWA ve platform ayarlari |
| **Notifications** | Bildirim tercihleri |
| **Facturation** | Faturalar ve odeme yontemleri |
| **Securite** | Guvenlik protokolleri ve MFA |
| **Mises a jour** | Sistem guncelleme kayitlari |

### PWA Kurulumu
Uygulamayi masaustune yuksek performansli bir uygulama olarak kurabilirsiniz:
1. Ayarlar > Installation gidin
2. **Installer** butonuna tiklayin
3. Tarayici izin isteyecektir, onaylayin

---

## 25. Mobil Uygulama

### Ana Sekmeler (Alt Menude)
| Sekme | Islem |
|-------|-------|
| **Accueil** | Ana kontrol paneli |
| **Appels** | Arama yonetimi |
| **Contacts** | Kisi listesi |
| **Taches** | Gorev listesi |
| **Plus** | Tum diger ozellikler |

### "Plus" Menusu Kategorileri

#### Ticari (Commercial)
- **Prospection CRM**: Musteri adaylari pipeline
- **Factures**: Faturalar ve odemeler
- **Projets**: Proje takibi

#### Iletisim (Communication)
- **Messages**: Dahili mesajlasma
- **Telephonie**: VoIP ve SMS

#### Araclar (Outils)
- **Analytique**: Veri analizi
- **Calendrier**: Takvim
- **Stock**: Envanter yonetimi
- **Pointage**: Personel takibi

#### Yapay Zeka (Intelligence Artificielle)
- **File d'approbation**: Yapay zekanin hazirladigi, onayinizi bekleyen
  islemler. Yanindaki rakam bekleyen sayisini gosterir. Telefondan da
  onaylayabilir, metni duzeltebilir veya reddedebilirsiniz — masaustunun
  tamamen ayni islevi (bkz. bolum 15).
- **Assistant IA**: Sohbet tabanli yapay zeka
- **Assistant Vocal**: Sesli komut sistemi
- **Agents IA**: Uzman yapay zeka ajanlari
- **Reconnaissance faciale**: Yuz tanima
- **Automations**: Otomasyon kurallari

#### Yonetim (Administration)
- **Rapports Admin**: Yonetici raporlari
- **Utilisateurs**: Kullanici yonetimi
- **Journal d'audit**: Denetim gunlugu
- **Integrations**: Harici entegrasyonlar
- **Organisations**: Organizasyon yonetimi

#### Hesap
- **Parametres**: Uygulama ayarlari
- **Tema**: Acik / Koyu / Sistem

### Mobil Tema Degistirme
1. Plus > Parametres gidin
2. Tema seceneklerinden birini secin:
   - **Systeme**: Cihaz ayarini takip eder
   - **Clair**: Acik tema
   - **Sombre**: Koyu tema

---

## 26. Sik Sorulan Sorular

### Sifrem unutuldu, ne yapmaliyim?
Giris ekraninda sistem yoneticinizle iletisime gecin. Super Admin sifrenizi sifirlayabilir.

### Yapay zeka musteriye kendi basina e-posta veya SMS gonderir mi?
Hayir. Kurum disina cikan hicbir sey siz onaylamadan gonderilmez. Yapay zeka
metni hazirlar ve **File d'approbation** ekranina birakir; siz okur, gerekirse
duzeltir, sonra onaylarsiniz (bkz. bolum 15). Ayni kural telefonda istenen
randevu iptalleri ve odeme hatirlatmalari icin de gecerlidir.

Uygulama ici bildirimler ve gorev olusturma gibi **kurum ici** islemler onay
beklemez — bunlar disariya ulasmaz. Isterseniz otomasyon kurallarini
"Tout a valider" yaparak onlari da onaya baglayabilirsiniz (bolum 18).

### Onay kuyrugunda bekleyen isler var ama fark etmiyorum?
Sol menude **File d'approbation** yaninda bekleyen sayisi yazar; mobilde
**Plus** menusunde ayni rakam gorunur. 14 gun boyunca el degmeyen oneriler
otomatik olarak duser — durum devam ediyorsa yapay zeka guncel bilgiyle
yeniden onerir.

### Lisans e-postasi gitmedi, ne yapmaliyim?
Organizasyon olustuktan sonra kirmizi bir uyari ciktiysa, o uyaridaki metin
**gercek sebebi** yazar (cogunlukla gonderen alan adinin dogrulanmamis olmasi
veya eksik API anahtari). Sebebi giderdikten sonra organizasyon satirindaki
**Renvoyer la licence** butonuyla tekrar gonderin — lisans kaybolmaz.

### Sesli komutlar calismiyorsa?
- Chrome tarayicisi kullandiginizdan emin olun
- Mikrofon iznini kontrol edin (tarayici adres cubugundaki kilit simgesi)
- Fransizca konusmayi deneyin (sistem Fransizca tanima yapar)

### Mobil uygulamada sesli asistan neden calismiyorsa?
Sesli tanima su an web tarayicisinda en iyi calisir. Yerel mobil uygulamada komut listesinden secim yaparak ayni islevleri kullanabilirsiniz.

### Verilerim guvenli mi?
Evet. Platform 9 katmanli guvenlik mimarisi kullanir:
- Kimlik dogrulama ve yetkilendirme
- Helmet guvenlik bashliklari
- Hiz sinirlandirma
- Siki CORS politikasi
- AES-256-GCM sifreleme (yedeklerde)
- Denetim gunlugu

### Fatura PDF'i nasil olusturulur?
Fatura detay sayfasinda **Telecharger PDF** veya yazdirma simgesine tiklayin.

### Google Takvim nasil baglanilir?
Ayarlar > Plateformes > Google uzerinden OAuth2 yetkilendirmesi ile baglanti kurun.

### Birden fazla organizasyonu nasil yonetebilirim?
Super Admin rolune sahipseniz, **Organisations** sayfasindan birden fazla organizasyon ekleyip yonetebilirsiniz. Her organizasyon izole bir kiraciya sahiptir.

### Uygulama cok yavas yukleniyor?
- Ilk yukleme sonrasi onbellek sayesinde hizlanir
- PWA olarak kurarak daha hizli erisim saglayabilirsiniz
- Chrome DevTools > Network sekmesinden yavas istekleri teshis edebilirsiniz

### Destek icin kime ulasirim?
Sistem yoneticinize veya Ajant Bureau SAS destek ekibine ulasin.

---

*Ajant Bureau SAS - Solution professionnelle de gestion*
*Bu kilavuz Ajant Bureau v1.0 icin hazirlanmistir.*
