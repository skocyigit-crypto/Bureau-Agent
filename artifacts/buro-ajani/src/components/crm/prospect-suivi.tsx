import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { useEffect, useState } from "react";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

/** Meme liste, meme ordre que le serveur (services/crm-decouverte.ts). */
export const POINTS_DECOUVERTE = ["adresse_chantier", "type_travaux", "surface", "acces", "photos", "budget", "delai", "decideur"] as const;
export type ListeDecouverte = Partial<Record<(typeof POINTS_DECOUVERTE)[number], { ok: boolean; valeur?: string | null }>>;

export function pointsManquants(liste: ListeDecouverte | null | undefined): string[] {
  return POINTS_DECOUVERTE.filter((p) => !liste?.[p]?.ok);
}

/** `datetime-local` attend l'heure LOCALE, sans fuseau. */
function versSaisieLocale(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function enregistrer(prospectId: number, corps: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/prospects/${prospectId}`, {
    method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corps),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error ?? String(res.status));
  return d;
}

/**
 * Prochaine action : quoi, quand, qui. Le responsable est choisi parmi les
 * utilisateurs de l'organisation (et non tape en texte libre) pour que
 * « Aujourd'hui » sache a qui revient la relance.
 */
export function ProchaineAction({ prospect, onSaved }: {
  prospect: { id: number; nextActionLabel?: string | null; nextActionAt?: string | null; nextActionOwnerId?: number | null };
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [libelle, setLibelle] = useState(prospect.nextActionLabel ?? "");
  const [quand, setQuand] = useState(versSaisieLocale(prospect.nextActionAt));
  const [responsable, setResponsable] = useState(prospect.nextActionOwnerId ? String(prospect.nextActionOwnerId) : "");
  const [membres, setMembres] = useState<Array<{ id: number; name: string }>>([]);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/team-status`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembres(d.members ?? []))
      .catch(() => setMembres([]));
  }, []);

  const enRetard = !!prospect.nextActionAt && new Date(prospect.nextActionAt).getTime() < Date.now();

  const sauver = async () => {
    setEnCours(true);
    try {
      await enregistrer(prospect.id, {
        nextActionLabel: libelle.trim() || null,
        nextActionAt: quand ? new Date(quand).toISOString() : null,
        nextActionOwnerId: responsable ? Number(responsable) : null,
      });
      toast({ title: t("crm.suivi.enregistre") });
      onSaved?.();
    } catch (e) {
      toast({ title: t("crm.suivi.erreur"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Card data-testid="carte-prochaine-action">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {t("crm.suivi.titre")}
          {enRetard && <Badge variant="destructive" className="text-[10px]">{t("crm.suivi.enRetard")}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div><Label htmlFor="pa-libelle" className="text-xs">{t("crm.suivi.libelle")}</Label><Input id="pa-libelle" value={libelle} onChange={(e) => setLibelle(e.target.value)} /></div>
        <div><Label htmlFor="pa-date" className="text-xs">{t("crm.suivi.date")}</Label><Input id="pa-date" type="datetime-local" value={quand} onChange={(e) => setQuand(e.target.value)} /></div>
        <div>
          <Label htmlFor="pa-responsable" className="text-xs">{t("crm.suivi.responsable")}</Label>
          <select id="pa-responsable" className="w-full h-9 rounded-md border bg-background px-2 text-sm" value={responsable} onChange={(e) => setResponsable(e.target.value)}>
            <option value="">{t("crm.suivi.aucun")}</option>
            {membres.map((m) => <option key={m.id} value={String(m.id)}>{m.name}</option>)}
          </select>
        </div>
        <Button size="sm" onClick={() => void sauver()} disabled={enCours}>{t("crm.suivi.enregistrer")}</Button>
      </CardContent>
    </Card>
  );
}

/**
 * Ce que la decouverte a confirme et ce qui manque encore. La progression et
 * la liste des points manquants sont affichees en clair : c'est ce que le
 * devis signalera s'il est cree trop tot.
 */
export function ListeDecouverteCarte({ prospect, onSaved }: {
  prospect: { id: number; discoveryChecklist?: ListeDecouverte | null };
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [liste, setListe] = useState<ListeDecouverte>(prospect.discoveryChecklist ?? {});
  const [enCours, setEnCours] = useState(false);
  const manquants = pointsManquants(liste);
  const confirmes = POINTS_DECOUVERTE.length - manquants.length;

  const basculer = (p: (typeof POINTS_DECOUVERTE)[number], ok: boolean) =>
    setListe((l) => ({ ...l, [p]: { ok, valeur: l[p]?.valeur ?? null } }));
  const preciser = (p: (typeof POINTS_DECOUVERTE)[number], valeur: string) =>
    setListe((l) => ({ ...l, [p]: { ok: l[p]?.ok ?? false, valeur } }));

  const sauver = async () => {
    setEnCours(true);
    try {
      await enregistrer(prospect.id, { discoveryChecklist: liste });
      toast({ title: t("crm.decouverte.enregistre") });
      onSaved?.();
    } catch (e) {
      toast({ title: t("crm.suivi.erreur"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Card data-testid="carte-decouverte">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          {t("crm.decouverte.titre")}
          <span className="text-xs font-normal text-muted-foreground" data-testid="decouverte-progression">{t("crm.decouverte.progression", { ok: confirmes, total: POINTS_DECOUVERTE.length })}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-1.5">
          {POINTS_DECOUVERTE.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <input id={`dec-${p}`} type="checkbox" checked={!!liste[p]?.ok} onChange={(e) => basculer(p, e.target.checked)} />
              <label htmlFor={`dec-${p}`} className="text-sm w-40 shrink-0">{t(`crm.decouverte.point.${p}`)}</label>
              <Input aria-label={`${t(`crm.decouverte.point.${p}`)} — ${t("crm.decouverte.valeur")}`} className="h-7 text-xs" value={liste[p]?.valeur ?? ""} onChange={(e) => preciser(p, e.target.value)} />
            </li>
          ))}
        </ul>
        <p className={`text-xs ${manquants.length ? "text-amber-700" : "text-emerald-700"}`} data-testid="decouverte-manquants">
          {manquants.length ? t("crm.decouverte.manquants", { liste: manquants.map((m) => t(`crm.decouverte.point.${m}`)).join(", ") }) : t("crm.decouverte.complet")}
        </p>
        <Button size="sm" onClick={() => void sauver()} disabled={enCours}>{t("crm.decouverte.enregistrer")}</Button>
      </CardContent>
    </Card>
  );
}
