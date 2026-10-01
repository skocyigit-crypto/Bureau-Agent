/**
 * Indicateur « appel en direct » de la barre du haut, visible sur chaque
 * ecran des qu'au moins un appel REEL est en cours (voice_call_sessions, via
 * GET /api/appels-live), absent a zero. Jamais alimente par la simulation
 * (bouton super-admin marque « test ») : montrer un faux appel comme reel
 * ferait decrocher quelqu'un pour rien.
 *
 * Interrogation toutes les 5 s, seulement onglet visible : le flux SSE est
 * propre a une instance Cloud Run, un tour traite ailleurs n'y passerait pas.
 */
import { useQuery } from "@tanstack/react-query";
import { PhoneCall } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "@/i18n";

const API = import.meta.env.BASE_URL.replace(/\/$/, "");

export type AppelEnDirect = {
  callSid: string; status: string; appelant: string | null; numeroMasque: string | null;
  contactId: number | null; debut: string; derniereActivite: string; etape: string | null;
  dernierJournal: string | null; reprise: string | null;
};

export function useAppelsEnDirect() {
  return useQuery<{ appels: AppelEnDirect[] }>({
    queryKey: ["appels-live"],
    queryFn: async () => {
      const r = await fetch(`${API}/api/appels-live`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}

export function IndicateurAppelEnDirect() {
  const { t } = useTranslation();
  const q = useAppelsEnDirect();
  const appels = q.data?.appels ?? [];
  if (appels.length === 0) return null;
  const libelle = t("appelLive.indicatorLabel", { count: appels.length });
  return (
    <Link
      href={`/appels/live/${encodeURIComponent(appels[0]!.callSid)}`}
      aria-label={libelle}
      title={libelle}
      data-testid="indicateur-appel-direct"
      className="inline-flex items-center gap-1.5 rounded-full bg-red-600 text-white px-2.5 py-1 text-xs font-semibold hover:bg-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-white animate-pulse motion-reduce:animate-none" />
      <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" />
      <span>{t("appelLive.indicator", { count: appels.length })}</span>
    </Link>
  );
}
