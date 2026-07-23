/**
 * Nombre de propositions IA en attente de validation (badge "File d'approbation").
 *
 * Délibérément SÉPARÉ de UnreadBadgesContext: celui-ci accumule des évènements
 * non lus reçus en SSE, qu'on remet à zéro en ouvrant l'écran (`clearKey`).
 * Ici la valeur est l'état réel du serveur — elle ne baisse que lorsqu'une
 * proposition est approuvée ou rejetée, jamais parce qu'on a regardé l'écran.
 * La confondre avec un compteur "non lu" ferait disparaître le badge alors que
 * des actions attendent toujours une décision.
 */
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

import { useAuth, API_BASE } from "@/contexts/AuthContext";

const POLL_MS = 60 * 1000;

export function usePendingApprovals(): { pending: number; refresh: () => void } {
  const { fetchAuth, isAuthenticated } = useAuth();
  const [pending, setPending] = useState(0);

  const refresh = useCallback(() => {
    if (!isAuthenticated) { setPending(0); return; }
    void (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/agent-queue/count`);
        if (res.ok) {
          const data = await res.json();
          setPending(typeof data.pending === "number" ? data.pending : 0);
        }
      } catch {
        // fail-soft: on garde la derniere valeur connue plutot que d'effacer
        // le badge sur un simple hoquet reseau.
      }
    })();
  }, [fetchAuth, isAuthenticated]);

  useEffect(() => {
    // Le sondage ne tourne que lorsque l'application est au premier plan.
    // En arriere-plan il n'y a aucun badge a afficher, et chaque requete
    // reveille une instance Cloud Run qui est alors facturee.
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(refresh, POLL_MS); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    refresh();
    start();

    // Un retour au premier plan rafraichit immediatement: l'utilisateur a pu
    // approuver depuis le bureau entre-temps.
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") { refresh(); start(); } else stop();
    });
    return () => { stop(); sub.remove(); };
  }, [refresh]);

  return { pending, refresh };
}
