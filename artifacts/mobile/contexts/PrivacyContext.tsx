/**
 * PrivacyContext.tsx — Kullanıcı Gizliliği Yönetim Katmanı
 *
 * Bu context aşağıdaki korumayı sağlar:
 *  1. Arka plan ekranı — uygulama arka plana geçtiğinde içerik örtülür
 *  2. Otomatik kilit — belirlenmiş süre hareketsizlik sonrası kilit
 *  3. PIN koruması — 4 haneli PIN ile kilit açma
 *  4. Biyometrik — Face ID / Touch ID / Parmak izi
 *  5. Ayarların kalıcı olarak saklanması (AsyncStorage)
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus, Platform } from "react-native";

// ── Tipler ────────────────────────────────────────────────────────────────────

export interface PrivacySettings {
  /** Arka plan örtüsü etkin mi */
  privacyScreenEnabled: boolean;
  /** Otomatik kilit süresi dakika cinsinden (0 = kapalı) */
  autoLockMinutes: number;
  /** Biyometrik kimlik doğrulama etkin mi */
  biometricEnabled: boolean;
  /** PIN ayarlanmış mı */
  hasPIN: boolean;
  /** Hassas veri maskesi etkin mi */
  maskSensitiveData: boolean;
}

export interface PrivacyContextType {
  /** Uygulama şu an kilitli mi */
  isLocked: boolean;
  /** Uygulama arka planda mı */
  isBackground: boolean;
  /** Ayarlar */
  settings: PrivacySettings;
  /** Biyometrik donanım var mı */
  biometricAvailable: boolean;
  /** Biyometrik tür (yüz, parmak izi, vs.) */
  biometricType: string;
  /** Uygulamayı kilitle */
  lock: () => void;
  /** PIN ile kilit aç */
  unlockWithPIN: (pin: string) => Promise<boolean>;
  /** Biyometrik ile kilit aç */
  unlockWithBiometric: () => Promise<boolean>;
  /** PIN belirle */
  setPIN: (pin: string) => Promise<void>;
  /** PIN kaldır */
  removePIN: () => Promise<void>;
  /** Ayarları güncelle */
  updateSettings: (patch: Partial<PrivacySettings>) => Promise<void>;
  /** Kullanıcı etkileşiminde aktivite zamanını güncelle */
  recordActivity: () => void;
}

// ── Varsayılan değerler ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: PrivacySettings = {
  privacyScreenEnabled: true,
  autoLockMinutes: 5,
  biometricEnabled: false,
  hasPIN: false,
  maskSensitiveData: false,
};

const STORAGE_SETTINGS_KEY = "adb_privacy_settings";
const STORAGE_PIN_KEY = "adb_privacy_pin_hash";

// ── Context ────────────────────────────────────────────────────────────────────

const PrivacyContext = createContext<PrivacyContextType>({
  isLocked: false,
  isBackground: false,
  settings: DEFAULT_SETTINGS,
  biometricAvailable: false,
  biometricType: "",
  lock: () => {},
  unlockWithPIN: async () => false,
  unlockWithBiometric: async () => false,
  setPIN: async () => {},
  removePIN: async () => {},
  updateSettings: async () => {},
  recordActivity: () => {},
});

// ── Basit PIN hash (SHA-256 kullanılamadığı için basit hash) ──────────────────
function hashPin(pin: string): string {
  // Basit ama deterministik hash — AsyncStorage şifreli değil ama PIN açık metin değil
  let hash = 0;
  const saltedPin = `adb_pin_salt_2026_${pin}_secure`;
  for (let i = 0; i < saltedPin.length; i++) {
    const chr = saltedPin.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return `${Math.abs(hash).toString(16).padStart(8, "0")}`;
}

// ── Provider ──────────────────────────────────────────────────────────────────

export function PrivacyProvider({ children }: { children: React.ReactNode }) {
  const [isLocked, setIsLocked] = useState(false);
  const [isBackground, setIsBackground] = useState(false);
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULT_SETTINGS);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricType, setBiometricType] = useState("");
  const [pinHash, setPinHash] = useState<string | null>(null);

  const lastActivityRef = useRef<number>(Date.now());
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ── Başlangıçta ayarları ve PIN'i yükle ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [storedSettings, storedPin] = await Promise.all([
          AsyncStorage.getItem(STORAGE_SETTINGS_KEY),
          AsyncStorage.getItem(STORAGE_PIN_KEY),
        ]);
        if (storedSettings) {
          const parsed = JSON.parse(storedSettings) as Partial<PrivacySettings>;
          setSettings({ ...DEFAULT_SETTINGS, ...parsed });
        }
        if (storedPin) {
          setPinHash(storedPin);
        }
      } catch {
        // AsyncStorage hatası — varsayılanları kullan
      }
    })();
  }, []);

  // ── Biyometrik donanım kontrolü ───────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      try {
        const available = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        setBiometricAvailable(available && enrolled);
        if (available && enrolled) {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
            setBiometricType("Face ID");
          } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
            setBiometricType("Empreinte digitale");
          } else {
            setBiometricType("Biometrique");
          }
        }
      } catch {
        setBiometricAvailable(false);
      }
    })();
  }, []);

  // ── AppState izleme — arka plana geçince örtü göster ─────────────────────────
  useEffect(() => {
    if (Platform.OS === "web") return;

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === "background" || nextState === "inactive") {
        setIsBackground(true);
        // Arka plana geçince kilitleme zamanlaması
        if (settings.autoLockMinutes > 0) {
          const elapsed = (Date.now() - lastActivityRef.current) / 60_000;
          if (elapsed >= settings.autoLockMinutes) {
            setIsLocked(true);
          }
        }
      } else if (nextState === "active") {
        setIsBackground(false);
        // Ön plana dönerken kilit kontrolü
        if (prev === "background" || prev === "inactive") {
          if (settings.autoLockMinutes > 0) {
            const elapsed = (Date.now() - lastActivityRef.current) / 60_000;
            if (elapsed >= settings.autoLockMinutes) {
              setIsLocked(true);
            }
          }
        }
      }
    });

    return () => subscription.remove();
  }, [settings.autoLockMinutes]);

  // ── Otomatik kilit zamanlayıcısı ──────────────────────────────────────────────
  const scheduleAutoLock = useCallback(() => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    if (settings.autoLockMinutes > 0) {
      lockTimerRef.current = setTimeout(() => {
        setIsLocked(true);
      }, settings.autoLockMinutes * 60_000);
    }
  }, [settings.autoLockMinutes]);

  useEffect(() => {
    scheduleAutoLock();
    return () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    };
  }, [scheduleAutoLock]);

  // ── İşlevler ──────────────────────────────────────────────────────────────────

  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    scheduleAutoLock();
  }, [scheduleAutoLock]);

  const lock = useCallback(() => {
    setIsLocked(true);
  }, []);

  const unlockWithPIN = useCallback(async (pin: string): Promise<boolean> => {
    if (!pinHash) {
      // PIN ayarlanmamışsa kilidi aç
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      return true;
    }
    const inputHash = hashPin(pin);
    if (inputHash === pinHash) {
      setIsLocked(false);
      lastActivityRef.current = Date.now();
      scheduleAutoLock();
      return true;
    }
    return false;
  }, [pinHash, scheduleAutoLock]);

  const unlockWithBiometric = useCallback(async (): Promise<boolean> => {
    if (Platform.OS === "web" || !biometricAvailable) return false;
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Déverrouillez Ajant Bureau",
        cancelLabel: "Annuler",
        disableDeviceFallback: false,
        fallbackLabel: "Utiliser le code PIN",
      });
      if (result.success) {
        setIsLocked(false);
        lastActivityRef.current = Date.now();
        scheduleAutoLock();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [biometricAvailable, scheduleAutoLock]);

  const setPIN = useCallback(async (pin: string): Promise<void> => {
    const hash = hashPin(pin);
    await AsyncStorage.setItem(STORAGE_PIN_KEY, hash);
    setPinHash(hash);
    await updateSettingsInternal({ hasPIN: true });
  }, []); // eslint-disable-line

  const removePIN = useCallback(async (): Promise<void> => {
    await AsyncStorage.removeItem(STORAGE_PIN_KEY);
    setPinHash(null);
    await updateSettingsInternal({ hasPIN: false });
  }, []); // eslint-disable-line

  const updateSettingsInternal = async (patch: Partial<PrivacySettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      AsyncStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  };

  const updateSettings = useCallback(async (patch: Partial<PrivacySettings>): Promise<void> => {
    await updateSettingsInternal(patch);
  }, []);

  return (
    <PrivacyContext.Provider value={{
      isLocked,
      isBackground,
      settings,
      biometricAvailable,
      biometricType,
      lock,
      unlockWithPIN,
      unlockWithBiometric,
      setPIN,
      removePIN,
      updateSettings,
      recordActivity,
    }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
