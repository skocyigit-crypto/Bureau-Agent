/**
 * LocationContext.tsx — Konum takibi (Wave 3, slice 2)
 *
 * Görev #88 (proposed) yerine kullanıcının açık talebi:
 * "Herzaman calisanlari bulundugu alanda takip etme" — yani patron
 * çalışanların 7/24 nerede olduğunu görsün. Kullanıcı izin sorulmasını
 * REDDETTİ (zorunlu, açma/kapama yok). Bu yüzden ayar ekranı yok; sadece
 * ilk girişte KVKK aydınlatma metni gösteriliyor (TouchableOpacity ile
 * "Anladım, kabul ediyorum" tek butonu) ve kabul edilmediği sürece
 * uygulamanın geri kalanına geçilemiyor.
 *
 * Backend kontratı:
 *   POST /api/location/ping
 *   { lat, lng, accuracyM?, at?, battery?, isMoving? }
 *   -> 200 { entered:[], exited:[], geofencesNow:[] }
 *
 * Backend, ham GPS'i sadece geofence içindelik için kullanır; patron
 * panelinde sadece "hangi bölgede?" görünür (kullanıcı talebi).
 *
 * Web platformunda devre dışı (background location yok). Mobil-only.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { loadSessionToken } from "@/lib/secure-session";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import { API_BASE, MOBILE_APP_ORIGIN } from "@/lib/api-config";
import { useAuth } from "@/contexts/AuthContext";

const KVKK_ACK_KEY = "location:kvkk-acknowledged-v1";
const BG_TASK = "agentdebureau-location-background";

export type LocationPermissionStatus =
  | "unknown"
  | "granted"
  | "denied"
  | "restricted"
  | "unsupported";

interface LocationContextType {
  /** KVKK aydınlatması kabul edildi mi (cihaz başına 1 kez). */
  kvkkAcknowledged: boolean;
  /** Aydınlatmayı kabul et — kabul olmadan tracking başlamaz. */
  acknowledgeKvkk: () => Promise<void>;
  /** İzin durumu (foreground + background birleşik). */
  permission: LocationPermissionStatus;
  /** İzin diyaloglarını sırayla göster + sonuç döndür. */
  requestPermission: () => Promise<LocationPermissionStatus>;
  /** Background görevi aktif mi (tanı için). */
  isTracking: boolean;
}

const LocationContext = createContext<LocationContextType>({
  kvkkAcknowledged: false,
  acknowledgeKvkk: async () => {},
  permission: "unknown",
  requestPermission: async () => "unknown",
  isTracking: false,
});

// ---------------------------------------------------------------------------
// Background görev tanımı — modül yüklenince register edilir.
// AppContainer içinde kullanılmaz; TaskManager iş başlığını JS bridge ölmüş
// olsa bile native taraftan tetikler, o yüzden global scope.
// ---------------------------------------------------------------------------

if (Platform.OS !== "web") {
  if (!TaskManager.isTaskDefined(BG_TASK)) {
    TaskManager.defineTask(BG_TASK, async ({ data, error }) => {
      if (error) {
        // Sessizce yut — background task içinde throw edersek OS görevi
        // tamamen iptal edebilir. console.warn dev sırasında görünür.
        if (__DEV__) console.warn("[location-bg] task error:", error.message);
        return;
      }
      const locations = (data as { locations?: Location.LocationObject[] })?.locations ?? [];
      if (locations.length === 0) return;

      // Auth token'ı guvenli coften oku (JS context yeniden kurulmuş
      // olabilir, useAuth burada kullanılamaz). loadSessionToken() ayni
      // zamanda eski duz-metin AsyncStorage slotunu da migrate eder, o
      // yuzden dogrudan AsyncStorage okumak yerine bunu kullanmak gerekir —
      // aksi halde secure-session.ts'nin yazdigi token hic gorulmez.
      let token: string | null = null;
      try {
        token = await loadSessionToken();
      } catch {
        return; // storage yoksa ping yollayamayız
      }
      if (!token) return;

      // Sadece son ölçümü gönder — ara noktalar accuracy düşükse drop edilir.
      const last = locations[locations.length - 1];
      if (!last?.coords) return;

      try {
        await fetch(`${API_BASE}/api/location/ping`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Origin: MOBILE_APP_ORIGIN,
          },
          body: JSON.stringify({
            lat: last.coords.latitude,
            lng: last.coords.longitude,
            accuracyM: last.coords.accuracy ?? null,
            at: new Date(last.timestamp).toISOString(),
            isMoving: typeof last.coords.speed === "number" && last.coords.speed > 0.5,
          }),
        });
      } catch {
        // Ağ hatası — bir sonraki tetikte yeniden denenir, biriktirme yapmıyoruz
        // (eski konum patrona yarar sağlamaz).
      }
    });
  }
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [kvkkAcknowledged, setKvkkAcknowledged] = useState(false);
  const [permission, setPermission] = useState<LocationPermissionStatus>("unknown");
  const [isTracking, setIsTracking] = useState(false);
  const startedRef = useRef(false);

  // ── KVKK durumunu hidrate et ──────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(KVKK_ACK_KEY)
      .then((v) => setKvkkAcknowledged(v === "1"))
      .catch(() => {});
  }, []);

  const acknowledgeKvkk = useCallback(async () => {
    await AsyncStorage.setItem(KVKK_ACK_KEY, "1");
    setKvkkAcknowledged(true);
  }, []);

  // ── İzin sorgusu ──────────────────────────────────────────────────────────
  const requestPermission = useCallback(async (): Promise<LocationPermissionStatus> => {
    if (Platform.OS === "web") {
      setPermission("unsupported");
      return "unsupported";
    }
    try {
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== "granted") {
        setPermission("denied");
        return "denied";
      }
      // Foreground OK -> background'u iste. Android: ACCESS_BACKGROUND_LOCATION
      // sadece foreground verildikten sonra istenebilir (sistem kuralı).
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== "granted") {
        setPermission("denied");
        return "denied";
      }
      setPermission("granted");
      return "granted";
    } catch {
      setPermission("denied");
      return "denied";
    }
  }, []);

  // ── Mevcut izni kontrol et (KVKK kabul + login sonrası) ───────────────────
  useEffect(() => {
    if (Platform.OS === "web") {
      setPermission("unsupported");
      return;
    }
    if (!kvkkAcknowledged || !isAuthenticated) return;
    (async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      const bg = await Location.getBackgroundPermissionsAsync();
      if (fg.status === "granted" && bg.status === "granted") {
        setPermission("granted");
      } else {
        // Kullanıcı henüz izin diyaloğunu görmedi — ekran tetikleyecek.
        setPermission(fg.status === "denied" || bg.status === "denied" ? "denied" : "unknown");
      }
    })();
  }, [kvkkAcknowledged, isAuthenticated]);

  // ── İzin verilince background görevi başlat ───────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    if (!isAuthenticated || !kvkkAcknowledged || permission !== "granted") {
      // Logout veya izin reddi -> görevi durdur.
      if (startedRef.current) {
        Location.hasStartedLocationUpdatesAsync(BG_TASK)
          .then((on) => (on ? Location.stopLocationUpdatesAsync(BG_TASK) : null))
          .catch(() => {})
          .finally(() => {
            startedRef.current = false;
            setIsTracking(false);
          });
      }
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    Location.startLocationUpdatesAsync(BG_TASK, {
      accuracy: Location.Accuracy.Balanced,
      // Patron geofence görüyor — saniye düzeyinde hassasiyet gerekmiyor.
      // 60s + 100m, pil dostu Google önerisi.
      timeInterval: 60_000,
      distanceInterval: 100,
      deferredUpdatesInterval: 60_000,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Ajant Bureau",
        notificationBody: "Suivi de presence actif (geofences uniquement).",
        notificationColor: "#0f1729",
      },
    })
      .then(() => setIsTracking(true))
      .catch((err) => {
        if (__DEV__) console.warn("[location] startLocationUpdates failed:", err);
        startedRef.current = false;
        setIsTracking(false);
      });
  }, [isAuthenticated, kvkkAcknowledged, permission]);

  return (
    <LocationContext.Provider
      value={{ kvkkAcknowledged, acknowledgeKvkk, permission, requestPermission, isTracking }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocationTracking(): LocationContextType {
  return useContext(LocationContext);
}
