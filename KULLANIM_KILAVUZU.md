# Agent de Bureau - Kullanim Kilavuzu

## Icindekiler

1. [Giris ve Baslangic](#1-giris-ve-baslangic)
2. [Web Uygulamasi (Buro Ajani)](#2-web-uygulamasi-buro-ajani)
3. [Mobil Uygulama](#3-mobil-uygulama)
4. [Moduller ve Ozellikler](#4-moduller-ve-ozellikler)
5. [Yapay Zeka Ozellikleri](#5-yapay-zeka-ozellikleri)
6. [Yonetim Paneli](#6-yonetim-paneli)
7. [Sikca Sorulan Sorular](#7-sikca-sorulan-sorular)

---

## 1. Giris ve Baslangic

### Agent de Bureau Nedir?
Agent de Bureau, ofis yonetimi icin gelistirilmis kapsamli bir SaaS (hizmet olarak yazilim) platformudur. CRM, cagri merkezi, gorev yonetimi, stok takibi, faturalama, proje yonetimi ve yapay zeka destekli is zekasi ozelliklerini tek bir catida birlestiren multi-tenant bir sistemdir.

### Platformlar
- **Web Uygulamasi (Buro Ajani):** Tarayicidan erisilen tam ozellikli yonetim paneli
- **Mobil Uygulama:** iOS ve Android icin Expo tabanli mobil uygulama
- **Tanitim Sitesi:** Platform hakkinda bilgi veren vitrin site

### Ilk Giris
1. E-posta adresinizi ve sifrenizi giris ekranina girin
2. "Se connecter" (Baglan) butonuna basin
3. Ilk giriste karsilama ekrani goruntulenir - "Passer" (Atla) ile gecebilirsiniz
4. Ana pano (Dashboard) goruntulenecektir

### Roller ve Yetkiler
| Rol | Aciklama |
|-----|----------|
| **Super Admin** | Tum platform yonetimi, tum organizasyonlara erisim |
| **Administrateur** | Organizasyon yoneticisi, tum moduller |
| **Agent** | Standart kullanici, atanan moduller |
| **Lecture Seule** | Sadece okuma yetkisi |

---

## 2. Web Uygulamasi (Buro Ajani)

### 2.1 Ana Pano (Tableau de Bord)
Giris yapildiginda ilk goruntulenen ekrandir.

**Icerdikleri:**
- Gunun ozeti (toplam arama, kacirilmis arama, aktif gorevler)
- Performans metrikleri (cevaplama orani, ortalama arama suresi)
- Son aktiviteler listesi
- Hizli erisim butonlari
- Yapay zeka durum gostergesi

### 2.2 Aramalar (Appels)
Tum telefon gorusmelerinizi yonetin.

**Ozellikler:**
- Gelen/giden arama kayitlari
- Arama durumu (Cevaplanmis, Kacirilmis, Mesajli, Giden)
- Arama suresi takibi
- Yapay zeka ile arama notu ozeti
- Duygu analizi (pozitif/negatif/notr)
- Arama simulatoru (egitim amacli)
- Gelen arama bildirim penceresi

**Nasil Kullanilir:**
1. Sol menuden "Appels" secin
2. Yeni arama kaydi icin "+" butonuna tiklayin
3. Kisi adi, telefon numarasi, yon ve durumu doldurun
4. Notlarinizi ekleyin ve kaydedin

### 2.3 Kisiler (Contacts / CRM)
Musteri, tedarikci ve is ortaklarinizi yonetin.

**Kategoriler:**
- Client (Musteri)
- Prospect (Potansiyel Musteri)
- Fournisseur (Tedarikci)
- Partenaire (Is Ortagi)
- Autre (Diger)

**Ozellikler:**
- Kisi detaylari (ad, soyad, sirket, telefon, e-posta, adres)
- Etkilesim gecmisi (aramalar, gorevler, mesajlar)
- Kategori bazli filtreleme
- Arama fonksiyonu
- Dogrudan arama/SMS/e-posta baslatma
- Yapay zeka ile kopya kisi tespiti

### 2.4 Gorevler (Taches)
Gunluk islerinizi ve projelerinizi takip edin.

**Oncelik Seviyeleri:**
- Haute (Yuksek) - Kirmizi
- Moyenne (Orta) - Turuncu
- Basse (Dusuk) - Yesil

**Durumlar:**
- En attente (Beklemede)
- En cours (Devam ediyor)
- Termine (Tamamlandi)
- Annule (Iptal edildi)

**Ozellikler:**
- Liste ve Kanban goruntuleme
- Son tarih takibi ve gecikme uyarilari
- Kullaniciya atama
- Durum degistirme (tek tikla)
- Oncelik bazli filtreleme

### 2.5 Takvim (Calendrier)
Randevularinizi ve etkinliklerinizi planlyin.

**Ozellikler:**
- Aylik gorunum
- Etkinlik turleri (Toplanti, Arama, Gorev, Randevu)
- Potansiyel musteri randevu olusturma
- Harici takvim entegrasyonu
- Hatirlatma bildirimleri

### 2.6 Mesajlar (Messages)
Dahili ve harici iletisiminizi yonetin.

**Ozellikler:**
- Merkezi gelen kutusu
- Sesli mesaj transkripsiyonu
- Oncelik bazli filtreleme
- Okundu/okunmadi takibi
- Hizli yanit

### 2.7 Potansiyel Musteriler (Prospects)
Satis hattinizi yonetin.

**Asamalar:**
- Nouveau (Yeni)
- Contacte (Iletisime gecildi)
- Qualifie (Nitelikli)
- Proposition (Teklif verildi)
- Negociation (Muzakere)
- Gagne/Perdu (Kazanildi/Kaybedildi)

**Ozellikler:**
- Pipeline gorunumu
- Otomatik asama gecisleri
- Teklif olusturma
- Donusum izleme

### 2.8 Stok Yonetimi (Stock)
Envanterinizi takip edin.

**Ozellikler:**
- Urun referans numaralari
- Miktar takibi
- Minimum stok uyarilari
- Birim fiyat yonetimi
- PDF'den yapay zeka ile stok aktarimi

### 2.9 Faturalama (Facturation)

**Belge Turleri:**
- Devis (Teklif)
- Facture (Fatura)

**Ozellikler:**
- Otomatik fatura olusturma
- Odeme durumu takibi (Odenmi, Gecikmi, Kismi)
- Odeme hatirlatma gonderimi
- Abonelik yonetimi (tekrarlayan hizmetler)
- Musteri hesap ozeti

### 2.10 Pointage (Mesai Takibi)
Calisanlarin mesai saatlerini takip edin.

**Ozellikler:**
- Giris/cikis kaydi (Ofis, Uzaktan, Saha)
- Mola yonetimi
- Konum takibi
- Google Takvim ile senkronizasyon

### 2.11 Projeler (Projets)
Buyuk olcekli islerinizi organize edin.

**Ozellikler:**
- Gorev gruplama
- Kaynak yonetimi
- Ilerleme takibi
- Takim isbirligi

---

## 3. Mobil Uygulama

### 3.1 Ana Ekran (Accueil)
Mobil uygulamanin giris ekrani, gunluk kullanim icin optimize edilmistir.

**Icerikler:**
- **Karsilama:** "Bonjour, [Adiniz]" ve gunun tarihi
- **Bildirim Zili:** Okunmamis mesaj sayisi ile birlikte
- **Hizli Olustur:** Tek tikla Arama/Kisi/Gorev/Randevu olusturma
- **Gecikme Uyarisi:** Geciken gorevler icin kirmizi uyari banderi
- **Istatistikler:** Toplam arama, kacirilmis arama, kisi sayisi, bekleyen gorev
- **Performans:** Cevaplama orani, ortalama sure, okunmamis mesajlar
- **Gunun Ajandasi:** Yaklasan 3 etkinlik on izlemesi
- **Son Aramalar:** Son 5 arama (kacirilanlarda geri arama butonu)
- **Hizli Erisim:** Aramalar, Kisiler, Gorevler, Mesajlar, Yuz Tanima, Stok

### 3.2 Aramalar (Appels)
**Yeni Ozellikler:**
- **Gunun Ozeti:** Bugunun toplam arama, cevaplanmis, kacirilmis ve toplam suresi
- **Geri Arama:** Kacirilmis aramalarda yesil telefon butonu ile tek tikla geri arama
- **Sure Gosterimi:** Her aramada sure bilgisi
- **Filtreler:** Tumu, Cevaplanmis, Kacirilmis, Giden

**Kullanim:**
1. Alt menuden "Appels" sekmesine tiklayin
2. Arama yapmak icin "+" butonuna basin
3. Kacirilmis aramalar icin yesil telefon ikonuna dokununsanksi aninda geri arayin

### 3.3 Kisiler (Contacts)
**Yeni Ozellikler:**
- **Hizli Aksiyonlar:** Her kisinin yaninda telefon, SMS ve e-posta butonlari
- **Avatar:** Kisi basharflerini gosteren renkli avatar
- **Kisi Sayaci:** Baslikta toplam kisi sayisi
- **Son Iletisim:** Her kisiyle son iletisim zamani
- **Kategori Gostergesi:** Renkli nokta ile kategori belirteci

**Kullanim:**
1. "Contacts" sekmesine gidin
2. Hizli arama icin telefon ikonuna dokunun
3. SMS gondermek icin mesaj ikonuna dokunun
4. E-posta icin zarf ikonuna dokunun
5. Detaylar icin kisiye dokunun

### 3.4 Gorevler (Taches)
**Yeni Ozellikler:**
- **Gecikme Gostergesi:** Geciken gorevlerde kirmizi sol kenar cizgisi
- **Tarih Rozeti:**
  - Kirmizi: "Xj retard" (X gun gecikme)
  - Turuncu: "Aujourd'hui" (Bugun)
  - Mavi: "Xj" (X gun kaldi)
- **Durum Degistirme:** Daire ikonuna dokunarak hizli durum gecisi
- **Oncelik Gosterimi:** Renkli nokta ile oncelik seviyesi

**Kullanim:**
1. "Taches" sekmesine gidin
2. Gorevi tamamlamak icin soldaki daireye dokunun
3. Detay icin gorev satirina dokunun
4. Yeni gorev icin "+" butonuna basin

### 3.5 Plus Menusu
Ek moduller ve ayarlara bu menuden ulasabilirsiniz:
- Mesajlar
- Analitik
- Takvim
- Stok
- Pointage (Mesai)
- AI Ajanlar
- **Yuz Tanima (Reconnaissance faciale)**
- Otomasyonlar
- Yonetim

### 3.6 Bildirimler (Notifications)
Dashboard'daki zil ikonundan erisilebilir.

**Icerdikleri:**
- Kacirilmis aramalar
- Geciken gorevler
- Okunmamis mesajlar
- Stok uyarilari

**Ozellikler:**
- "Toutes" (Tumu) / "Non lues" (Okunmamislar) filtresi
- "Tout lire" (Tumunu oku) butonu
- Bildirime dokunarak ilgili ekrana gecis

### 3.7 Yuz Tanima (Reconnaissance Faciale)
Yapay zeka destekli yuz tanima sistemi.

**4 Sekme:**
1. **Scanner:** Kamera ile canli yuz tarama
2. **Enregistrer:** Yeni yuz profili kaydetme
3. **Profils:** Kayitli yuz profilleri listesi
4. **Historique:** Tanima gecmisi ve loglari

**Ozellikler:**
- Duygu durum tespiti
- Guvenlik seviyesi degerlendirmesi
- Otomatik karsilama mesaji olusturma
- Kisi ile eslestirme

---

## 4. Moduller ve Ozellikler

### 4.1 Arama Yonetimi
| Ozellik | Aciklama |
|---------|----------|
| Arama Kaydi | Gelen/giden aramalari otomatik kayit |
| Durum Takibi | Cevaplanmis, Kacirilmis, Mesajli |
| Sure Olcumu | Her aramanin suresi |
| Not Alma | Arama sirasinda/sonrasinda notlar |
| AI Ozet | Yapay zeka ile arama notu ozeti |
| Duygu Analizi | Arama icerigi duygu tespiti |
| Geri Arama | Tek tikla geri arama |

### 4.2 CRM / Kisi Yonetimi
| Ozellik | Aciklama |
|---------|----------|
| Kisi Kartlari | Tam detayli kisi bilgileri |
| Kategorileme | Musteri, Prospect, Tedarikci, Ortak |
| Etkilesim Gecmisi | Tum iletisim kayitlari |
| Hizli Aksiyonlar | Dogrudan arama, SMS, e-posta |
| Kopya Tespit | AI ile kopya kisi bulma |
| Toplu Islem | Birden fazla kisi uzerinde islem |

### 4.3 Gorev Yonetimi
| Ozellik | Aciklama |
|---------|----------|
| Gorev Olusturma | Baslik, aciklama, oncelik, son tarih |
| Atama | Takim uyelerine gorev atama |
| Durum Akisi | Beklemede > Devam ediyor > Tamamlandi |
| Gecikme Uyarisi | Son tarih gecen gorevler icin uyari |
| Filtreleme | Durum ve oncelik bazli filtreleme |

### 4.4 Faturalama
| Ozellik | Aciklama |
|---------|----------|
| Teklif Olusturma | Profesyonel teklif belgesi |
| Fatura Olusturma | Detayli fatura hazirlama |
| Odeme Takibi | Odeme durumu izleme |
| Hatirlatma | Otomatik odeme hatirlatma e-postalari |
| IBAN Bilgisi | Faturalarda banka bilgileri |

### 4.5 Stok Yonetimi
| Ozellik | Aciklama |
|---------|----------|
| Urun Takibi | Referans, miktar, fiyat |
| Dusuk Stok Alarmi | Minimum seviye altinda uyari |
| PDF Import | Yapay zeka ile belge okuma |
| Hareket Gecmisi | Giris/cikis kayitlari |

---

## 5. Yapay Zeka Ozellikleri

### 5.1 AI Commandant (Yapay Zeka Komutan)
Platformun merkezi zeka merkezidir. 3 farkli yapay zeka modeli kullanir (Gemini, OpenAI, Anthropic).

**10 Sekme:**
1. **Briefing:** Gunluk is ozeti, motivasyon notu, oncelik skorlari
2. **Telefon:** Arama icin akilli yanit onerileri, kisi gecmisi analizi
3. **E-posta:** Akilli e-posta yaniti, ton ayari, niyet tespiti
4. **Reunion:** Toplanti ozeti ve aksiyon cikarma
5. **Taches:** Gecikme hatirlatma, gorev onceliklendirme
6. **Finance:** Fatura analizi, odeme hatirlatma olusturma
7. **Photo:** Gorsel analiz
8. **Drive:** Google Drive entegrasyonu
9. **Rappels:** Hatirlatma yonetimi
10. **Stats:** Performans istatistikleri

### 5.2 Akilli Arama (Smart Search)
Briefing sekmesinde bulunan capraz modul arama:
- Kisiler, gorevler, etkinlikler, faturalar ve potansiyel musteriler arasinda arama
- Yapay zeka ozeti ile sonuc analizi

### 5.3 Metin Analiz Araclari
6 mod ile metin analizi:
1. **Duygu Analizi (Sentiment):** Metnin duygusal tonunu belirler
2. **Ozet (Resume):** Uzun metinleri ozetler
3. **Varlik Cikarma (Entites):** Isimler, tarihler, yerler cikarir
4. **Aksiyon Cikarma (Actions):** Yapilacak isleri tespit eder
5. **Ceviri (Traduction):** Metni diger dillere cevirir
6. **Yeniden Yazma (Reecriture):** Metni farkli tonlarda yeniden yazar

### 5.4 10 Yapay Zeka Ajani
Platform surekli calisan 10 AI ajani icerir:
1. **Appels (Aramalar):** Arama kaliplarini analiz eder
2. **CRM:** Musteri iliskilerini optimize eder
3. **Productivite:** Verimlilik onerileri sunar
4. **Communication:** Iletisim kalitesini izler
5. **Presence:** Mesai durumlarini analiz eder
6. **Facturation:** Fatura ve odeme takibi
7. **Stock:** Envanter optimizasyonu
8. **RH (IK):** Insan kaynaklari yonetimi
9. **Securite:** Guvenlik tehditlerini izler
10. **Performance:** Genel performans degerlendirmesi

### 5.5 Otomasyon Motoru
Otomatik kurallar ile is sureclerini hizlandirin:
- **Geciken Gorevler:** Son tarih gectiginde otomatik uyari
- **Takvim Hatirlatma:** Etkinlikten 30 dakika once bildirim
- **Okunmamis Mesajlar:** 1 saatten fazla okunmamis mesaj uyarisi
- **Kacirilmis Aramalar:** Otomatik takip gorevi olusturma

**Ozel Otomasyon Olusturma:**
1. "Automations" sayfasina gidin
2. Tetikleyici secin (orn. kacirilmis arama)
3. Kosul belirleyin (orn. is saatlerinde)
4. Aksiyon tanimlayin (orn. gorev olustur)
5. Kaydedin

---

## 6. Yonetim Paneli

### 6.1 Kullanici Yonetimi (Utilisateurs)
**Yeni Kullanici Ekleme:**
1. "Utilisateurs" sayfasina gidin
2. "Ajouter un utilisateur" tiklayin
3. Ad, soyad, e-posta, rol ve departman girin
4. Sistem otomatik sifre olusturur ve e-posta ile gonderir

**Koltuk Takibi:**
- Mevcut plan limitinize gore kullanici sayisi izlenir (orn. "3/5 Kullanici")

### 6.2 Lisans Yonetimi (Licence)
**Abonelik Planlari:**
- Kullanici sayisi, kisi limiti, arama limiti
- Deneme suresi takibi
- Otomatik fatura olusturma
- Odeme gecmisi

**Otomatik Faturalama:**
- Kullanim bazli hesaplama (kullanici, kisi, arama asimi)
- Aylik otomatik fatura olusturma
- Coklu seviyede odeme hatirlatma (ilk hatirlatma, ikinci, resmi ihtar)

### 6.3 Organizasyon Yonetimi
- Organizasyon bilgileri duzenleme
- Kullanici ve veri istatistikleri
- Guvenlik ayarlari

### 6.4 Yonetici Raporlari (Rapport Executif)
CEO ve yoneticiler icin ust duzey is zekasi raporlari:
- Anahtar performans gostergeleri (KPI)
- Haftalik/aylik trend analizi
- Departman bazli karsilastirmalar
- Yapay zeka destekli oneriler

### 6.5 Veri Koruma (GDPR)
- Otomatik veri koruma izlemesi
- Yedekleme durumu takibi (her 2 dakikada bir)
- Organizasyon bazli uyumluluk raporu

### 6.6 Google Entegrasyonlari
- **Gmail:** E-posta gonderimi (odeme hatirlatma, kullanici davetleri)
- **Google Drive:** Otomatik yedekleme (6 saatte bir)
- **Google Calendar:** Takvim senkronizasyonu

---

## 7. Sikca Sorulan Sorular

### Giris ve Hesap

**S: Sifremi unuttum, ne yapmaliyim?**
C: Yoneticinizden yeni giris bilgileri gondermesini isteyin. Yonetici, kullanici yonetimi sayfasindan "Envoyer les identifiants" butonunu kullanabilir.

**S: Birden fazla cihazda kullanabilir miyim?**
C: Evet. Hem web hem mobil uygulamadan ayni hesapla giris yapabilirsiniz. Verileriniz anlik senkronize olur.

### Aramalar

**S: Kacirilmis aramalari nasil geri ararimin?**
C: Mobil uygulamada kacirilmis aramanin yanindaki yesil telefon ikonuna dokunun. Web'de arama detayina girip telefon numarasina tiklayin.

**S: Arama notlari otomatik ozetleniyor mu?**
C: Evet. AI Commandant'in Telefon sekmesinde arama notlarinizi yapistirin, sistem otomatik olarak kararlar, aksiyon maddeleri ve gorevler cikarir.

### Gorevler

**S: Geciken gorevleri nasil gorurum?**
C: Mobil dashboard'da kirmizi uyari banderi geciken gorevleri gosterir. Gorevler ekraninda kirmizi sol kenarli satirlar geciken gorevlerdir.

**S: Gorev durumunu nasil degistiririm?**
C: Gorev satirindaki daireye dokunun. Sira: Beklemede > Devam ediyor > Tamamlandi.

### Faturalama

**S: Otomatik fatura nasil olustururum?**
C: Lisans Yonetimi sayfasinda "Auto-generate invoice" secenegini aktif edin. Sistem aylik kullanim bazli fatura olusturur.

**S: Odeme hatirlatma nasil gonderirim?**
C: AI Commandant > Finance sekmesinden gecikmi faturalar icin profesyonel hatirlatma e-postalari olusturabilirsiniz.

### Mobil Uygulama

**S: Mobil uygulamayi nasil yuklerim?**
C: iOS'ta App Store'dan, Android'de Google Play'den "Expo Go" uygulamasini indirin. QR kodu tarayarak baglanin.

**S: Bildirimler gelmiyor, ne yapmaliyim?**
C: Dashboard'daki zil ikonundan bildirimler ekranini kontrol edin. Uygulama bildirim izinlerinin acik oldugundan emin olun.

### Yapay Zeka

**S: AI Commandant nasil calisir?**
C: 3 farkli AI modeli (Gemini, OpenAI, Anthropic) kullanarak verilerinizi analiz eder. Briefing sekmesinden gunluk ozet, telefon sekmesinden arama destegialaniniz, e-posta sekmesinden akilli yanit alabilirsiniz.

**S: Yuz tanima nasil kullanilir?**
C: Mobil uygulamada Plus > Reconnaissance faciale'e gidin. Kamera izni verin. Scanner sekmesinden yuz tarayin, Enregistrer'den yeni profil kaydedin.

---

## Kisayollar ve Ipuclari

### Web Uygulamasi
- **Hizli Arama:** Ust cubuktan tum moduller arasinda arama yapin
- **Komut Paleti:** Hizli navigasyon icin kullanin
- **Filtreler:** Her listede durum, kategori ve tarih filtreleri mevcuttur

### Mobil Uygulama
- **Asagi Cekin:** Tum listelerde veriyi yenilemek icin asagi cekin
- **Hizli Olustur:** Dashboard'daki ust butunlardan aninda kayit olusturun
- **Tek Tikla Arama:** Kisi listesindeki telefon ikonuna dokunun
- **Gecikme Takibi:** Gorev listesindeki kirmizi rozetleri takip edin

### Verimlilik Onerileri
1. Her gun AI Commandant'in Briefing sekmesini kontrol edin
2. Kacirilmis aramalari hemen geri arayin (mobilde tek tikla)
3. Gorevlere son tarih atayin - gecikme uyarilari otomatik gelir
4. Otomasyonlari aktif edin - tekrarlayan isler otomatik yapilsin
5. Yuz tanima ile ziyaretci kayit surecini hizlandirin

---

*Agent de Bureau v1.0 - Profesyonel Ofis Yonetim Sistemi*
*Son guncelleme: Nisan 2026*
