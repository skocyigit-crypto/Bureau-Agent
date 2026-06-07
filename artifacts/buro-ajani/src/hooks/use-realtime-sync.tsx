import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useWorkspaceUser } from "@/components/workspace-user";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const QUERY_MAP: Record<string, string[][]> = {
  call:      [["calls"], ["dashboard"], ["stats"]],
  task:      [["tasks"], ["dashboard"], ["stats"]],
  contact:   [["contacts"], ["dashboard"]],
  message:   [["messages"], ["dashboard"]],
  checkin:   [["checkins"], ["attendance"]],
  calendar:  [["calendar-events"], ["calendar"]],
  prospect:  [["prospects"]],
  note:      [["notes-internes"]],
  projet:    [["projets"]],
  reminder:  [["notifications"]],
  whatsapp:  [["whatsapp-conversations"]],
  dashboard: [["dashboard"], ["stats"]],
};

type SyncEvent = {
  type: string;
  action: string;
  resourceId?: number;
  triggeredBy?: number;
  ts: number;
  meta?: {
    source?: string;
    notify?: boolean;
    title?: string;
    body?: string;
    route?: string;
    scan?: string;
    [key: string]: unknown;
  };
};

export function useRealtimeSync() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  // Tâche #87 : l'id de l'utilisateur courant sert à NE PAS lui notifier ses
  // propres créations (le serveur diffuse aussi l'event quand c'est lui qui a
  // créé le message/la tâche). On le garde dans une ref pour rester accessible
  // depuis le `onmessage` sans recréer la connexion SSE.
  const { user } = useWorkspaceUser();
  const currentUserIdRef = useRef<number | undefined>(user?.id);
  currentUserIdRef.current = user?.id;
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(`${BASE}/api/sync/events`, { withCredentials: true });
    esRef.current = es;

    es.onopen = () => {
      reconnectDelay.current = 1000;
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as SyncEvent;

        if (event.type === "ping") return;

        const keys = QUERY_MAP[event.type] ?? [];
        for (const key of keys) {
          qc.invalidateQueries({ queryKey: key });
        }

        // Tâche #134/#147 : alerte temps réel « document à risque ». Le serveur
        // n'émet l'évènement « security » porteur de `meta.notify` qu'une seule
        // fois par menace en attente (dédup côté serveur), donc on peut afficher
        // un toast non intrusif sans risque de spam. Il pointe vers la liste
        // filtrée des documents dangereux (ex. /documents?scan=dangerous).
        if (event.type === "security" && event.meta?.notify) {
          const route = event.meta.route || "/documents";
          const scan = event.meta.scan;
          const href = scan ? `${route}?scan=${encodeURIComponent(scan)}` : route;
          toast({
            variant: "destructive",
            title: event.meta.title || "Document à risque détecté",
            description: event.meta.body,
            action: (
              <ToastAction
                altText="Voir les documents à risque"
                onClick={() => navigateRef.current(href)}
              >
                Voir
              </ToastAction>
            ),
          });
        }

        // Tâche #87 : miroir web du deep-link mobile (#83). À l'arrivée d'un
        // nouveau message / d'une nouvelle tâche, on affiche un toast non
        // intrusif dont l'action « Voir » ouvre directement le bon item
        // (et plus seulement la liste), via le `resourceId` déjà présent dans
        // l'event SSE. On saute les créations déclenchées par l'utilisateur
        // courant (il vient de la créer lui-même) pour éviter le bruit.
        if (
          (event.type === "message" || event.type === "task") &&
          event.action === "created" &&
          event.triggeredBy !== currentUserIdRef.current
        ) {
          const isMessage = event.type === "message";
          const listRoute = isMessage ? "/messages" : "/taches";
          const href =
            typeof event.resourceId === "number"
              ? `${listRoute}?id=${event.resourceId}`
              : listRoute;
          toast({
            title: isMessage ? "Nouveau message" : "Nouvelle tâche",
            description: isMessage
              ? "Un message vient d'arriver dans votre boîte."
              : "Une nouvelle tâche a été ajoutée.",
            action: (
              <ToastAction
                altText={isMessage ? "Ouvrir le message" : "Ouvrir la tâche"}
                onClick={() => navigateRef.current(href)}
              >
                Voir
              </ToastAction>
            ),
          });
        }

        window.dispatchEvent(new CustomEvent("realtime-sync", { detail: event }));
      } catch {
      }
    };

    es.onerror = () => {
      es.close();
      esRef.current = null;

      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        connect();
      }, reconnectDelay.current);
    };
  }, [qc]);

  useEffect(() => {
    connect();

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !esRef.current) {
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);
}
