import { Button } from "@/components/ui/button";
import { confirmAction } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { Copy, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

type Candidat = {
  id: number;
  firstName: string;
  lastName: string;
  company: string | null;
  email: string | null;
  phone: string;
  motifs: Array<"telephone" | "email" | "nom_societe">;
  references: Record<string, number>;
};

/**
 * Bandeau « doublon possible » de la fiche contact.
 *
 * La detection propose, elle ne decide pas : la fusion est un geste
 * explicite, precede d'une confirmation qui dit ce qui va bouger et que la
 * fiche absorbee reste restaurable depuis la corbeille. Sans doublon, le
 * bandeau n'existe pas ; si la recherche echoue, il le dit au lieu de se taire
 * (un silence laisserait croire qu'il n'y a pas de doublon).
 */
export function ContactDoublons({ contactId, onFusion }: { contactId: number; onFusion?: () => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [candidats, setCandidats] = useState<Candidat[]>([]);
  const [erreur, setErreur] = useState(false);
  const [fusionEnCours, setFusionEnCours] = useState<number | null>(null);

  const charger = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/contacts/${contactId}/doublons`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      setCandidats(d.candidats ?? []);
      setErreur(false);
    } catch {
      setErreur(true);
    }
  }, [contactId]);

  useEffect(() => { void charger(); }, [charger]);

  const fusionner = async (c: Candidat) => {
    const nom = `${c.firstName} ${c.lastName}`.trim();
    if (!(await confirmAction({ title: t("crm.doublons.confirmTitre", { nom }), description: t("crm.doublons.confirmDesc"), confirmLabel: t("crm.doublons.confirmAction") }))) return;
    setFusionEnCours(c.id);
    try {
      const res = await fetch(`${BASE}/api/contacts/${contactId}/fusion`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ absorbeId: c.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: t("crm.doublons.erreur"), description: d.error ?? "", variant: "destructive" });
        return;
      }
      const total = Object.values((d.deplaces ?? {}) as Record<string, number>).reduce((s, n) => s + n, 0);
      toast({ title: t("crm.doublons.succes"), description: t("crm.doublons.succesDesc", { count: total }) });
      await charger();
      onFusion?.();
    } catch {
      toast({ title: t("crm.doublons.erreur"), variant: "destructive" });
    } finally {
      setFusionEnCours(null);
    }
  };

  if (erreur) return <p role="alert" className="text-xs text-red-600">{t("crm.doublons.erreurChargement")}</p>;
  if (candidats.length === 0) return null;
  return (
    <section aria-label={t("crm.doublons.titre")} className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2" data-testid="bandeau-doublons">
      <p className="text-sm font-medium flex items-center gap-2"><Copy className="w-4 h-4" aria-hidden="true" />{t("crm.doublons.titre")}</p>
      <p className="text-xs text-muted-foreground">{t("crm.doublons.description")}</p>
      <ul className="space-y-1">
        {candidats.map((c) => {
          const lignes = Object.values(c.references ?? {}).reduce((s, n) => s + n, 0);
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid={`doublon-${c.id}`}>
              <a href={`${BASE}/contacts/${c.id}`} className="font-medium underline">{`${c.firstName} ${c.lastName}`.trim()}</a>
              <span className="text-xs text-muted-foreground">({c.motifs.map((m) => t(`crm.doublons.motif.${m}`)).join(", ")})</span>
              <span className="text-xs text-muted-foreground">{t("crm.doublons.lignes", { count: lignes })}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs ml-auto" onClick={() => void fusionner(c)} disabled={fusionEnCours !== null}>
                {fusionEnCours === c.id && <Loader2 className="w-3 h-3 animate-spin mr-1" aria-hidden="true" />}{t("crm.doublons.fusionner")}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
