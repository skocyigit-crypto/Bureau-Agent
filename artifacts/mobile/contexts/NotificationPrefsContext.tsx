import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Platform } from "react-native";

/**
 * Préférences locales (par appareil) pour les alertes "buzz" déclenchées
 * par UnreadBadgesContext quand un nouveau message ou une nouvelle tâche
 * arrive en SSE (Tâche #77).
 *
 *  - `hapticsEnabled`        : vibration légère lors de l'événement, app ouverte ou non.
 *  - `notificationsEnabled`  : notification locale système quand l'app est en arrière-plan.
 *  - `channelMuted`          : (Tâche #85) mute par canal (message / task / call /
 *    rappel / security). Permet par exemple de couper les buzz "appel manqué"
 *    sans toucher aux messages quand la secrétaire utilise un autre téléphone
 *    pour les appels, ou de couper le canal "security" (Tâche #146) si la
 *    sécurité des documents est gérée ailleurs.
 *
 * Tous les toggles sont indépendants et persistés dans AsyncStorage avec
 * une clé globale (l'appareil appartient à une seule secrétaire en pratique).
 */

const STORAGE_KEY_HAPTICS = "notif-prefs:haptics";
const STORAGE_KEY_NOTIFS = "notif-prefs:notifications";
const STORAGE_KEY_MUTED_PREFIX = "notif-prefs:muted:";

export type AlertChannel = "message" | "task" | "call" | "rappel" | "security";

const ALERT_CHANNELS: AlertChannel[] = ["message", "task", "call", "rappel", "security"];

export type ChannelMutedMap = Record<AlertChannel, boolean>;

const DEFAULT_MUTED: ChannelMutedMap = {
  message: false,
  task: false,
  call: false,
  rappel: false,
  security: false,
};

interface NotificationPrefsContextValue {
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
  channelMuted: ChannelMutedMap;
  loaded: boolean;
  setHapticsEnabled: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => Promise<boolean>;
  setChannelMuted: (channel: AlertChannel, muted: boolean) => void;
}

const NotificationPrefsContext = createContext<NotificationPrefsContextValue>({
  hapticsEnabled: true,
  notificationsEnabled: false,
  channelMuted: DEFAULT_MUTED,
  loaded: false,
  setHapticsEnabled: () => {},
  setNotificationsEnabled: async () => false,
  setChannelMuted: () => {},
});

export function NotificationPrefsProvider({ children }: { children: React.ReactNode }) {
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [channelMuted, setChannelMutedState] = useState<ChannelMutedMap>(DEFAULT_MUTED);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, n, ...mutedRaw] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_HAPTICS),
          AsyncStorage.getItem(STORAGE_KEY_NOTIFS),
          ...ALERT_CHANNELS.map((c) =>
            AsyncStorage.getItem(STORAGE_KEY_MUTED_PREFIX + c),
          ),
        ]);
        if (cancelled) return;
        // Default = haptics ON, notifications OFF (need explicit consent),
        // tous les canaux non mutés par défaut.
        if (h !== null) setHapticsEnabledState(h === "1");
        if (n !== null) setNotificationsEnabledState(n === "1");
        const next: ChannelMutedMap = { ...DEFAULT_MUTED };
        ALERT_CHANNELS.forEach((c, i) => {
          const raw = mutedRaw[i];
          if (raw !== null) next[c] = raw === "1";
        });
        setChannelMutedState(next);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setHapticsEnabled = useCallback((v: boolean) => {
    setHapticsEnabledState(v);
    AsyncStorage.setItem(STORAGE_KEY_HAPTICS, v ? "1" : "0").catch(() => {});
  }, []);

  const setChannelMuted = useCallback((channel: AlertChannel, muted: boolean) => {
    setChannelMutedState((prev) => {
      if (prev[channel] === muted) return prev;
      return { ...prev, [channel]: muted };
    });
    AsyncStorage.setItem(STORAGE_KEY_MUTED_PREFIX + channel, muted ? "1" : "0").catch(
      () => {},
    );
  }, []);

  const setNotificationsEnabled = useCallback(async (v: boolean): Promise<boolean> => {
    if (!v) {
      setNotificationsEnabledState(false);
      AsyncStorage.setItem(STORAGE_KEY_NOTIFS, "0").catch(() => {});
      return true;
    }

    if (Platform.OS === "web") {
      // Pas de notifications locales sur le web (pas dans le scope de la tâche).
      setNotificationsEnabledState(false);
      AsyncStorage.setItem(STORAGE_KEY_NOTIFS, "0").catch(() => {});
      return false;
    }

    try {
      const current = await Notifications.getPermissionsAsync();
      let granted = current.status === "granted";
      if (!granted && current.canAskAgain !== false) {
        const req = await Notifications.requestPermissionsAsync();
        granted = req.status === "granted";
      }
      if (!granted) {
        setNotificationsEnabledState(false);
        AsyncStorage.setItem(STORAGE_KEY_NOTIFS, "0").catch(() => {});
        return false;
      }
      setNotificationsEnabledState(true);
      AsyncStorage.setItem(STORAGE_KEY_NOTIFS, "1").catch(() => {});
      return true;
    } catch {
      setNotificationsEnabledState(false);
      AsyncStorage.setItem(STORAGE_KEY_NOTIFS, "0").catch(() => {});
      return false;
    }
  }, []);

  const value = useMemo(
    () => ({
      hapticsEnabled,
      notificationsEnabled,
      channelMuted,
      loaded,
      setHapticsEnabled,
      setNotificationsEnabled,
      setChannelMuted,
    }),
    [
      hapticsEnabled,
      notificationsEnabled,
      channelMuted,
      loaded,
      setHapticsEnabled,
      setNotificationsEnabled,
      setChannelMuted,
    ],
  );

  return (
    <NotificationPrefsContext.Provider value={value}>
      {children}
    </NotificationPrefsContext.Provider>
  );
}

export function useNotificationPrefs(): NotificationPrefsContextValue {
  return useContext(NotificationPrefsContext);
}
