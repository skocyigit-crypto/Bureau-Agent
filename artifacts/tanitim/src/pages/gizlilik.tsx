import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useState } from "react";
import { useDocumentMeta } from "@/hooks/use-document-meta";
import { PAGE_META } from "@/lib/page-meta";

export default function Gizlilik() {
  const [demoOpen, setDemoOpen] = useState(false);
  useDocumentMeta(PAGE_META.gizlilik);
  return (
    <div className="min-h-screen bg-background">
      <Navbar onDemoClick={() => setDemoOpen(true)} />
      <main id="contenu" className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Gizlilik Politikası</h1>
        <p className="text-muted-foreground mb-10">Son güncelleme: Mayıs 2026 — KVKK ve GDPR uyumlu</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Veri sorumlusu</h2>
            <p>Merkezi Haguenau (Fransa) olan SK GROUP (SAS), agentdebureau.fr platformu ve Büro Ajanı mobil uygulaması aracılığıyla toplanan kişisel verilerinizin veri sorumlusudur.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2. Toplanan veriler</h2>
            <p>Aşağıdaki verileri topluyoruz:</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Kimlik verileri</strong>: ad, soyad, e-posta adresi, telefon numarası</li>
              <li><strong>Mesleki veriler</strong>: şirket adı, vergi numarası, faaliyet sektörü</li>
              <li><strong>Bağlantı verileri</strong>: IP adresi, giriş kayıtları, gezinme verileri</li>
              <li><strong>İş verileri</strong>: CRM kontakları, arama kayıtları, üretilen belgeler (teklif, fatura)</li>
              <li><strong>Ödeme verileri</strong>: banka bilgileri (ödeme sağlayıcımız tarafından işlenir)</li>
              {/* Onceki metin iki noktada yanlisti: takibi "yalnizca acik
                  onayla" ve "is yerinde GPS yoklamasi" diye anlatiyordu.
                  Gerceginde takip surekli, arka planda calisiyor ve isveren
                  ozelligi actiginda calisan icin zorunlu — reddeden uygulamayi
                  kullanamiyor. Yanlis anlatilan bir toplama, hic
                  anlatilmamis olandan daha kotudur. Ayrinti 2/A'da. */}
              <li><strong>Konum verileri</strong> (mobil uygulama): işvereniniz yoklama takibini açtığında, sürekli ve arka planda toplanır (bkz. 2/A)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">2/A. Konumla yoklama takibi (mobil uygulama)</h2>
            <p>
              Bu işleme yalnızca yoklama takibini açan kuruluşlar için ve
              yalnızca mobil uygulamada geçerlidir; web sürümünde yoktur.
            </p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>
                <strong>Toplanan</strong>: yaklaşık enlem ve boylam, zaman
                damgası, ölçüm doğruluğu ve varsa pil düzeyi. Ölçüm, siz giriş
                yapmış durumdayken en çok 60 saniyede bir ya da 100 metrede bir,
                <strong> uygulama arka plandayken de</strong> yapılır.
              </li>
              <li>
                <strong>İşverenin gördüğü</strong>: yalnızca hangi bölgede
                (şantiye, ofis, saha) olduğunuz ve son geçiş saati. Tam
                koordinatlar sunucularımızdan çıkmaz; sadece bölge içinde olup
                olmadığınızı hesaplamak için kullanılır ve yönetim ekranına
                gönderilmez.
              </li>
              <li>
                <strong>Saklama</strong>: 30 gün. Daha eski giriş/çıkış olayları
                ve 30 gündür hareketsiz kullanıcıların son bilinen konumu
                otomatik olarak silinir.
              </li>
              <li>
                <strong>Sorumlu</strong>: takibi açma, bölgeleri ve amacı
                belirleme kararı işvereninize aittir; veri sorumlusu odur. SK
                GROUP veri işleyen sıfatıyla hareket eder
                (<a href="/dpa" className="text-primary underline">DPA</a>).
              </li>
            </ul>
            <p className="mt-3 text-sm">
              Çalışanın konum takibi sıkı koşullara bağlıdır. Takip, güdülen
              amaçla orantılı olmalı, çalışma saatleri dışında gözetim aracına
              dönüşmemeli ve hem çalışan temsilcileri hem de ilgili kişiler
              önceden bilgilendirilmelidir. Bu koşulları sağlamak, gerektiğinde
              etki değerlendirmesi yapmak ve çalışma saatleri dışında takibin
              kapatılabilmesini sağlamak, özelliği açan işverenin
              sorumluluğundadır.
            </p>
            <p className="mt-3 text-sm">
              Erişim, düzeltme, silme ve itiraz haklarınızı işvereninize ya da
              <strong> privacy@agentdebureau.fr</strong> adresine
              başvurarak kullanabilirsiniz.
            </p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">3. İşleme amaçları</h2>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li>SaaS hizmetinin sunulması ve yönetimi</li>
              <li>Faturalandırma ve abonelik yönetimi</li>
              <li>Müşteri desteği ve teknik yardım</li>
              <li>Platformun iyileştirilmesi (anonimleştirilmiş veriler)</li>
              <li>Hizmetle ilgili iletişim (onayınızla)</li>
              <li>Yasal yükümlülüklere uyum</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">4. Hukuki dayanak</h2>
            <p>Verilerinizin işlenmesi şunlara dayanır: sözleşmenin ifası (Kullanım Koşulları), açık rızanız (pazarlama iletişimi), yasal yükümlülüklerimiz (muhasebe, KDV) ve meşru çıkarlarımız (güvenlik, dolandırıcılığın önlenmesi).</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">5. Saklama süresi</h2>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Hesap verileri</strong>: abonelik süresi + iptalden sonra 3 yıl</li>
              <li><strong>Faturalandırma verileri</strong>: 10 yıl (muhasebe yasası gereği)</li>
              <li><strong>Log verileri</strong>: en fazla 12 ay</li>
              <li><strong>Arama kayıtları</strong>: müşteri ayarına göre (varsayılan en fazla 12 ay)</li>
              <li><strong>GPS konum verileri</strong>: 30 gün sonra otomatik silinir</li>
            </ul>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">6. Haklarınız (KVKK / GDPR)</h2>
            <p>KVKK ve GDPR uyarınca aşağıdaki haklara sahipsiniz:</p>
            <ul className="mt-2 space-y-1 pl-4 list-disc">
              <li><strong>Erişim hakkı</strong>: verilerinizin bir kopyasını alma</li>
              <li><strong>Düzeltme hakkı</strong>: hatalı verilerinizi düzeltme</li>
              <li><strong>Silme hakkı</strong>: verilerinizin silinmesini isteme</li>
              <li><strong>Taşınabilirlik hakkı</strong>: verilerinizi yapılandırılmış bir formatta alma</li>
              <li><strong>İtiraz hakkı</strong>: belirli işlemlere itiraz etme</li>
              <li><strong>İşlemenin kısıtlanması hakkı</strong>: işlemenin sınırlandırılmasını isteme</li>
            </ul>
            <p className="mt-3">Haklarınızı kullanmak için: <a href="mailto:privacy@agentdebureau.fr" className="text-primary underline">privacy@agentdebureau.fr</a>. Ayrıca <strong>KVKK Kurumu</strong>'na (Türkiye) veya <strong>CNIL</strong>'e (Fransa, www.cnil.fr) şikâyette bulunabilirsiniz.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">7. Çerezler</h2>
            <p>Yalnızca hizmetin çalışması için kesinlikle gerekli olan çerezleri (oturum, kimlik doğrulama) kullanıyoruz. Açık rızanız olmadan reklam veya üçüncü taraf izleme çerezi kullanılmaz.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">8. AB dışı transferler</h2>
            <p>Bazı alt yüklenicilerimiz (barındırma, işlemsel e-posta) AB dışında bulunabilir. Bu aktarımlar uygun güvencelerle (Avrupa Komisyonu Standart Sözleşme Maddeleri) çerçevelenmiştir.</p>
          </div>

          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">9. DPO iletişim</h2>
            <p>Veri korumayla ilgili her türlü soru için: <a href="mailto:privacy@agentdebureau.fr" className="text-primary underline">privacy@agentdebureau.fr</a></p>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
