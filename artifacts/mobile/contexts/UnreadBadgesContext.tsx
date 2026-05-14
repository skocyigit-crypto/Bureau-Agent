import AsyncStorage from "@react-native-async-storage/async-storage";
import { fetch as expoFetch } from "expo/fetch";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { useAuth, API_BASE } from "@/contexts/AuthContext";

/**
 * Mirroir mobile des compteurs "non lus" affichés dans la sidebar web
 * (voir `artifacts/buro-ajani/src/components/layout.tsx` + `use-realtime-sync.ts`).
 *
 * Comportement attendu (Tâche #75) :
 *  - Quand un nouveau Message ou une nouvelle Tâche arrive en temps réel,
 *    on incrémente un badge visible sur la tab bar / le menu "Plus".
 *  - Le badge est remis à zéro dès que la secrétaire ouvre l'écran
 *    correspondant (clearKey appelé via useFocusEffect côté écran).
 *  - Le compteur survit aux redémarrages de l'app via AsyncStorage,
 *    avec une clé scopée par utilisateur pour éviter qu'un compteur
 *    fuie d'un compte à l'autre sur un même appareil partagé.
 *  - On utilise le même flux SSE `/api/sync/events` que le web pour
 *    rester cohérent (pas de double source de vérité).
 */

export type BadgeKey = "message" | "task" | "call";

const KEYS: BadgeKey[] = ["message", "task", "call"];

function storageKey(userId: string | number | undefined, key: BadgeKey): string {
  const scope = userId ?? "anon";
  return `unread-badge:${scope}:${key}`;
}

interface UnreadBadgesContextValue {
  counts: Record<BadgeKey, number>;
  clearKey: (key: BadgeKey) => void;
}

const UnreadBadgesContext = createContext<UnreadBadgesContextValue>({
  counts: { message: 0, task: 0, call: 0 },
  clearKey: () => {},
});

export function UnreadBadgesProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, authHeaders } = useAuth();
  const userId = user?.id;

  const [counts, setCounts] = useState<Record<BadgeKey, number>>({
    message: 0,
    task: 0,
    call: 0,
  });

  // Hydrate depuis AsyncStorage quand l'utilisateur est connu / change.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setCounts({ message: 0, task: 0, call: 0 });
      return;
    }
    (async () => {
      const entries = await Promise.all(
        KEYS.map(async (k) => {
          try {
            const raw = await AsyncStorage.getItem(storageKey(userId, k));
            const n = raw ? parseInt(raw, 10) : 0;
            return [k, Number.isFinite(n) && n > 0 ? n : 0] as const;
          } catch {
            return [k, 0] as const;
          }
        }),
      );
      if (cancelled) return;
      const next = { message: 0, task: 0, call: 0 } as Record<BadgeKey, number>;
      for (const [k, v] of entries) next[k] = v;
      setCounts(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const persist = useCallback(
    (key: BadgeKey, value: number) => {
      if (!userId) return;
      AsyncStorage.setItem(storageKey(userId, key), String(value)).catch(() => {});
    },
    [userId],
  );

  const bump = useCallback(
    (key: BadgeKey) => {
      setCounts((prev) => {
        const next = { ...prev, [key]: prev[key] + 1 };
        persist(key, next[key]);
        return next;
      });
    },
    [persist],
  );

  const clearKey = useCallback(
    (key: BadgeKey) => {
      setCounts((prev) => {
        if (prev[key] === 0) return prev;
        const next = { ...prev, [key]: 0 };
        persist(key, 0);
        return next;
      });
    },
    [persist],
  );

  // ── SSE realtime sync ──────────────────────────────────────────────────────
  // React Native n'a pas d'EventSource natif. On utilise expo/fetch en
  // streaming pour lire le flux SSE comme le fait `streamSse` côté ai-chat.
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);

  const closeStream = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const connect = useCallback(async () => {
    if (!isAuthenticated || !userId) return;
    closeStream();

    const controller = new AbortController();
    abortRef.current = controller;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...authHeaders(),
    };

    try {
      const res = await expoFetch(`${API_BASE}/api/sync/events`, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        throw new Error(`SSE init failed: ${res.status}`);
      }

      reconnectDelay.current = 1000;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!block.trim() || block.startsWith(":")) continue;
          let dataStr = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("data:")) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;
          try {
            const event = JSON.parse(dataStr) as {
              type?: string;
              action?: string;
            };
            if (event.type === "ping") continue;
            if (event.action !== "created") continue;
            if (
              event.type === "message" ||
              event.type === "task" ||
              event.type === "call"
            ) {
              bump(event.type as BadgeKey);
            }
          } catch {
            // ignore malformed payload
          }
        }
      }
    } catch {
      // tomber dans le bloc finally pour reconnecter
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      // Reconnecter avec backoff seulement si on n'a pas demandé l'arrêt.
      if (!controller.signal.aborted && isAuthenticated) {
        const delay = reconnectDelay.current;
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
        reconnectTimer.current = setTimeout(() => {
          connect();
        }, delay);
      }
    }
  }, [bump, closeStream, authHeaders, isAuthenticated, userId]);

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      closeStream();
      return;
    }
    connect();
    return () => {
      closeStream();
    };
  }, [closeStream, connect, isAuthenticated, userId]);

  // Reconnecter quand l'app revient au premier plan.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "active" && isAuthenticated && userId && !abortRef.current) {
        reconnectDelay.current = 1000;
        connect();
      }
    });
    return () => sub.remove();
  }, [connect, isAuthenticated, userId]);

  const value = useMemo(() => ({ counts, clearKey }), [counts, clearKey]);

  return (
    <UnreadBadgesContext.Provider value={value}>
      {children}
    </UnreadBadgesContext.Provider>
  );
}

export function useUnreadBadges(): UnreadBadgesContextValue {
  return useContext(UnreadBadgesContext);
}
