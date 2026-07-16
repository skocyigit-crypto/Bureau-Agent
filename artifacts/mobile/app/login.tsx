import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { MOBILE_APP_ORIGIN } from "@/lib/api-config";
import { useColors } from "@/hooks/useColors";
import {
  enableBiometric,
  getBiometricCapability,
  getBiometricCredentials,
  isBiometricEnabled,
} from "@/lib/biometric";

type Mode = "login" | "forgot" | "forgot_done";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const isWeb = Platform.OS === "web";

  // Déverrouillage biométrique: libellé du capteur + état activé.
  const [bioLabel, setBioLabel] = useState("");
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioCapable, setBioCapable] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);

  const finishLogin = useCallback(
    async (mail: string, pwd: string, offerBiometric: boolean): Promise<boolean> => {
      const result = await login(mail.trim(), pwd);
      if (!result.success) {
        setError(result.error ?? "Erreur inconnue.");
        return false;
      }
      // Après une connexion manuelle réussie sur un appareil compatible et
      // si la biométrie n'est pas encore activée, proposer de l'activer.
      if (offerBiometric && bioCapable && !bioEnabled) {
        const enabled = await enableBiometric(mail.trim(), pwd);
        setBioEnabled(enabled);
      }
      router.replace("/(tabs)");
      return true;
    },
    [login, bioCapable, bioEnabled],
  );

  const unlockWithBiometric = useCallback(async () => {
    setError("");
    setBioLoading(true);
    try {
      const creds = await getBiometricCredentials();
      if (!creds) {
        setBioLoading(false);
        return;
      }
      const ok = await finishLogin(creds.email, creds.password, false);
      if (!ok) setBioLoading(false);
    } catch {
      setBioLoading(false);
    }
  }, [finishLogin]);

  // Sonde la capacité biométrique au montage et déclenche l'invite si activé.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [cap, enabled] = await Promise.all([
        getBiometricCapability(),
        isBiometricEnabled(),
      ]);
      if (cancelled) return;
      setBioCapable(cap.available);
      setBioLabel(cap.label);
      setBioEnabled(enabled);
      if (cap.available && enabled) {
        unlockWithBiometric();
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      setError("Veuillez remplir tous les champs.");
      return;
    }
    setLoading(true);
    setError("");
    await finishLogin(email, password, true);
    setLoading(false);
  }

  async function handleForgot() {
    if (!email.trim()) {
      setError("Entrez votre adresse e-mail.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: MOBILE_APP_ORIGIN },
        body: JSON.stringify({ email: email.trim() }),
      });
      setMode("forgot_done");
    } catch {
      setError("Erreur lors de l'envoi. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  const bioIcon = bioLabel === "Face ID" ? "smile" : "unlock";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.secondary,
          paddingTop: isWeb ? 67 : insets.top,
          paddingBottom: isWeb ? 34 : insets.bottom,
        },
      ]}
    >
      <View style={styles.topSection}>
        <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
          <Feather name="headphones" size={32} color={colors.secondary} />
        </View>
        <Text style={styles.brandTitle}>Ajant Bureau</Text>
        <Text style={styles.brandSubtitle}>Solution professionnelle de gestion</Text>
      </View>

      <View style={[styles.formSection, { backgroundColor: colors.background }]}>
        <Text style={[styles.formTitle, { color: colors.foreground }]}>
          {mode === "login" ? "Connexion" : mode === "forgot" ? "Mot de passe oublié" : "E-mail envoyé"}
        </Text>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15" }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        {mode === "forgot_done" ? (
          <>
            <View style={[styles.infoBox, { backgroundColor: colors.success ? colors.success + "15" : "#22c55e15" }]}>
              <Feather name="mail" size={18} color={colors.success ?? "#22c55e"} />
              <Text style={[styles.infoText, { color: colors.foreground }]}>
                Si un compte existe pour {email.trim()}, un lien de réinitialisation vient d'être envoyé. Vérifiez votre boîte mail (et les indésirables).
              </Text>
            </View>
            <Pressable
              onPress={() => { setMode("login"); setError(""); }}
              style={[styles.loginButton, { backgroundColor: colors.primary, marginTop: 8 }]}
            >
              <Text style={[styles.loginButtonText, { color: colors.primaryForeground }]}>Retour à la connexion</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.inputGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Adresse e-mail</Text>
              <View style={[styles.inputContainer, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Feather name="mail" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="nom@entreprise.fr"
                  placeholderTextColor={colors.mutedForeground}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="email-input"
                />
              </View>
            </View>

            {mode === "login" && (
              <View style={styles.inputGroup}>
                <View style={styles.passwordLabelRow}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Mot de passe</Text>
                  <Pressable onPress={() => { setMode("forgot"); setError(""); }} hitSlop={10} testID="forgot-link">
                    <Text style={[styles.forgotLink, { color: colors.primary }]}>Mot de passe oublié ?</Text>
                  </Pressable>
                </View>
                <View style={[styles.inputContainer, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="lock" size={18} color={colors.mutedForeground} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="Votre mot de passe"
                    placeholderTextColor={colors.mutedForeground}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    testID="password-input"
                  />
                  <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                    <Feather
                      name={showPassword ? "eye-off" : "eye"}
                      size={18}
                      color={colors.mutedForeground}
                    />
                  </Pressable>
                </View>
              </View>
            )}

            <Pressable
              onPress={mode === "login" ? handleLogin : handleForgot}
              disabled={loading}
              style={({ pressed }) => [
                styles.loginButton,
                { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 },
              ]}
              testID="login-button"
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.loginButtonText, { color: colors.primaryForeground }]}>
                  {mode === "login" ? "Se connecter" : "Envoyer le lien"}
                </Text>
              )}
            </Pressable>

            {mode === "login" && bioCapable && bioEnabled && (
              <Pressable
                onPress={unlockWithBiometric}
                disabled={bioLoading}
                style={({ pressed }) => [
                  styles.bioButton,
                  { borderColor: colors.border, opacity: pressed || bioLoading ? 0.7 : 1 },
                ]}
                testID="biometric-button"
              >
                {bioLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <>
                    <Feather name={bioIcon as any} size={18} color={colors.primary} />
                    <Text style={[styles.bioButtonText, { color: colors.primary }]}>
                      Déverrouiller avec {bioLabel}
                    </Text>
                  </>
                )}
              </Pressable>
            )}

            {mode === "forgot" && (
              <Pressable
                onPress={() => { setMode("login"); setError(""); }}
                style={styles.backLink}
                hitSlop={10}
              >
                <Feather name="arrow-left" size={14} color={colors.mutedForeground} />
                <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>Retour à la connexion</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topSection: {
    alignItems: "center",
    paddingVertical: 40,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  brandTitle: {
    fontSize: 24,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  brandSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.6)",
    marginTop: 4,
  },
  formSection: {
    flex: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 32,
  },
  formTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    marginBottom: 24,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    borderRadius: 10,
    marginBottom: 4,
    gap: 10,
  },
  infoText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 19,
  },
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
  },
  passwordLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  forgotLink: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  loginButton: {
    height: 50,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  loginButtonText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  bioButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  bioButtonText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 18,
    paddingVertical: 8,
  },
  backLinkText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
