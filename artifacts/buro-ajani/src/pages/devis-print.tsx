import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

function fmt(v: any) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(parseFloat(v || "0"));
}
function fmtDate(d: any) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR");
}

export default function DevisPrintPage() {
  const [, params] = useRoute("/devis/:id/apercu");
  const [devis, setDevis] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.id) return;
    Promise.all([
      fetch(`${BASE}/api/devis/${params.id}`, { credentials: "include" }).then(r => r.json()),
      fetch(`${BASE}/api/org-profile`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([d, o]) => { setDevis(d); setOrg(o); setLoading(false); });
  }, [params?.id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
  );
  if (!devis || devis.error) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <p className="text-muted-foreground">Devis introuvable.</p>
      <Link href="/devis"><Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button></Link>
    </div>
  );

  const items: any[] = devis.items || [];
  const statusLabels: Record<string, string> = { brouillon: "Brouillon", envoye: "Envoyé", accepte: "Accepté", refuse: "Refusé", expire: "Expiré" };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="print:hidden flex items-center gap-3 px-6 py-4 bg-white border-b shadow-sm">
        <Link href="/devis"><Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button></Link>
        <span className="text-sm text-muted-foreground flex-1">Aperçu — {devis.reference}</span>
        <Button onClick={() => window.print()} size="sm"><Printer className="w-4 h-4 mr-2" />Imprimer / PDF</Button>
      </div>

      <div className="max-w-4xl mx-auto my-8 print:my-0 bg-white shadow-lg print:shadow-none rounded-lg print:rounded-none overflow-hidden">
        <div className="p-10 print:p-8">
          <div className="flex justify-between items-start mb-10">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-1">DEVIS</h1>
              <p className="text-lg font-mono text-gray-500">{devis.reference}</p>
              <span className={`inline-block mt-2 px-3 py-1 text-xs rounded-full font-medium ${
                devis.status === "accepte" ? "bg-green-100 text-green-700" :
                devis.status === "refuse" ? "bg-red-100 text-red-700" :
                devis.status === "envoye" ? "bg-blue-100 text-blue-700" :
                devis.status === "expire" ? "bg-gray-200 text-gray-600" :
                "bg-amber-100 text-amber-700"
              }`}>{statusLabels[devis.status] || devis.status}</span>
            </div>
            <div className="text-right">
              {org && <div className="text-lg font-bold text-gray-900 mb-1">{org.name}</div>}
              {org?.address && <div className="text-sm text-gray-500">{org.address}</div>}
              {org?.email && <div className="text-sm text-gray-500">{org.email}</div>}
              {org?.phone && <div className="text-sm text-gray-500">{org.phone}</div>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Destinataire</h3>
              <div className="text-base font-semibold text-gray-900">{devis.clientName}</div>
              {devis.clientCompany && <div className="text-sm text-gray-600">{devis.clientCompany}</div>}
              {devis.clientEmail && <div className="text-sm text-gray-500">{devis.clientEmail}</div>}
              {devis.clientPhone && <div className="text-sm text-gray-500">{devis.clientPhone}</div>}
              {devis.clientAddress && <div className="text-sm text-gray-500 mt-1 whitespace-pre-line">{devis.clientAddress}</div>}
            </div>
            <div className="text-right">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">Détails</h3>
              <div className="text-sm text-gray-600 space-y-1">
                <div><span className="font-medium">Date :</span> {fmtDate(devis.createdAt)}</div>
                <div><span className="font-medium">Valable jusqu'au :</span> {fmtDate(devis.validUntil)}</div>
                {devis.title && <div className="mt-2 text-gray-700 font-medium">{devis.title}</div>}
              </div>
            </div>
          </div>

          {devis.description && (
            <div className="mb-6 p-4 bg-gray-50 rounded text-sm text-gray-600">{devis.description}</div>
          )}

          <table className="w-full mb-6 text-sm">
            <thead>
              <tr className="border-b-2 border-gray-200">
                <th className="text-left py-3 pr-4 font-semibold text-gray-700 w-1/2">Description</th>
                <th className="text-right py-3 px-2 font-semibold text-gray-700">Qté</th>
                <th className="text-right py-3 px-2 font-semibold text-gray-700">Prix unit.</th>
                <th className="text-right py-3 px-2 font-semibold text-gray-700">TVA %</th>
                <th className="text-right py-3 pl-2 font-semibold text-gray-700">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={5} className="py-4 text-center text-gray-400">Aucune ligne</td></tr>
              ) : items.map((item: any, i: number) => (
                <tr key={i} className="border-b border-gray-100">
                  <td className="py-3 pr-4 text-gray-800">{item.description}</td>
                  <td className="py-3 px-2 text-right text-gray-700">{item.quantity}</td>
                  <td className="py-3 px-2 text-right text-gray-700">{fmt(item.unitPrice)}</td>
                  <td className="py-3 px-2 text-right text-gray-500">{item.taxRate ?? 0}%</td>
                  <td className="py-3 pl-2 text-right font-medium text-gray-900">{fmt(item.total ?? (item.quantity * item.unitPrice))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mb-8">
            <div className="w-72 space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Sous-total HT</span><span>{fmt(devis.subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>TVA</span><span>{fmt(devis.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-gray-900 border-t-2 border-gray-200 pt-2 mt-2">
                <span>Total TTC</span><span>{fmt(devis.totalAmount)} {devis.currency}</span>
              </div>
            </div>
          </div>

          {devis.notes && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Notes</h4>
              <p className="text-sm text-gray-600 whitespace-pre-line">{devis.notes}</p>
            </div>
          )}
          {devis.conditions && (
            <div className="pt-4 border-t border-gray-100">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Conditions</h4>
              <p className="text-sm text-gray-500 whitespace-pre-line">{devis.conditions}</p>
            </div>
          )}

          <div className="mt-12 pt-6 border-t border-gray-100 text-center text-xs text-gray-400">
            Devis généré par Agent de Bureau — {new Date().toLocaleDateString("fr-FR")}
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          @page { margin: 1cm; size: A4; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
