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
  const { counts } = useUnreadBadges();
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
          <MenuItem icon="inbox" label="File d'approbation" sublabel="Actions préparées par l'IA · à valider avant exécution" color="#059669" onPress={() => nav("/file-approbation")} />
          <MenuItem icon="zap" label="Assistant proactif" sublabel="Suggestions automatiques : tâches, appels, agenda" color="#f59e0b" onPress={() => nav("/assistant-proactif")} />
          <MenuItem icon="cpu" label="Ce que l'IA a appris" sublabel="Préférences et habitudes mémorisées par l'IA" color="#8b5cf6" onPress={() => nav("/ia-apprentissage")} />
          <MenuItem icon="message-square" label="Messages" sublabel="Messagerie vocale et notes" color="#3b82f6" badge={counts.message} onPress={() => nav("/messages")} />
          <MenuItem icon="message-circle" label="WhatsApp clients" sublabel="Boîte de réception client · brouillon IA à valider" color="#25D366" onPress={() => nav("/whatsapp")} />
          <MenuItem icon="shield" label="Centre de sécurité" sublabel="Scanner liens, fichiers, appels" color="#10b981" onPress={() => nav("/securite")} />
          <MenuItem icon="phone-call" label="Telephonie" sublabel="Appels et SMS multi-fournisseurs" color="#22c55e" onPress={() => nav("/telephony")} />
          <MenuItem icon="phone" label="Journal d'Appels" sublabel="Historique et enregistrement des appels" color="#166534" onPress={() => nav("/calls")} />
          <MenuItem icon="users" label="Contacts" sublabel="Annuaire clients et partenaires" color="#0369a1" onPress={() => nav("/contacts")} />
          <MenuItem icon="upload" label="Importer des contacts" sublabel="Import CSV ou saisie manuelle" color="#0369a1" onPress={() => nav("/contacts-import")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PRODUCTIVITÉ</Text>
          <MenuItem icon="check-square" label="Tâches" sublabel="Gestion des tâches et suivi" color="#1e3a5f" onPress={() => nav("/tasks")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>CRM & AGENTS</Text>
          {/* Prospects deplacé dans le backoffice SaaS (super-admin uniquement).
              Voir Tâche #52 — Admin Backoffice + Müşteri Sadeleştirme. */}
          {user?.role === "super_admin" && (
            <MenuItem icon="trending-up" label="Prospects" sublabel="Backoffice SaaS — leads commerciaux" color="#8b5cf6" onPress={() => nav("/prospects")} />
          )}
          <MenuItem icon="edit-2" label="Notes internes" sublabel="Mémos colorés et mémorisation" color="#f59e0b" onPress={() => nav("/notes-internes")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>DOCUMENTS</Text>
          <MenuItem icon="folder" label="Documents" sublabel="Fichiers, contrats et pièces jointes" color="#0f766e" onPress={() => nav("/documents")} />
          <MenuItem icon="book-open" label="Base de connaissances" sublabel="Questions-réponses IA fondées sur vos documents" color="#0ea5e9" onPress={() => nav("/knowledge-base")} />
          <MenuItem icon="upload" label="Importer des Documents" sublabel="Upload PDF, images, Word, Excel" color="#0f766e" onPress={() => nav("/document-import")} />
          <MenuItem icon="credit-card" label="Dépenses" sublabel="Photographier un reçu, valider la file et le registre" color="#0d9488" onPress={() => nav("/depenses")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>RAPPORTS</Text>
          <MenuItem icon="sun" label="Mon Bilan du Jour" sublabel="Resume IA de votre journee + recommandations" color="#f59e0b" onPress={() => nav("/daily-digest")} />
          <MenuItem icon="cpu" label="Agent IA Equipe" sublabel="Ajan IA otonom · 4 phases Gemini · Auto-apprentissage" color="#7c3aed" onPress={() => nav("/workforce-agent")} />
          <MenuItem icon="users" label="Intelligence Equipe" sublabel="Suivi IA continu de tous les collaborateurs" color="#6366f1" onPress={() => nav("/workforce-intelligence")} />
          <MenuItem icon="bar-chart-2" label="Performance Équipe" sublabel="Métriques et rapport IA par employé" color="#0f4c81" onPress={() => nav("/performance")} />
          <MenuItem icon="award" label="Rapport Exécutif" sublabel="Score global + insights IA opérationnels" color="#1e293b" onPress={() => nav("/rapport-executif")} />
          <MenuItem icon="file-text" label="Rapports & Tickets" sublabel="Signalements et demandes d'assistance" color="#7c3aed" onPress={() => nav("/reports")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>OUTILS</Text>
          <MenuItem icon="search" label="Recherche Globale" sublabel="Cherchez dans contacts, devis, tâches…" color="#1e293b" onPress={() => nav("/recherche")} />
          <MenuItem icon="globe" label="Recherche Web" sublabel="Web sécurisé : liens analysés par l'antivirus" color="#0ea5e9" onPress={() => nav("/recherche-web")} />
          <MenuItem icon="activity" label="Activité Récente" sublabel="Flux en temps réel de toutes les actions" color="#0f172a" onPress={() => nav("/activite-recente")} />
          <MenuItem icon="bar-chart-2" label="Analytique" sublabel="Rapports et statistiques" color="#f59e0b" onPress={() => nav("/analytics")} />
          <MenuItem icon="calendar" label="Calendrier" sublabel="Evenements et rendez-vous" color="#ec4899" onPress={() => nav("/calendar")} />
          <MenuItem icon="bell" label="Rappels" sublabel="Buzz calendrier des dernieres 24h" color="#3b82f6" onPress={() => nav("/rappels")} />
          <MenuItem icon="folder" label="Projets" sublabel="Gestion de portefeuille projets" color="#6366f1" onPress={() => nav("/projets")} />
          <MenuItem icon="clock" label="Pointage" sublabel="Gestion de presence" color="#14b8a6" onPress={() => nav("/checkins")} />
          <MenuItem icon="users" label="Réunion IA" sublabel="Compiler, taches & chantier GPS" color="#8b5cf6" onPress={() => nav("/meetings")} />
        </View>

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>INTELLIGENCE ARTIFICIELLE</Text>
          <MenuItem icon="mail" label="Gmail Agent" sublabel="Boîte mail, réponses et envoi IA" color="#dc2626" onPress={() => nav("/gmail-agent")} />
          <MenuItem icon="file-text" label="Document IA" sublabel="Analyse intelligente de documents" color="#7c3aed" onPress={() => nav("/document-ai")} />
          <MenuItem icon="cpu" label="AI Commandant" sublabel="Briefing quotidien, email IA, finance" color="#7c3aed" onPress={() => nav("/commandant-ia")} />
          <MenuItem icon="phone-call" label="Assistant IA Appels" sublabel="Préparer, scripter et compiler vos appels" color="#166534" onPress={() => nav("/call-assistant")} />
          <MenuItem icon="activity" label="Super Agent IA" sublabel="Agent otonom : email, chantier, système" color="#0f172a" onPress={() => nav("/super-agent")} />
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
            <MenuItem icon="monitor" label="Logiciels" sublabel="Catalogue et connexions SaaS" color="#0891b2" onPress={() => nav("/integrations")} />
            <MenuItem icon="globe" label="Google Workspace" sublabel="Gmail, Drive, Agenda, Meet" color="#4285f4" onPress={() => nav("/google-workspace")} />
            <MenuItem icon="clock" label="Horaires d'ouverture" sublabel="Jours, heures et fuseau horaire des rendez-vous" color="#6366f1" onPress={() => nav("/horaires-ouverture")} />
            <MenuItem icon="key" label="Licences & Facturation" sublabel="Tableau de bord licences et paiements" color="#166534" onPress={() => nav("/license-management")} />
            {user?.role === "super_admin" ? (
              <MenuItem icon="home" label="Organisations" sublabel="Gestion des licences" color="#f59e0b" onPress={() => nav("/organisations")} />
            ) : null}
          </View>
        ) : null}

        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>COMPTE</Text>
          <MenuItem icon="settings" label="Parametres" sublabel="Profil et abonnement" color="#64748b" onPress={() => nav("/settings")} />
          <MenuItem icon="credit-card" label="Mon Abonnement" sublabel="Plan, licences et facturation" color="#7c3aed" onPress={() => nav("/abonnement")} />
          <MenuItem icon="log-out" label="Se deconnecter" onPress={handleLogout} danger />
        </View>

        <Text style={[styles.version, { color: colors.mutedForeground }]}>
          Ajant Bureau v1.0.0
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
