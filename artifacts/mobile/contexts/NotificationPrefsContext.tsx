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
 *
 * Les deux toggles sont indépendants et persistés dans AsyncStorage avec
 * une clé globale (l'appareil appartient à une seule secrétaire en pratique).
 */

const STORAGE_KEY_HAPTICS = "notif-prefs:haptics";
const STORAGE_KEY_NOTIFS = "notif-prefs:notifications";

interface NotificationPrefsContextValue {
  hapticsEnabled: boolean;
  notificationsEnabled: boolean;
  loaded: boolean;
  setHapticsEnabled: (v: boolean) => void;
  setNotificationsEnabled: (v: boolean) => Promise<boolean>;
}

const NotificationPrefsContext = createContext<NotificationPrefsContextValue>({
  hapticsEnabled: true,
  notificationsEnabled: false,
  loaded: false,
  setHapticsEnabled: () => {},
  setNotificationsEnabled: async () => false,
});

export function NotificationPrefsProvider({ children }: { children: React.ReactNode }) {
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const [notificationsEnabled, setNotificationsEnabledState] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [h, n] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEY_HAPTICS),
          AsyncStorage.getItem(STORAGE_KEY_NOTIFS),
        ]);
        if (cancelled) return;
        // Default = haptics ON, notifications OFF (need explicit consent).
        if (h !== null) setHapticsEnabledState(h === "1");
        if (n !== null) setNotificationsEnabledState(n === "1");
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
      loaded,
      setHapticsEnabled,
      setNotificationsEnabled,
    }),
    [hapticsEnabled, notificationsEnabled, loaded, setHapticsEnabled, setNotificationsEnabled],
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
