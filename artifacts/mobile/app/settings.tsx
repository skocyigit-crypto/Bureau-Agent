import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/contexts/ThemeContext";

interface Subscription {
  plan: string;
  status: string;
  licenseKey?: string;
  maxUsers: number;
  maxContacts: number;
  maxCallsPerMonth: number;
  price: string;
  billingCycle: string;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
}

const PLAN_LABELS: Record<string, string> = {
  essai: "Essai gratuit",
  starter: "Starter",
  professionnel: "Professionnel",
  entreprise: "Entreprise",
};

const PLAN_COLORS: Record<string, string> = {
  essai: "#64748b",
  starter: "#3b82f6",
  professionnel: "#8b5cf6",
  entreprise: "#f59e0b",
};

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const [sub, setSub] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/subscription`);
        if (res.ok) { const data = await res.json(); setSub(data.subscription ?? data); }
      } catch (err) { console.warn("[Settings] fetch failed:", err); } finally { setLoading(false); }
    })();
  }, [fetchAuth]);

  function InfoRow({ icon, label, value, color }: { icon: keyof typeof Feather.glyphMap; label: string; value: string; color?: string }) {
    return (
      <View style={[styles.infoRow, { borderBottomColor: colors.border }]}>
        <Feather name={icon} size={16} color={color || colors.mutedForeground} style={styles.infoIcon} />
        <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.infoValue, { color: colors.foreground }]}>{value}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <Text style={styles.headerTitle}>Parametres</Text>
          <View style={{ width: 22 }} />
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 40 }]} showsVerticalScrollIndicator={false}>
        {user ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <Feather name="user" size={18} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Profil</Text>
            </View>
            <InfoRow icon="user" label="Nom" value={`${user.prenom} ${user.nom}`} />
            <InfoRow icon="mail" label="E-mail" value={user.email} />
            <InfoRow icon="shield" label="Role" value={user.role === "super_admin" ? "Super Admin" : user.role === "administrateur" ? "Administrateur" : user.role === "agent" ? "Agent" : "Lecture seule"} />
            {user.departement ? <InfoRow icon="briefcase" label="Departement" value={user.departement} /> : null}
            {user.organisation ? <InfoRow icon="home" label="Organisation" value={user.organisation} /> : null}
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="credit-card" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Abonnement</Text>
          </View>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={styles.subLoading} />
          ) : sub ? (
            <>
              <View style={[styles.planBadge, { backgroundColor: (PLAN_COLORS[sub.plan] ?? "#64748b") + "18" }]}>
                <Feather name="star" size={16} color={PLAN_COLORS[sub.plan] ?? "#64748b"} />
                <Text style={[styles.planName, { color: PLAN_COLORS[sub.plan] ?? "#64748b" }]}>
                  {PLAN_LABELS[sub.plan] ?? sub.plan}
                </Text>
                <View style={[styles.statusDot, { backgroundColor: sub.status === "active" ? "#22c55e" : "#f59e0b" }]} />
                <Text style={[styles.statusText, { color: sub.status === "active" ? "#22c55e" : "#f59e0b" }]}>
                  {sub.status === "active" ? "Actif" : sub.status}
                </Text>
              </View>
              <InfoRow icon="users" label="Utilisateurs max" value={`${sub.maxUsers}`} />
              <InfoRow icon="book" label="Contacts max" value={sub.maxContacts >= 999999 ? "Illimite" : `${sub.maxContacts}`} />
              <InfoRow icon="phone" label="Appels/mois" value={sub.maxCallsPerMonth >= 999999 ? "Illimite" : `${sub.maxCallsPerMonth}`} />
              <InfoRow icon="tag" label="Prix" value={`${sub.price} EUR/${sub.billingCycle === "monthly" ? "mois" : "an"}`} />
              {sub.trialEndsAt ? <InfoRow icon="clock" label="Fin d'essai" value={new Date(sub.trialEndsAt).toLocaleDateString("fr-FR")} color="#f59e0b" /> : null}
              {sub.currentPeriodEnd ? <InfoRow icon="calendar" label="Prochain renouvellement" value={new Date(sub.currentPeriodEnd).toLocaleDateString("fr-FR")} /> : null}
            </>
          ) : (
            <Text style={[styles.noSub, { color: colors.mutedForeground }]}>Aucun abonnement actif</Text>
          )}
        </View>

        <ThemeCard />

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Feather name="info" size={18} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Application</Text>
          </View>
          <InfoRow icon="smartphone" label="Version" value="1.0.0" />
          <InfoRow icon="globe" label="Plateforme" value={Platform.OS === "ios" ? "iOS" : Platform.OS === "android" ? "Android" : "Web"} />
          <InfoRow icon="code" label="Framework" value="React Native / Expo" />
        </View>
      </ScrollView>
    </View>
  );
}

function ThemeCard() {
  const colors = useColors();
  const { mode, setMode } = useTheme();
  const modes: { key: "system" | "light" | "dark"; icon: keyof typeof Feather.glyphMap; label: string }[] = [
    { key: "system", icon: "smartphone", label: "Systeme" },
    { key: "light", icon: "sun", label: "Clair" },
    { key: "dark", icon: "moon", label: "Sombre" },
  ];
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <Feather name="moon" size={18} color={colors.primary} />
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>Apparence</Text>
      </View>
      <View style={styles.themeRow}>
        {modes.map(m => (
          <Pressable
            key={m.key}
            onPress={() => setMode(m.key)}
            style={[styles.themeBtn, { borderColor: mode === m.key ? colors.primary : colors.border, backgroundColor: mode === m.key ? colors.primary + "18" : "transparent" }]}
          >
            <Feather name={m.icon} size={20} color={mode === m.key ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.themeBtnLabel, { color: mode === m.key ? colors.primary : colors.mutedForeground }]}>{m.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  card: { borderRadius: 12, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 },
  cardTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  infoRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  infoIcon: { marginRight: 12 },
  infoLabel: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  infoValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
  planBadge: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 },
  planName: { fontSize: 15, fontFamily: "Inter_700Bold", flex: 1 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  subLoading: { padding: 20 },
  noSub: { padding: 16, textAlign: "center", fontSize: 14, fontFamily: "Inter_400Regular" },
  themeRow: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  themeBtn: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, gap: 4 },
  themeBtnLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
});
