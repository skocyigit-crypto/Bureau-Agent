import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const AUTO_LOGIN_EMAIL = "admin@agentdebureau.fr";

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const isWeb = Platform.OS === "web";

  const isAutoLogin = email.toLowerCase().trim() === AUTO_LOGIN_EMAIL;

  async function handleLogin() {
    if (!email.trim()) {
      setError("Veuillez entrer votre adresse e-mail.");
      return;
    }
    if (!isAutoLogin && !password.trim()) {
      setError("Veuillez entrer votre mot de passe.");
      return;
    }
    setLoading(true);
    setError("");
    const result = await login(email.trim(), isAutoLogin ? undefined : password);
    setLoading(false);
    if (result.success) {
      router.replace("/(tabs)");
    } else {
      setError(result.error ?? "Erreur inconnue.");
    }
  }

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
        <Text style={styles.brandTitle}>Agent de Bureau</Text>
        <Text style={styles.brandSubtitle}>Solution professionnelle de gestion</Text>
      </View>

      <View style={[styles.formSection, { backgroundColor: colors.background }]}>
        <Text style={[styles.formTitle, { color: colors.foreground }]}>Connexion</Text>

        {error ? (
          <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15" }]}>
            <Feather name="alert-circle" size={16} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

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

        {!isAutoLogin && (
          <View style={styles.inputGroup}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Mot de passe</Text>
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
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={8}>
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
          onPress={handleLogin}
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
              Se connecter
            </Text>
          )}
        </Pressable>
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
  inputGroup: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
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
});
