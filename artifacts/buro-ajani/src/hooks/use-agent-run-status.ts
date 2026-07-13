import { useState, useEffect, useRef } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type RunStatusResponse = {
  status: "idle" | "running" | "completed" | "failed" | "cancelled";
  completedAgents?: number;
  totalAgents?: number;
};

export type AgentRunState = {
  visible: boolean;
  running: boolean;
  completedAgents: number;
  totalAgents: number;
  status: RunStatusResponse["status"];
};

// Tâche #42 : indicateur global « analyse multi-agents en cours ». On interroge
// l'endpoint léger `/ai/agents/run/status` (simple lookup d'une Map côté
// serveur, dédup par organisation) plutôt que d'ouvrir une 2e connexion SSE,
// pour ne pas interférer avec le flux live de la page Agents IA. Cadence
// adaptative : rapide pendant un run pour une progression fluide, lente au
// repos. À la fin d'un run observé, on garde la pastille quelques secondes
// (état « terminé ») puis on la masque.
const ACTIVE_INTERVAL_MS = 2500;
const IDLE_INTERVAL_MS = 20000;
const FINISH_GRACE_MS = 4000;

const INITIAL: AgentRunState = {
  visible: false,
  running: false,
  completedAgents: 0,
  totalAgents: 0,
  status: "idle",
};

export function useAgentRunStatus(enabled: boolean): AgentRunState {
  const [state, setState] = useState<AgentRunState>(INITIAL);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStatus = useRef<RunStatusResponse["status"]>("idle");

  useEffect(() => {
    if (!enabled) {
      setState(INITIAL);
      lastStatus.current = "idle";
      return;
    }

    let cancelled = false;

    const schedule = (delay: number) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollTimer.current = setTimeout(poll, delay);
    };

    const poll = async () => {
      // Évite les requêtes inutiles quand l'onglet est en arrière-plan.
      if (typeof document !== "undefined" && document.hidden) {
        schedule(IDLE_INTERVAL_MS);
        return;
      }

      let data: RunStatusResponse | null = null;
      try {
        const res = await fetch(`${BASE}/api/ai/agents/run/status`, {
          credentials: "include",
        });
        if (res.ok) data = (await res.json()) as RunStatusResponse;
      } catch {
        /* réseau indisponible : on retentera au prochain tick */
      }
      if (cancelled) return;

      const status = data?.status ?? "idle";
      const completedAgents = data?.completedAgents ?? 0;
      const totalAgents = data?.totalAgents ?? 0;

      if (status === "running") {
        if (hideTimer.current) {
          clearTimeout(hideTimer.current);
          hideTimer.current = null;
        }
        setState({ visible: true, running: true, completedAgents, totalAgents, status });
      } else {
        const justFinished =
          lastStatus.current === "running" &&
          (status === "completed" || status === "failed" || status === "cancelled");
        if (justFinished) {
          setState({ visible: true, running: false, completedAgents, totalAgents, status });
          if (hideTimer.current) clearTimeout(hideTimer.current);
          hideTimer.current = setTimeout(() => {
            hideTimer.current = null;
            if (!cancelled) setState((s) => ({ ...s, visible: false }));
          }, FINISH_GRACE_MS);
        } else if (!hideTimer.current) {
          setState((s) => (s.visible ? { ...s, visible: false, running: false } : s));
        }
      }

      lastStatus.current = status;
      schedule(status === "running" ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS);
    };

    poll();

    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [enabled]);

  return state;
}
