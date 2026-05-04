import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface MenuItemProps {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  sublabel?: string;
  color?: string;
  onPress?: () => void;
  danger?: boolean;
  badge?: number;
}

function MenuItem({ icon, label, sublabel, color, onPress, danger, badge }: MenuItemProps) {
  const colors = useColors();
  const iconColor = danger ? colors.destructive : color ?? colors.foreground;

  function handlePress() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress?.();
  }

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [
        styles.menuItem,
        { borderBottomColor: colors.border },
        pressed && { opacity: 0.6 },
      ]}
    >
      <View style={[styles.menuIcon, { backgroundColor: iconColor + "15" }]}>
        <Feather name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.menuContent}>
        <Text style={[styles.menuLabel, { color: danger ? colors.destructive : colors.foreground }]}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={[styles.menuSublabel, { color: colors.mutedForeground }]}>{sublabel}</Text>
        ) : null}
      </View>
      {badge && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.destructive }]}>
          <Text style={styles.badgeText}>{badge > 99 ? "99+" : badge}</Text>
        </View>
      ) : null}
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function MoreScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const isWeb = Platform.OS === "web";

  function handleLogout() {
    if (Platform.OS === "web") {
      doLogout();
      return;
    }
    Alert.alert("Deconnexion", "Voulez-vous vraiment vous deconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Se deconnecter", style: "destructive", onPress: doLogout },
    ]);
  }

  async function doLogout() {
    await logout();
    router.replace("/login");
  }

  function nav(route: string) {
    router.push(route as any);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.secondary,
            paddingTop: (isWeb ? 67 : insets.top) + 12,
          },
        ]}
      >
        <Text style={styles.headerTitle}>Plus</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {user ? (
          <Pressable
            onPress={() => nav("/settings")}
            style={({ pressed }) => [
              styles.profileCard,
              { backgroundColor: colors.card, borderColor: colors.border },
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.profileAvatar, { backgroundColor: colors.primary }]}>
              <Text style={[styles.profileInitials, { color: colors.primaryForeground }]}>
                {(user.prenom[0] + user.nom[0]).toUpperCase()}
              </Text>
            </View>
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: colors.foreground }]}>
                {user.prenom} {user.nom}
              </Text>
              <Text style={[styles.profileEmail, { color: colors.mutedForeground }]}>
                {user.email}
              </Text>
              <View style={[styles.roleBadge, { backgroundColor: colors.primary + "20" }]}>
                <Text style={[styles.roleText, { color: colors.primary }]}>
                  {user.role === "super_admin" ? "Super Admin" : user.role === "administrateur" ? "Administrateur" : user.role === "agent" ? "Agent" : "Lecture seule"}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>COMMUNICATION</Text>
          <MenuItem icon="message-square" label="Messages" sublabel="Messagerie vocale et notes" color="#3b82f6" onPress={() => nav("/messages")} />
          <MenuItem icon="phone-call" label="Telephonie" sublabel="Appels et SMS multi-fournisseurs" color="#22c55e" onPress={() => nav("/telephony")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>OUTILS</Text>
          <MenuItem icon="bar-chart-2" label="Analytique" sublabel="Rapports et statistiques" color="#f59e0b" onPress={() => nav("/analytics")} />
          <MenuItem icon="calendar" label="Calendrier" sublabel="Evenements et rendez-vous" color="#ec4899" onPress={() => nav("/calendar")} />
          <MenuItem icon="folder" label="Projets" sublabel="Gestion de portefeuille projets" color="#6366f1" onPress={() => nav("/projets")} />
          <MenuItem icon="clock" label="Pointage" sublabel="Gestion de presence" color="#14b8a6" onPress={() => nav("/checkins")} />
          <MenuItem icon="users" label="Réunion IA" sublabel="Compiler, taches & chantier GPS" color="#8b5cf6" onPress={() => nav("/meetings")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>INTELLIGENCE ARTIFICIELLE</Text>
          <MenuItem icon="message-circle" label="Assistant IA" sublabel="Chat conversationnel intelligent" color="#8b5cf6" onPress={() => nav("/ai-chat")} />
          <MenuItem icon="mic" label="Assistant Vocal" sublabel='Commandes vocales "Hey Bureau"' color="#ef4444" onPress={() => nav("/voice-assistant")} />
          <MenuItem icon="cpu" label="Agents IA" sublabel="Analyse et recommandations" color="#6366f1" onPress={() => nav("/ai-agents")} />
          <MenuItem icon="aperture" label="Reconnaissance faciale" sublabel="Identification IA en temps reel" color="#ec4899" onPress={() => nav("/face-recognition")} />
          <MenuItem icon="zap" label="Automations" sublabel="Regles et executions" color="#f97316" onPress={() => nav("/automations")} />
        </View>

        {(user?.role === "super_admin" || user?.role === "administrateur") ? (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ADMINISTRATION</Text>
            <MenuItem icon="briefcase" label="Mon Espace" sublabel="Equipe et rapports admin" color="#14b8a6" onPress={() => nav("/admin-reports")} />
            <MenuItem icon="users" label="Utilisateurs" sublabel="Gestion de l'equipe" color="#3b82f6" onPress={() => nav("/users")} />
            <MenuItem icon="shield" label="Journal d'audit" sublabel="Securite et historique" color="#ef4444" onPress={() => nav("/audit-log")} />
            <MenuItem icon="grid" label="Integrations" sublabel="Logiciels connectes" color="#22c55e" onPress={() => nav("/integrations")} />
            {user?.role === "super_admin" ? (
              <MenuItem icon="home" label="Organisations" sublabel="Gestion des licences" color="#f59e0b" onPress={() => nav("/organisations")} />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>COMPTE</Text>
          <MenuItem icon="settings" label="Parametres" sublabel="Profil et abonnement" color="#64748b" onPress={() => nav("/settings")} />
          <MenuItem icon="log-out" label="Se deconnecter" onPress={handleLogout} danger />
        </View>

        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          Agent de Bureau v1.0.0
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff" },
  scrollContent: { padding: 16 },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  profileInitials: { fontSize: 18, fontFamily: "Inter_700Bold" },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  profileEmail: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  roleBadge: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, marginTop: 6 },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  section: { borderRadius: 12, borderWidth: 1, marginBottom: 16, overflow: "hidden" },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuIcon: { width: 34, height: 34, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 12 },
  menuContent: { flex: 1 },
  menuLabel: { fontSize: 15, fontFamily: "Inter_500Medium" },
  menuSublabel: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 6, marginRight: 8 },
  badgeText: { color: "#ffffff", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  version: { textAlign: "center", fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8 },
});
