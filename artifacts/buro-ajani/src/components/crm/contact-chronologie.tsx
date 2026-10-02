import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "wouter";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export type ElementChronologie = {
  type: string;
  id: number;
  date: string;
  titre: string | null;
  statut: string | null;
  detail: string | null;
  montant: number | null;
  lien: string;
};

const fmtMontant = (n: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n);

/**
 * Le fil d'un client : appels, messages, WhatsApp, devis, factures,
 * rendez-vous, taches, chantiers, opportunites — un seul fil, du plus recent
 * au plus ancien. Chaque ligne mene a sa fiche : un historique qu'on ne peut
 * pas ouvrir oblige a chercher la meme chose une seconde fois ailleurs.
 *
 * Quatre etats distincts (chargement, erreur, vide, donnees) : un fil vide
 * et un fil qui n'a pas pu se charger ne disent pas la meme chose.
 */
export function ContactChronologie({ contactId }: { contactId: number }) {
  const { t } = useTranslation();
  const [elements, setElements] = useState<ElementChronologie[]>([]);
  const [suivant, setSuivant] = useState<string | null>(null);
  const [etat, setEtat] = useState<"chargement" | "erreur" | "pret">("chargement");
  const [plusEnCours, setPlusEnCours] = useState(false);

  const charger = useCallback(async (curseur: string | null) => {
    const url = `${BASE}/api/contacts/${contactId}/chronologie?limit=30${curseur ? `&avant=${encodeURIComponent(curseur)}` : ""}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as { elements: ElementChronologie[]; suivant: string | null };
  }, [contactId]);

  const premierePage = useCallback(async () => {
    setEtat("chargement");
    try {
      const r = await charger(null);
      setElements(r.elements);
      setSuivant(r.suivant);
      setEtat("pret");
    } catch {
      setEtat("erreur");
    }
  }, [charger]);

  useEffect(() => { void premierePage(); }, [premierePage]);

  const pageSuivante = async () => {
    if (!suivant) return;
    setPlusEnCours(true);
    try {
      const r = await charger(suivant);
      setElements((e) => [...e, ...r.elements]);
      setSuivant(r.suivant);
    } catch {
      setEtat("erreur");
    } finally {
      setPlusEnCours(false);
    }
  };

  if (etat === "chargement") {
    return <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground py-6"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />{t("crm.chronologie.chargement")}</div>;
  }
  if (etat === "erreur") {
    return (
      <div role="alert" className="flex items-center gap-3 text-sm text-red-600 py-6">
        <AlertCircle className="w-4 h-4" aria-hidden="true" />{t("crm.chronologie.erreur")}
        <Button variant="outline" size="sm" onClick={() => void premierePage()}>{t("crm.chronologie.reessayer")}</Button>
      </div>
    );
  }
  if (elements.length === 0) {
    return <p className="text-sm text-muted-foreground py-6" data-testid="chronologie-vide">{t("crm.chronologie.vide")}</p>;
  }
  return (
    <div className="space-y-2">
      <ol className="divide-y" aria-label={t("crm.chronologie.titre")}>
        {elements.map((e) => (
          <li key={`${e.type}:${e.id}`} className="py-2" data-testid={`chronologie-${e.type}-${e.id}`}>
            <Link href={e.lien} className="flex items-start gap-3 hover:bg-muted/30 rounded px-2 py-1">
              <Badge variant="outline" className="shrink-0 text-[10px]">{t(`crm.chronologie.type.${e.type}`)}</Badge>
              <span className="flex-1 min-w-0">
                <span className="block text-sm truncate">{e.titre || "—"}</span>
                <span className="block text-xs text-muted-foreground">
                  {new Date(e.date).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}
                  {e.statut ? ` · ${e.statut}` : ""}
                </span>
              </span>
              {e.montant != null && <span className="text-sm tabular-nums">{fmtMontant(e.montant)}</span>}
            </Link>
          </li>
        ))}
      </ol>
      {suivant && (
        <Button variant="outline" size="sm" onClick={() => void pageSuivante()} disabled={plusEnCours}>
          {plusEnCours && <Loader2 className="w-3 h-3 animate-spin mr-1" aria-hidden="true" />}{t("crm.chronologie.plus")}
        </Button>
      )}
    </div>
  );
}
