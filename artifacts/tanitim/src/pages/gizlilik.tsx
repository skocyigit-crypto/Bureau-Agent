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
      <main className="container mx-auto px-4 pt-32 pb-20 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">Gizlilik Politikası</h1>
        <p className="text-muted-foreground mb-10">Son güncelleme: Mayıs 2026 — KVKK ve GDPR uyumlu</p>

        <section className="space-y-8 text-sm leading-relaxed text-foreground/80">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-3">1. Veri sorumlusu</h2>
            <p>Merkezi Paris (Fransa) olan Agent de Bureau SAS, agentdebureau.fr platformu ve Büro Ajanı mobil uygulaması aracılığıyla toplanan kişisel verilerinizin veri sorumlusudur.</p>
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
              <li><strong>Konum verileri</strong> (mobil uygulama): yalnızca açık onayla, iş yerinde GPS yoklaması için, 30 gün saklanır</li>
            </ul>
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
