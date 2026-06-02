import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
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
import { AppState, Platform, type AppStateStatus } from "react-native";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useNotificationPrefs } from "@/contexts/NotificationPrefsContext";

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

export type BadgeKey = "message" | "task" | "call" | "rappel";

const KEYS: BadgeKey[] = ["message", "task", "call", "rappel"];

function storageKey(userId: string | number | undefined, key: BadgeKey): string {
  const scope = userId ?? "anon";
  return `unread-badge:${scope}:${key}`;
}

/**
 * Tâche #82: un appel ne devient un "badge" pour la secrétaire que s'il
 * s'agit d'un appel entrant non décroché (manqué ou tombé sur la
 * messagerie). Les appels sortants qu'elle vient de passer ou les appels
 * entrants qu'elle a déjà décrochés ne doivent pas faire grimper le
 * compteur "Appels".
 */
function isMissedIncomingCall(meta: { direction?: string; status?: string } | undefined): boolean {
  if (!meta) return false;
  const direction = meta.direction;
  const status = meta.status;
  // Si la direction est connue, on exige "entrant".
  if (direction && direction !== "entrant") return false;
  // Statuts considérés comme "non décrochés" côté schéma (cf. routes/calls.ts).
  return status === "manque" || status === "messagerie";
}

interface UnreadBadgesContextValue {
  counts: Record<BadgeKey, number>;
  clearKey: (key: BadgeKey) => void;
}

const UnreadBadgesContext = createContext<UnreadBadgesContextValue>({
  counts: { message: 0, task: 0, call: 0, rappel: 0 },
  clearKey: () => {},
});

export function UnreadBadgesProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, authHeaders } = useAuth();
  const userId = user?.id;
  const {
    hapticsEnabled,
    notificationsEnabled,
    channelMuted,
    loaded: prefsLoaded,
  } = useNotificationPrefs();
  const hapticsEnabledRef = useRef(hapticsEnabled);
  const notificationsEnabledRef = useRef(notificationsEnabled);
  const channelMutedRef = useRef(channelMuted);
  const prefsLoadedRef = useRef(prefsLoaded);
  useEffect(() => {
    hapticsEnabledRef.current = hapticsEnabled;
  }, [hapticsEnabled]);
  useEffect(() => {
    notificationsEnabledRef.current = notificationsEnabled;
  }, [notificationsEnabled]);
  useEffect(() => {
    channelMutedRef.current = channelMuted;
  }, [channelMuted]);
  useEffect(() => {
    prefsLoadedRef.current = prefsLoaded;
  }, [prefsLoaded]);

  // Etat de l'app (foreground / background) — garde-fou pour ne déclencher
  // les notifications locales que quand l'app n'est pas visible.
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // "Grace period" appliquée uniquement à la première connexion SSE après
  // login : on ignore les éventuels évenements rejoués pour ne pas spammer
  // la secrétaire à l'ouverture (Tâche #77 : pas de buzz à la première
  // hydratation). Les reconnexions suivantes ne suppriment pas les alertes.
  const firstConnectAtRef = useRef<number | null>(null);
  const hasFirstConnectedRef = useRef(false);
  const GRACE_MS = 1500;

  const [counts, setCounts] = useState<Record<BadgeKey, number>>({
    message: 0,
    task: 0,
    call: 0,
    rappel: 0,
  });

  // Hydrate depuis AsyncStorage quand l'utilisateur est connu / change.
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setCounts({ message: 0, task: 0, call: 0, rappel: 0 });
      // Reset l'état de "première connexion" pour ré-armer la fenêtre
      // de grâce au prochain login (potentiellement un autre utilisateur).
      hasFirstConnectedRef.current = false;
      firstConnectAtRef.current = null;
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
      const next = { message: 0, task: 0, call: 0, rappel: 0 } as Record<BadgeKey, number>;
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

  // Tâche #84: certaines alertes (rappels imminents) ne sont pas associées
  // à un compteur de badge — elles déclenchent uniquement vibration +
  // notification locale. On factorise donc le déclenchement d'alerte avec
  // un titre/body explicites, indépendamment d'un éventuel bump de badge.
  const triggerCustomAlert = useCallback(
    (
      params: {
        title: string;
        body: string;
        route: string;
        badgeKey?: BadgeKey;
        // Tâche #134 : filtre de liste à appliquer à l'ouverture (ex.
        // "dangerous" pour /documents?scan=dangerous). Relayé au listener de
        // réponse dans `_layout.tsx` via le champ `scan` du payload.
        scan?: string;
      },
    ) => {
      if (!prefsLoadedRef.current) return;
      if (
        firstConnectAtRef.current !== null &&
        Date.now() - firstConnectAtRef.current < GRACE_MS
      ) {
        return;
      }

      if (Platform.OS !== "web" && hapticsEnabledRef.current) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      }

      if (
        Platform.OS !== "web" &&
        notificationsEnabledRef.current &&
        appStateRef.current !== "active"
      ) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: params.title,
            body: params.body,
            sound: true,
            data: {
              route: params.route,
              ...(params.badgeKey ? { badgeKey: params.badgeKey } : {}),
              ...(params.scan ? { scan: params.scan } : {}),
            },
          },
          trigger: null,
        }).catch(() => {});
      }
    },
    [],
  );

  const triggerAlerts = useCallback((key: BadgeKey, resourceId?: number) => {
    // Pas d'alertes tant que les préférences ne sont pas hydratées :
    // évite un faux buzz pour un utilisateur qui avait coupé la vibration.
    if (!prefsLoadedRef.current) return;

    // Tâche #85 : mute par canal. Si la secrétaire a coupé ce canal
    // (ex. "appel manqué" parce qu'elle utilise un autre téléphone pour
    // les appels), on n'émet ni vibration ni notification système — mais
    // on continue à incrémenter le badge visuel (fait dans `bump`).
    // `channelMuted` n'est défini que pour les canaux historiques
    // (message / task / call). Pour "rappel", `triggerAlerts` n'est jamais
    // appelé (cf. branchement `reminder` qui passe par `triggerCustomAlert`
    // avec `skipAlert: true` côté bump), donc on peut sans risque ignorer
    // l'absence d'entrée dans la map.
    if ((channelMutedRef.current as Partial<Record<BadgeKey, boolean>>)[key]) return;

    // Pas d'alertes pendant la fenêtre de grâce de la première hydratation.
    // Cette fenêtre ne s'applique qu'au tout premier connect après login,
    // pas aux reconnexions suivantes (qui doivent rester réactives).
    if (
      firstConnectAtRef.current !== null &&
      Date.now() - firstConnectAtRef.current < GRACE_MS
    ) {
      return;
    }

    if (Platform.OS !== "web" && hapticsEnabledRef.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }

    if (
      Platform.OS !== "web" &&
      notificationsEnabledRef.current &&
      appStateRef.current !== "active"
    ) {
      const title =
        key === "message"
          ? "Nouveau message"
          : key === "task"
            ? "Nouvelle tâche"
            : "Appel manqué";
      const body =
        key === "message"
          ? "Un message vient d'arriver dans votre boîte."
          : key === "task"
            ? "Une nouvelle tâche vous a été assignée."
            : "Un appel n'a pas été pris — pensez à rappeler.";
      // Hint de route : exploité par le listener de réponse dans
      // `_layout.tsx` (Tâche #81) pour ouvrir le bon écran quand la
      // secrétaire tape sur la notification système.
      const route =
        key === "message"
          ? "/messages"
          : key === "task"
            ? "/(tabs)/tasks"
            : "/(tabs)/calls";
      // Tâche #83 : on inclut l'id de la ressource pour que le tap sur la
      // notification ouvre directement le bon message / la bonne tâche, pas
      // juste la liste. Le listener côté `_layout.tsx` lit ce champ et
      // pousse la route avec un param `open`.
      Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          data: { route, badgeKey: key, resourceId },
        },
        trigger: null,
      }).catch(() => {});
    }
  }, []);

  const bump = useCallback(
    (key: BadgeKey, resourceId?: number, options?: { skipAlert?: boolean }) => {
      setCounts((prev) => {
        const next = { ...prev, [key]: prev[key] + 1 };
        persist(key, next[key]);
        return next;
      });
      // Tâche #95: pour les rappels, l'alerte (vibration + notif locale)
      // est déjà déclenchée par `triggerCustomAlert` dans le branchement
      // `reminder` ci-dessous (avec un titre/body spécifiques au rappel).
      // On évite donc un double buzz en sautant ici l'alerte standard.
      if (!options?.skipAlert) {
        triggerAlerts(key, resourceId);
      }
    },
    [persist, triggerAlerts],
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

  // ── Sync du badge sur l'icône d'application ────────────────────────────────
  // Le badge système doit refléter en permanence le total des compteurs in-app
  // (Tâche #77). Mis à jour à chaque changement de counts et remis à zéro au
  // logout.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const total = counts.message + counts.task + counts.call;
    Notifications.setBadgeCountAsync(total).catch(() => {});
  }, [counts.message, counts.task, counts.call]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!userId) {
      Notifications.setBadgeCountAsync(0).catch(() => {});
    }
  }, [userId]);

  // ── SSE realtime sync ──────────────────────────────────────────────────────
  // React Native n'a pas d'EventSource natif. On utilise expo/fetch en
  // streaming pour lire le flux SSE comme le fait `streamSse` côté ai-chat.
  const abortRef = useRef<AbortController | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  // Tâche #82: dedupe les bumps "call". Un même appel manqué peut arriver
  // sous forme de plusieurs events `updated` (retries webhook Twilio,
  // édition postérieure, etc.). On ne compte qu'une fois par resourceId.
  const countedCallIds = useRef<Set<number>>(new Set());
  // Tâche #95: même logique pour les rappels calendrier — l'automation
  // engine peut rebroadcaster pour le même évènement avant que la
  // notification ne soit lue.
  const countedRappelIds = useRef<Set<number>>(new Set());

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
      if (!hasFirstConnectedRef.current) {
        firstConnectAtRef.current = Date.now();
        hasFirstConnectedRef.current = true;
      }

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
              resourceId?: number;
              meta?: {
                direction?: string;
                status?: string;
                priority?: string;
                title?: string;
                body?: string;
                sourceType?: string;
                source?: string;
                notify?: boolean;
                route?: string;
                scan?: string;
              };
            };
            if (event.type === "ping") continue;
            if (event.action !== "created" && event.action !== "updated") continue;
            if (event.type === "reminder") {
              // Tâche #84: rappels imminents (ex: rendez-vous qui va commencer).
              // Tâche #89: également les tâches en retard et projets en retard
              // (priority haute/urgente) — même mécanisme vibration + notif
              // locale, copie et deep-link différenciés via meta.sourceType.
              // Pas de bump de badge: ces alertes vivent dans leurs écrans
              // dédiés et n'ont pas de compteur sur la tab bar.
              if (event.action !== "created") continue;
              const priority = event.meta?.priority;
              if (priority && priority !== "haute" && priority !== "urgente") continue;
              const sourceType = event.meta?.sourceType;
              let defaultTitle = "Rappel imminent";
              let defaultBody = "Un rappel programmé arrive à échéance.";
              // Route mobile (cf. ALLOWED_ROUTES dans app/_layout.tsx). NB:
              // côté web les URLs sont /calendrier, /taches, /projets ;
              // sur mobile ce sont /calendar, /tasks, /projets.
              let route = "/calendar";
              if (sourceType === "task_overdue") {
                defaultTitle = "Tâche en retard";
                defaultBody = "Une tâche urgente a dépassé sa date d'échéance.";
                route = "/tasks";
              } else if (sourceType === "projet_en_retard") {
                defaultTitle = "Projet en retard";
                defaultBody = "Un projet a dépassé sa date de fin.";
                route = "/projets";
              }
              // Tâche #95: pour les rappels calendrier, on incrémente
              // aussi le compteur "rappel" affiché sur la tuile Rappels
              // de l'écran d'accueil. Les autres `sourceType`
              // (task_overdue, projet_en_retard) ont leurs propres
              // écrans/compteurs et ne doivent pas alimenter ce badge.
              // Tâche #98 : le branchement calendar_reminder gère lui-même
              // l'émission de l'alerte (et la coupe si le canal "rappel"
              // est muté). Les autres sourceType déclenchent l'alerte
              // après le bloc.
              if (sourceType === "calendar_reminder") {
                if (typeof event.resourceId === "number") {
                  if (countedRappelIds.current.has(event.resourceId)) continue;
                  countedRappelIds.current.add(event.resourceId);
                  if (countedRappelIds.current.size > 500) {
                    const first = countedRappelIds.current.values().next().value;
                    if (typeof first === "number") countedRappelIds.current.delete(first);
                  }
                }
                // Tâche #98 : la secrétaire peut couper le canal "rappel"
                // si elle suit déjà son agenda ailleurs. Le compteur visuel
                // continue d'incrémenter (bump), mais on saute la vibration
                // et la notification système en n'appelant pas
                // `triggerCustomAlert`.
                const rappelMuted = channelMutedRef.current.rappel;
                if (!rappelMuted) {
                  triggerCustomAlert({
                    title: event.meta?.title || defaultTitle,
                    body: event.meta?.body || defaultBody,
                    route,
                  });
                }
                bump("rappel", event.resourceId, { skipAlert: true });
                continue;
              }
              triggerCustomAlert({
                title: event.meta?.title || defaultTitle,
                body: event.meta?.body || defaultBody,
                route,
              });
              continue;
            }
            if (event.type === "security") {
              // Tâche #134 : menace documentaire. Le serveur n'émet un event
              // `security` porteur de `notify` que lorsqu'une NOUVELLE
              // suggestion « pending » a été créée (dédup côté DB), donc une
              // même menace ne re-notifie pas en boucle. Les autres events
              // `security` (alertes par fichier, sans `notify`) sont ignorés.
              // Pas de badge dédié : on déclenche uniquement vibration + notif
              // locale ouvrant la liste filtrée /documents?scan=dangerous.
              if (event.action !== "created") continue;
              if (!event.meta?.notify) continue;
              triggerCustomAlert({
                title: event.meta?.title || "Document à risque détecté",
                body:
                  event.meta?.body ||
                  "Un document analysé a été identifié comme dangereux.",
                route: "/documents",
                scan: typeof event.meta?.scan === "string" ? event.meta.scan : "dangerous",
              });
              continue;
            }
            if (event.type === "message" || event.type === "task") {
              if (event.action !== "created") continue;
              bump(event.type as BadgeKey, event.resourceId);
            } else if (event.type === "call") {
              // Tâche #82: la secrétaire ne veut un badge "Appels" que pour
              // les appels manqués (entrants sans réponse). Les appels
              // sortants qu'elle vient de passer ou les appels répondus
              // ne doivent pas faire vibrer le badge.
              if (!isMissedIncomingCall(event.meta)) continue;
              // Dedupe: un même appel peut être marqué "manque" par
              // plusieurs events `updated` successifs.
              if (typeof event.resourceId === "number") {
                if (countedCallIds.current.has(event.resourceId)) continue;
                countedCallIds.current.add(event.resourceId);
                if (countedCallIds.current.size > 500) {
                  // Borne mémoire: on garde une fenêtre raisonnable.
                  const first = countedCallIds.current.values().next().value;
                  if (typeof first === "number") countedCallIds.current.delete(first);
                }
              }
              bump("call");
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
      appStateRef.current = next;
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
