/**
 * PrivacyOverlay.tsx — Gizlilik Ekranı ve Kilit Bileşeni
 *
 * İki işlev:
 *  1. Arka plan örtüsü — uygulama arka planda iken içerik gizlenir
 *  2. Kilit ekranı — PIN veya biyometrik ile kilit açma arayüzü
 */

import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePrivacy } from "@/contexts/PrivacyContext";
import { useColors } from "@/hooks/useColors";

const nativeDriver = Platform.OS !== "web";

// ── Arka plan örtüsü (uygulama switcher'ında içeriği gizler) ─────────────────

function BackgroundShield() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Platform.OS !== "web" ? (
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: "#0f1729" }]} />
      )}
      <View style={styles.shieldContent}>
        <View style={styles.logoCircle}>
          <Feather name="phone-call" size={36} color="#f59e0b" />
        </View>
        <Text style={styles.shieldTitle}>Ajant Bureau</Text>
        <Text style={styles.shieldSubtitle}>Contenu protege</Text>
      </View>
    </View>
  );
}

// ── PIN tuş takımı ─────────────────────────────────────────────────────────────

const PIN_LENGTH = 4;

interface PinPadProps {
  onComplete: (pin: string) => void;
  error: boolean;
  onErrorReset: () => void;
}

function PinPad({ onComplete, error, onErrorReset }: PinPadProps) {
  const [digits, setDigits] = useState<string[]>([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (error) {
      // Sallama animasyonu
      Animated.sequence([
        Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: nativeDriver }),
        Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: nativeDriver }),
        Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: nativeDriver }),
        Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: nativeDriver }),
        Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: nativeDriver }),
      ]).start(() => {
        setDigits([]);
        onErrorReset();
      });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    }
  }, [error, shakeAnim, onErrorReset]);

  const pressDigit = (d: string) => {
    if (digits.length >= PIN_LENGTH) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const next = [...digits, d];
    setDigits(next);
    if (next.length === PIN_LENGTH) {
      setTimeout(() => onComplete(next.join("")), 80);
    }
  };

  const pressDelete = () => {
    if (digits.length === 0) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setDigits(prev => prev.slice(0, -1));
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <View style={styles.pinPadContainer}>
      {/* Noktalar */}
      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < digits.length ? styles.dotFilled : styles.dotEmpty,
              error && styles.dotError,
            ]}
          />
        ))}
      </Animated.View>

      {/* Tuş takımı */}
      <View style={styles.keyGrid}>
        {keys.map((key, idx) => {
          if (key === "") return <View key={idx} style={styles.keyEmpty} />;
          if (key === "del") {
            return (
              <Pressable key={idx} style={styles.keyBtn} onPress={pressDelete}>
                <Feather name="delete" size={22} color="#ffffff" />
              </Pressable>
            );
          }
          return (
            <Pressable
              key={idx}
              style={({ pressed }) => [styles.keyBtn, pressed && styles.keyBtnPressed]}
              onPress={() => pressDigit(key)}
            >
              <Text style={styles.keyText}>{key}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ── Kilit ekranı ───────────────────────────────────────────────────────────────

function LockScreen() {
  const {
    unlockWithPIN,
    unlockWithBiometric,
    biometricAvailable,
    biometricType,
    settings,
  } = usePrivacy();
  const insets = useSafeAreaInsets();

  const [pinError, setPinError] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [showPIN, setShowPIN] = useState(!settings.biometricEnabled || !biometricAvailable);

  // Otomatik biyometrik başlatma
  useEffect(() => {
    if (settings.biometricEnabled && biometricAvailable && !showPIN) {
      tryBiometric();
    }
  }, []); // eslint-disable-line

  const tryBiometric = useCallback(async () => {
    setBioLoading(true);
    const ok = await unlockWithBiometric();
    setBioLoading(false);
    if (!ok) {
      // Biyometrik başarısız olursa PIN'e geç
      if (settings.hasPIN) setShowPIN(true);
    }
  }, [unlockWithBiometric, settings.hasPIN]);

  const handlePIN = useCallback(async (pin: string) => {
    const ok = await unlockWithPIN(pin);
    if (!ok) {
      setAttempts(a => a + 1);
      setPinError(true);
    }
  }, [unlockWithPIN]);

  return (
    <View style={[styles.lockScreen, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      {/* Logo alanı */}
      <View style={styles.lockHeader}>
        <View style={styles.lockLogoCircle}>
          <Feather name="phone-call" size={32} color="#f59e0b" />
        </View>
        <Text style={styles.lockTitle}>Ajant Bureau</Text>
        <Text style={styles.lockSubtitle}>
          {showPIN ? "Entrez votre code PIN" : "Verifiez votre identite"}
        </Text>
      </View>

      {/* PIN veya biyometrik */}
      {showPIN ? (
        <>
          <PinPad
            onComplete={handlePIN}
            error={pinError}
            onErrorReset={() => setPinError(false)}
          />
          {attempts > 0 && (
            <Text style={styles.errorText}>
              Code incorrect ({attempts} tentative{attempts > 1 ? "s" : ""})
            </Text>
          )}
          {/* Biyometrik butonu (eğer etkinse) */}
          {settings.biometricEnabled && biometricAvailable && (
            <Pressable style={styles.bioBtn} onPress={tryBiometric}>
              <Feather name="cpu" size={16} color="#f59e0b" />
              <Text style={styles.bioBtnText}>
                Utiliser {biometricType || "la biometrie"}
              </Text>
            </Pressable>
          )}
        </>
      ) : (
        <View style={styles.bioCenter}>
          <Pressable style={styles.bioBigBtn} onPress={tryBiometric} disabled={bioLoading}>
            {bioLoading ? (
              <ActivityIndicator color="#f59e0b" size="large" />
            ) : (
              <>
                <View style={styles.bioBigIcon}>
                  <Feather
                    name={biometricType === "Face ID" ? "user" : "activity"}
                    size={42}
                    color="#f59e0b"
                  />
                </View>
                <Text style={styles.bioBigText}>
                  {biometricType === "Face ID" ? "Face ID ile ac" : "Parmak izi ile ac"}
                </Text>
                <Text style={styles.bioBigHint}>Dokunun veya yuzunuzu goruntuye alin</Text>
              </>
            )}
          </Pressable>
          {settings.hasPIN && (
            <Pressable style={styles.altBtn} onPress={() => setShowPIN(true)}>
              <Text style={styles.altBtnText}>Code PIN kullan</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

// ── Ana bileşen ────────────────────────────────────────────────────────────────

export function PrivacyOverlay() {
  const { isLocked, isBackground, settings } = usePrivacy();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  const shouldShow = isLocked || (isBackground && settings.privacyScreenEnabled);

  useEffect(() => {
    if (shouldShow) {
      setVisible(true);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: nativeDriver }).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: nativeDriver }).start(() => {
        setVisible(false);
      });
    }
  }, [shouldShow, fadeAnim]);

  if (!visible) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, { opacity: fadeAnim }]} pointerEvents={shouldShow ? "auto" : "none"}>
      {isLocked ? <LockScreen /> : <BackgroundShield />}
    </Animated.View>
  );
}

// ── Hassas veri maskeleme bileşeni ────────────────────────────────────────────

interface MaskedTextProps {
  value: string;
  maskChar?: string;
  style?: any;
  visibleCount?: number;
}

export function MaskedText({ value, maskChar = "•", style, visibleCount = 4 }: MaskedTextProps) {
  const { settings } = usePrivacy();
  const [revealed, setRevealed] = useState(false);

  if (!settings.maskSensitiveData || revealed) {
    return (
      <Pressable onLongPress={() => settings.maskSensitiveData && setRevealed(false)}>
        <Text style={style}>{value}</Text>
      </Pressable>
    );
  }

  const masked = value.length > visibleCount
    ? value.slice(-visibleCount).padStart(value.length, maskChar)
    : maskChar.repeat(value.length);

  return (
    <Pressable onPress={() => setRevealed(true)} hitSlop={4}>
      <Text style={[style, { opacity: 0.7 }]}>{masked}</Text>
    </Pressable>
  );
}

// ── Stiller ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: {
    zIndex: 9999,
    backgroundColor: "#0f1729",
  },

  // Arka plan kalkanı
  shieldContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(245,158,11,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  shieldTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  shieldSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
  },

  // Kilit ekranı
  lockScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  lockHeader: {
    alignItems: "center",
    gap: 8,
    marginTop: 24,
  },
  lockLogoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(245,158,11,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  lockTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  lockSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    textAlign: "center",
  },

  // PIN pad
  pinPadContainer: {
    alignItems: "center",
    gap: 32,
    flex: 1,
    justifyContent: "center",
  },
  dotsRow: {
    flexDirection: "row",
    gap: 20,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  dotEmpty: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  dotFilled: {
    backgroundColor: "#f59e0b",
  },
  dotError: {
    backgroundColor: "#ef4444",
  },
  keyGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: 260,
    gap: 12,
    justifyContent: "center",
  },
  keyBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  keyBtnPressed: {
    backgroundColor: "rgba(245,158,11,0.25)",
  },
  keyEmpty: {
    width: 76,
    height: 76,
  },
  keyText: {
    fontSize: 26,
    fontFamily: "Inter_500Medium",
    color: "#ffffff",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: -16,
    marginBottom: 8,
  },

  // Biyometrik
  bioCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  bioBigBtn: {
    alignItems: "center",
    gap: 12,
    padding: 24,
  },
  bioBigIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderWidth: 2,
    borderColor: "rgba(245,158,11,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  bioBigText: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    color: "#ffffff",
  },
  bioBigHint: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.5)",
  },
  bioBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.3)",
    marginTop: 4,
    marginBottom: 12,
  },
  bioBtnText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: "#f59e0b",
  },
  altBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  altBtnText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: "rgba(255,255,255,0.5)",
    textDecorationLine: "underline",
  },
});
