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
import { useUnreadBadges } from "@/contexts/UnreadBadgesContext";
import { usePendingApprovals } from "@/hooks/usePendingApprovals";
import { useColors } from "@/hooks/useColors";
import { useTranslation } from "@/lib/i18n";

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
    <Pressable accessibilityRole="button"
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
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { counts } = useUnreadBadges();
  const { pending: pendingApprovals } = usePendingApprovals();
  const isWeb = Platform.OS === "web";

  function handleLogout() {
    if (Platform.OS === "web") {
      doLogout();
      return;
    }
    Alert.alert(t("moreScreen.logoutTitle"), t("moreScreen.logoutMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("moreScreen.logout"), style: "destructive", onPress: doLogout },
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
        <Text style={styles.headerTitle}>{t("moreScreen.title")}</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}
        showsVerticalScrollIndicator={false}
      >
        {user ? (
          <Pressable accessibilityRole="button"
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
                  {user.role === "super_admin" ? t("moreScreen.roleSuperAdmin") : user.role === "administrateur" ? t("moreScreen.roleAdmin") : user.role === "agent" ? t("moreScreen.roleAgent") : t("moreScreen.roleReadOnly")}
                </Text>
              </View>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secCommunication")}</Text>
          <MenuItem icon="inbox" label={t("moreScreen.approvalQueue")} sublabel={t("moreScreen.approvalQueueSub")} color="#059669" badge={pendingApprovals} onPress={() => nav("/file-approbation")} />
          <MenuItem icon="zap" label={t("moreScreen.proactiveAssistant")} sublabel={t("moreScreen.proactiveAssistantSub")} color="#f59e0b" onPress={() => nav("/assistant-proactif")} />
          <MenuItem icon="cpu" label={t("moreScreen.aiLearned")} sublabel={t("moreScreen.aiLearnedSub")} color="#8b5cf6" onPress={() => nav("/ia-apprentissage")} />
          <MenuItem icon="message-square" label={t("moreScreen.messages")} sublabel={t("moreScreen.messagesSub")} color="#3b82f6" badge={counts.message} onPress={() => nav("/messages")} />
          <MenuItem icon="message-circle" label={t("moreScreen.whatsapp")} sublabel={t("moreScreen.whatsappSub")} color="#25D366" onPress={() => nav("/whatsapp")} />
          <MenuItem icon="shield" label={t("moreScreen.securityCenter")} sublabel={t("moreScreen.securityCenterSub")} color="#10b981" onPress={() => nav("/securite")} />
          <MenuItem icon="phone-call" label={t("moreScreen.telephony")} sublabel={t("moreScreen.telephonySub")} color="#22c55e" onPress={() => nav("/telephony")} />
          <MenuItem icon="phone" label={t("moreScreen.callLog")} sublabel={t("moreScreen.callLogSub")} color="#166534" onPress={() => nav("/calls")} />
          <MenuItem icon="users" label={t("moreScreen.contacts")} sublabel={t("moreScreen.contactsSub")} color="#0369a1" onPress={() => nav("/contacts")} />
          <MenuItem icon="upload" label={t("moreScreen.importContacts")} sublabel={t("moreScreen.importContactsSub")} color="#0369a1" onPress={() => nav("/contacts-import")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secProductivity")}</Text>
          <MenuItem icon="check-square" label={t("moreScreen.tasks")} sublabel={t("moreScreen.tasksSub")} color="#1e3a5f" onPress={() => nav("/tasks")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secCrm")}</Text>
          {/* Prospects deplacé dans le backoffice SaaS (super-admin uniquement).
              Voir Tâche #52 — Admin Backoffice + Müşteri Sadeleştirme. */}
          {user?.role === "super_admin" && (
            <MenuItem icon="trending-up" label={t("moreScreen.prospects")} sublabel={t("moreScreen.prospectsSub")} color="#8b5cf6" onPress={() => nav("/prospects")} />
          )}
          <MenuItem icon="edit-2" label={t("moreScreen.internalNotes")} sublabel={t("moreScreen.internalNotesSub")} color="#f59e0b" onPress={() => nav("/notes-internes")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secDocuments")}</Text>
          <MenuItem icon="folder" label={t("moreScreen.documents")} sublabel={t("moreScreen.documentsSub")} color="#0f766e" onPress={() => nav("/documents")} />
          <MenuItem icon="book-open" label={t("moreScreen.knowledgeBase")} sublabel={t("moreScreen.knowledgeBaseSub")} color="#0ea5e9" onPress={() => nav("/knowledge-base")} />
          <MenuItem icon="upload" label={t("moreScreen.importDocuments")} sublabel={t("moreScreen.importDocumentsSub")} color="#0f766e" onPress={() => nav("/document-import")} />
          <MenuItem icon="credit-card" label={t("moreScreen.expenses")} sublabel={t("moreScreen.expensesSub")} color="#0d9488" onPress={() => nav("/depenses")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secReports")}</Text>
          <MenuItem icon="sun" label={t("moreScreen.dailyDigest")} sublabel={t("moreScreen.dailyDigestSub")} color="#f59e0b" onPress={() => nav("/daily-digest")} />
          <MenuItem icon="cpu" label={t("moreScreen.teamAgent")} sublabel={t("moreScreen.teamAgentSub")} color="#7c3aed" onPress={() => nav("/workforce-agent")} />
          <MenuItem icon="users" label={t("moreScreen.teamIntelligence")} sublabel={t("moreScreen.teamIntelligenceSub")} color="#6366f1" onPress={() => nav("/workforce-intelligence")} />
          <MenuItem icon="bar-chart-2" label={t("moreScreen.teamPerformance")} sublabel={t("moreScreen.teamPerformanceSub")} color="#0f4c81" onPress={() => nav("/performance")} />
          <MenuItem icon="award" label={t("moreScreen.executiveReport")} sublabel={t("moreScreen.executiveReportSub")} color="#1e293b" onPress={() => nav("/rapport-executif")} />
          <MenuItem icon="file-text" label={t("moreScreen.reportsTickets")} sublabel={t("moreScreen.reportsTicketsSub")} color="#7c3aed" onPress={() => nav("/reports")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secTools")}</Text>
          <MenuItem icon="search" label={t("moreScreen.globalSearch")} sublabel={t("moreScreen.globalSearchSub")} color="#1e293b" onPress={() => nav("/recherche")} />
          <MenuItem icon="globe" label={t("moreScreen.webSearch")} sublabel={t("moreScreen.webSearchSub")} color="#0ea5e9" onPress={() => nav("/recherche-web")} />
          <MenuItem icon="activity" label={t("moreScreen.recentActivity")} sublabel={t("moreScreen.recentActivitySub")} color="#0f172a" onPress={() => nav("/activite-recente")} />
          <MenuItem icon="bar-chart-2" label={t("moreScreen.analytics")} sublabel={t("moreScreen.analyticsSub")} color="#f59e0b" onPress={() => nav("/analytics")} />
          <MenuItem icon="calendar" label={t("moreScreen.calendar")} sublabel={t("moreScreen.calendarSub")} color="#ec4899" onPress={() => nav("/calendar")} />
          <MenuItem icon="bell" label={t("moreScreen.reminders")} sublabel={t("moreScreen.remindersSub")} color="#3b82f6" onPress={() => nav("/rappels")} />
          <MenuItem icon="folder" label={t("moreScreen.projects")} sublabel={t("moreScreen.projectsSub")} color="#6366f1" onPress={() => nav("/projets")} />
          <MenuItem icon="clock" label={t("moreScreen.checkins")} sublabel={t("moreScreen.checkinsSub")} color="#14b8a6" onPress={() => nav("/checkins")} />
          <MenuItem icon="users" label={t("moreScreen.aiMeeting")} sublabel={t("moreScreen.aiMeetingSub")} color="#8b5cf6" onPress={() => nav("/meetings")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secAI")}</Text>
          <MenuItem icon="mail" label={t("moreScreen.gmailAgent")} sublabel={t("moreScreen.gmailAgentSub")} color="#dc2626" onPress={() => nav("/gmail-agent")} />
          <MenuItem icon="file-text" label={t("moreScreen.documentAI")} sublabel={t("moreScreen.documentAISub")} color="#7c3aed" onPress={() => nav("/document-ai")} />
          <MenuItem icon="cpu" label={t("moreScreen.aiCommander")} sublabel={t("moreScreen.aiCommanderSub")} color="#7c3aed" onPress={() => nav("/commandant-ia")} />
          <MenuItem icon="phone-call" label={t("moreScreen.callAssistant")} sublabel={t("moreScreen.callAssistantSub")} color="#166534" onPress={() => nav("/call-assistant")} />
          <MenuItem icon="activity" label={t("moreScreen.superAgent")} sublabel={t("moreScreen.superAgentSub")} color="#0f172a" onPress={() => nav("/super-agent")} />
          <MenuItem icon="message-circle" label={t("moreScreen.aiAssistant")} sublabel={t("moreScreen.aiAssistantSub")} color="#8b5cf6" onPress={() => nav("/ai-chat")} />
          <MenuItem icon="mic" label={t("moreScreen.voiceAssistant")} sublabel={t("moreScreen.voiceAssistantSub")} color="#ef4444" onPress={() => nav("/voice-assistant")} />
          <MenuItem icon="cpu" label={t("moreScreen.aiAgents")} sublabel={t("moreScreen.aiAgentsSub")} color="#6366f1" onPress={() => nav("/ai-agents")} />
          <MenuItem icon="zap" label={t("moreScreen.automations")} sublabel={t("moreScreen.automationsSub")} color="#f97316" onPress={() => nav("/automations")} />
        </View>

        {(user?.role === "super_admin" || user?.role === "administrateur") ? (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secAdmin")}</Text>
            <MenuItem icon="briefcase" label={t("moreScreen.mySpace")} sublabel={t("moreScreen.mySpaceSub")} color="#14b8a6" onPress={() => nav("/admin-reports")} />
            <MenuItem icon="users" label={t("moreScreen.users")} sublabel={t("moreScreen.usersSub")} color="#3b82f6" onPress={() => nav("/users")} />
            <MenuItem icon="shield" label={t("moreScreen.auditLog")} sublabel={t("moreScreen.auditLogSub")} color="#ef4444" onPress={() => nav("/audit-log")} />
            <MenuItem icon="grid" label={t("moreScreen.integrations")} sublabel={t("moreScreen.integrationsSub")} color="#22c55e" onPress={() => nav("/integrations")} />
            <MenuItem icon="monitor" label={t("moreScreen.software")} sublabel={t("moreScreen.softwareSub")} color="#0891b2" onPress={() => nav("/integrations")} />
            <MenuItem icon="globe" label={t("moreScreen.googleWorkspace")} sublabel={t("moreScreen.googleWorkspaceSub")} color="#4285f4" onPress={() => nav("/google-workspace")} />
            <MenuItem icon="clock" label={t("moreScreen.openingHours")} sublabel={t("moreScreen.openingHoursSub")} color="#6366f1" onPress={() => nav("/horaires-ouverture")} />
            <MenuItem icon="key" label={t("moreScreen.licenses")} sublabel={t("moreScreen.licensesSub")} color="#166534" onPress={() => nav("/license-management")} />
            {user?.role === "super_admin" ? (
              <MenuItem icon="home" label={t("moreScreen.organisations")} sublabel={t("moreScreen.organisationsSub")} color="#f59e0b" onPress={() => nav("/organisations")} />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{t("moreScreen.secAccount")}</Text>
          <MenuItem icon="settings" label={t("moreScreen.settings")} sublabel={t("moreScreen.settingsSub")} color="#64748b" onPress={() => nav("/settings")} />
          <MenuItem icon="credit-card" label={t("moreScreen.subscription")} sublabel={t("moreScreen.subscriptionSub")} color="#7c3aed" onPress={() => nav("/abonnement")} />
          <MenuItem icon="log-out" label={t("moreScreen.logout")} onPress={handleLogout} danger />
        </View>

        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          {t("moreScreen.version", { version: "1.0.0" })}
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
