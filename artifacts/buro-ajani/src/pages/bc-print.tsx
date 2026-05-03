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

const STATUS_LABELS: Record<string, string> = {
  brouillon: "Brouillon", envoye: "Envoyé", confirme: "Confirmé", recu: "Reçu", annule: "Annulé",
};

export default function BcPrintPage() {
  const [, params] = useRoute("/commandes-fournisseur/:id/apercu");
  const [bc, setBc] = useState<any>(null);
  const [org, setOrg] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.id) return;
    Promise.all([
      fetch(`${BASE}/api/commandes-fournisseur/${params.id}`, { credentials: "include" }).then(r => r.json()),
      fetch(`${BASE}/api/org-profile`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([b, o]) => { setBc(b); setOrg(o); setLoading(false); });
  }, [params?.id]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>
  );
  if (!bc || bc.error) return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <p className="text-muted-foreground">Bon de commande introuvable.</p>
      <Link href="/commandes-fournisseur"><Button variant="outline"><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button></Link>
    </div>
  );

  const items: any[] = bc.items || [];

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      <div className="print:hidden flex items-center gap-3 px-6 py-4 bg-white border-b shadow-sm">
        <Link href="/commandes-fournisseur"><Button variant="outline" size="sm"><ArrowLeft className="w-4 h-4 mr-2" />Retour</Button></Link>
        <span className="text-sm text-muted-foreground flex-1">Aperçu — {bc.reference}</span>
        <Button onClick={() => window.print()} size="sm"><Printer className="w-4 h-4 mr-2" />Imprimer / PDF</Button>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 15mm; }
          body { font-size: 11pt; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto bg-white shadow-lg my-8 print:my-0 print:shadow-none">
        <div className="p-10 print:p-8">
          <div className="flex justify-between items-start mb-10">
            <div>
              {org?.logo && <img src={org.logo} alt="Logo" className="h-16 mb-3 object-contain" />}
              <h2 className="text-lg font-bold text-gray-800">{org?.name || "Votre Société"}</h2>
              {org?.address && <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{org.address}</p>}
              {org?.email && <p className="text-sm text-gray-500">{org.email}</p>}
              {org?.phone && <p className="text-sm text-gray-500">{org.phone}</p>}
            </div>
            <div className="text-right">
              <div className="inline-block bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 mb-2">
                <p className="text-xs text-indigo-500 uppercase tracking-wide font-medium">Bon de Commande</p>
                <p className="text-xl font-bold text-indigo-700">{bc.reference}</p>
              </div>
              <div className="text-sm text-gray-500 space-y-0.5">
                <p>Date : <span className="font-medium text-gray-700">{fmtDate(bc.createdAt)}</span></p>
                {bc.expectedDelivery && <p>Livraison souhaitée : <span className="font-medium text-gray-700">{fmtDate(bc.expectedDelivery)}</span></p>}
                <p>Statut : <span className="font-medium text-gray-700">{STATUS_LABELS[bc.status] || bc.status}</span></p>
              </div>
            </div>
          </div>

          <div className="mb-8 p-4 bg-gray-50 rounded-lg">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Fournisseur</p>
            <p className="font-semibold text-gray-800">{bc.fournisseurName}</p>
            {bc.fournisseurAddress && <p className="text-sm text-gray-600 whitespace-pre-line">{bc.fournisseurAddress}</p>}
            {bc.fournisseurEmail && <p className="text-sm text-gray-600">{bc.fournisseurEmail}</p>}
            {bc.fournisseurPhone && <p className="text-sm text-gray-600">{bc.fournisseurPhone}</p>}
          </div>

          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="bg-gray-800 text-white">
                <th className="text-left py-2 px-3 rounded-tl">Description</th>
                <th className="text-left py-2 px-3">Référence</th>
                <th className="text-right py-2 px-3">Qté</th>
                <th className="text-right py-2 px-3">PU HT</th>
                <th className="text-right py-2 px-3">TVA</th>
                <th className="text-right py-2 px-3 rounded-tr">Total HT</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: any, i: number) => (
                <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="py-2 px-3 text-gray-800">{item.description}</td>
                  <td className="py-2 px-3 text-gray-600 font-mono text-xs">{item.reference || "—"}</td>
                  <td className="py-2 px-3 text-right">{item.quantity}</td>
                  <td className="py-2 px-3 text-right">{fmt(item.unitPrice)}</td>
                  <td className="py-2 px-3 text-right">{item.taxRate || 0}%</td>
                  <td className="py-2 px-3 text-right font-medium">{fmt(item.quantity * item.unitPrice)}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-gray-400 italic">Aucun article</td></tr>
              )}
            </tbody>
          </table>

          <div className="flex justify-end mb-8">
            <div className="w-64 space-y-1.5">
              <div className="flex justify-between text-sm text-gray-600"><span>Sous-total HT</span><span>{fmt(bc.subtotal)}</span></div>
              <div className="flex justify-between text-sm text-gray-600"><span>TVA</span><span>{fmt(bc.taxAmount)}</span></div>
              <div className="flex justify-between font-bold text-base text-gray-800 border-t pt-2 mt-1">
                <span>Total TTC</span><span className="text-indigo-700">{fmt(bc.totalAmount)}</span>
              </div>
            </div>
          </div>

          {(bc.notes || bc.conditions) && (
            <div className="border-t pt-4 grid grid-cols-2 gap-4 text-sm text-gray-600">
              {bc.notes && <div><p className="font-semibold text-gray-700 mb-1">Notes</p><p className="whitespace-pre-line">{bc.notes}</p></div>}
              {bc.conditions && <div><p className="font-semibold text-gray-700 mb-1">Conditions</p><p className="whitespace-pre-line">{bc.conditions}</p></div>}
            </div>
          )}

          <div className="mt-10 pt-6 border-t text-xs text-gray-400 text-center">
            Document généré le {new Date().toLocaleDateString("fr-FR")} · {org?.name || "Agent de Bureau"}
          </div>
        </div>
      </div>
    </div>
  );
}
