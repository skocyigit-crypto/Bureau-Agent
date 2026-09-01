import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n";
import { Plus,Trash2 } from "lucide-react";
import { useMemo } from "react";

/**
 * Éditeur de lignes de devis/facture, avec aperçu des totaux en direct.
 *
 * IMPORTANT: cet aperçu est purement visuel. Le serveur RECALCULE les totaux à
 * l'enregistrement à partir des seules lignes (services/invoice-totals.ts) et
 * ignore tout total envoyé par le client. Le montant qui fait foi est donc
 * toujours celui renvoyé par l'API, pas celui affiché ici — l'aperçu reproduit
 * simplement la même règle pour éviter les surprises pendant la saisie.
 */
export interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computePreview(items: LineItem[], autoliquidation = false) {
  const lines = items.map((l) => ({ ...l, total: round2((l.quantity || 0) * (l.unitPrice || 0)) }));
  const subtotal = round2(lines.reduce((s, l) => s + l.total, 0));
  const byRate = new Map<number, number>();
  for (const l of lines) {
    const rate = autoliquidation ? 0 : Math.max(0, l.taxRate || 0);
    byRate.set(rate, (byRate.get(rate) ?? 0) + l.total);
  }
  const vat = [...byRate.entries()]
    .map(([taxRate, base]) => ({ taxRate, base: round2(base), amount: autoliquidation ? 0 : round2(round2(base) * (taxRate / 100)) }))
    .sort((a, b) => b.taxRate - a.taxRate);
  const taxAmount = autoliquidation ? 0 : round2(vat.reduce((s, v) => s + v.amount, 0));
  return { subtotal, taxAmount, totalAmount: round2(subtotal + taxAmount), vat };
}

const fmt = (n: number, currency = "EUR") =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(n);

export function LineItemsEditor({
  items,
  onChange,
  autoliquidation = false,
  currency = "EUR",
}: {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  autoliquidation?: boolean;
  currency?: string;
}) {
  const { t } = useTranslation();
  const totals = useMemo(() => computePreview(items, autoliquidation), [items, autoliquidation]);

  const update = (i: number, patch: Partial<LineItem>) => {
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  };
  const add = () => onChange([...items, { description: "", quantity: 1, unitPrice: 0, taxRate: 20 }]);
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t("lineItemsEditor.lines")}</span>
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
          <Plus className="w-3 h-3 mr-1" /> {t("lineItemsEditor.addLine")}
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">{t("lineItemsEditor.emptyState")}</p>
      ) : (
        <div className="space-y-1.5">
          <div className="hidden md:grid grid-cols-[1fr_70px_90px_70px_90px_32px] gap-2 text-[10px] text-muted-foreground px-1">
            <span>{t("lineItemsEditor.colDesignation")}</span><span>{t("lineItemsEditor.colQty")}</span><span>{t("lineItemsEditor.colUnitPrice")}</span><span>{t("lineItemsEditor.colVat")}</span><span className="text-right">{t("lineItemsEditor.colTotal")}</span><span />
          </div>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_70px_90px_70px_90px_32px] gap-2 items-center">
              <Input value={it.description} onChange={(e) => update(i, { description: e.target.value })} placeholder={t("lineItemsEditor.placeholder")} className="h-8 text-sm" />
              <Input type="number" value={it.quantity} onChange={(e) => update(i, { quantity: parseFloat(e.target.value) || 0 })} className="h-8 text-sm" />
              <Input type="number" step="0.01" value={it.unitPrice} onChange={(e) => update(i, { unitPrice: parseFloat(e.target.value) || 0 })} className="h-8 text-sm" />
              <Input type="number" value={autoliquidation ? 0 : it.taxRate} disabled={autoliquidation} onChange={(e) => update(i, { taxRate: parseFloat(e.target.value) || 0 })} className="h-8 text-sm" />
              <span className="text-sm text-right tabular-nums pr-1">{fmt(round2((it.quantity || 0) * (it.unitPrice || 0)), currency)}</span>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => remove(i)} aria-label={t("common.delete")}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /></Button>
            </div>
          ))}
        </div>
      )}

      <div className="border-t pt-2 mt-2 space-y-0.5 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">{t("lineItemsEditor.subtotal")}</span><span className="tabular-nums">{fmt(totals.subtotal, currency)}</span></div>
        {autoliquidation ? (
          <div className="flex justify-between text-xs text-amber-600"><span>{t("lineItemsEditor.vat")}</span><span>{t("lineItemsEditor.autoliquidation")}</span></div>
        ) : (
          totals.vat.map((v) => (
            <div key={v.taxRate} className="flex justify-between text-xs text-muted-foreground"><span>{t("lineItemsEditor.vatRate", { rate: v.taxRate })}</span><span className="tabular-nums">{fmt(v.amount, currency)}</span></div>
          ))
        )}
        <div className="flex justify-between font-semibold pt-1 border-t"><span>{t("lineItemsEditor.totalTtc")}</span><span className="tabular-nums text-emerald-600">{fmt(totals.totalAmount, currency)}</span></div>
        <p className="text-[10px] text-muted-foreground pt-1">{t("lineItemsEditor.serverRecalc")}</p>
      </div>
    </div>
  );
}
