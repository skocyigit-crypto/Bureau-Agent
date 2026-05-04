import { Feather } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  tags?: string[] | null;
  createdAt: string;
}

interface Call {
  id: number;
  phoneNumber: string;
  status: string;
  direction: string;
  duration?: number;
  createdAt: string;
}

interface Task {
  id: number;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
}

interface Projet {
  id: number;
  title: string;
  status: string;
  progress: number;
  endDate?: string | null;
}

interface Devis {
  id: number;
  reference: string;
  title: string;
  status: string;
  totalAmount: string;
  createdAt: string;
}

type TabKey = "apercu" | "appels" | "taches" | "projets" | "devis";

const TABS: { key: TabKey; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { key: "apercu",  label: "Aperçu",  icon: "user" },
  { key: "appels",  label: "Appels",  icon: "phone" },
  { key: "taches",  label: "Tâches",  icon: "check-square" },
  { key: "projets", label: "Projets", icon: "folder" },
  { key: "devis",   label: "Devis",   icon: "file-text" },
];

const CALL_STATUS: Record<string, { label: string; color: string }> = {
  answered:   { label: "Répondu",      color: "#22c55e" },
  missed:     { label: "Manqué",       color: "#ef4444" },
  voicemail:  { label: "Messagerie",   color: "#f59e0b" },
  in_progress:{ label: "En cours",     color: "#3b82f6" },
};

const TASK_STATUS: Record<string, { label: string; color: string }> = {
  a_faire:     { label: "À faire",     color: "#64748b" },
  en_cours:    { label: "En cours",    color: "#3b82f6" },
  terminee:    { label: "Terminée",    color: "#22c55e" },
  annulee:     { label: "Annulée",     color: "#94a3b8" },
};

const PROJET_STATUS: Record<string, { label: string; color: string }> = {
  planifie:  { label: "Planifié",    color: "#6366f1" },
  en_cours:  { label: "En cours",   color: "#3b82f6" },
  en_pause:  { label: "En pause",   color: "#f59e0b" },
  termine:   { label: "Terminé",    color: "#22c55e" },
  annule:    { label: "Annulé",     color: "#94a3b8" },
};

const DEVIS_STATUS: Record<string, { label: string; color: string }> = {
  brouillon:  { label: "Brouillon",  color: "#64748b" },
  envoye:     { label: "Envoyé",     color: "#3b82f6" },
  accepte:    { label: "Accepté",    color: "#22c55e" },
  refuse:     { label: "Refusé",     color: "#ef4444" },
  expire:     { label: "Expiré",     color: "#94a3b8" },
};

const TAG_COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#0891b2"];
function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash + tag.charCodeAt(i)) % TAG_COLORS.length;
  return TAG_COLORS[hash];
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDuration(s?: number | null): string {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function initials(c: Contact): string {
  return `${(c.firstName[0] || "").toUpperCase()}${(c.lastName[0] || "").toUpperCase()}`;
}

export default function ContactDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [contact, setContact] = useState<Contact | null>(null);
  const [calls, setCalls] = useState<Call[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projets, setProjets] = useState<Projet[]>([]);
  const [devis, setDevis] = useState<Devis[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabKey>("apercu");

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [cRes, callRes, taskRes, projRes, devisRes] = await Promise.all([
        fetchAuth(`${API_BASE}/api/contacts/${id}`),
        fetchAuth(`${API_BASE}/api/contacts/${id}/calls`),
        fetchAuth(`${API_BASE}/api/contacts/${id}/tasks`),
        fetchAuth(`${API_BASE}/api/contacts/${id}/projets`),
        fetchAuth(`${API_BASE}/api/contacts/${id}/devis`),
      ]);
      if (cRes.ok) setContact(await cRes.json());
      if (callRes.ok) { const d = await callRes.json(); setCalls(d.calls ?? d ?? []); }
      if (taskRes.ok) { const d = await taskRes.json(); setTasks(d.tasks ?? d ?? []); }
      if (projRes.ok) { const d = await projRes.json(); setProjets(d.projets ?? d ?? []); }
      if (devisRes.ok) { const d = await devisRes.json(); setDevis(d.devis ?? d.data ?? d ?? []); }
    } catch {} finally { setLoading(false); }
  }, [id, fetchAuth]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerTop}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            <Text style={styles.headerTitle}>Fiche contact</Text>
          </View>
        </View>
        <View style={styles.loadingBox}><ActivityIndicator size="large" color="#0369a1" /></View>
      </View>
    );
  }

  if (!contact) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
          <View style={styles.headerTop}>
            <Pressable onPress={() => router.back()} style={styles.backBtn}>
              <Feather name="arrow-left" size={20} color="#fff" />
            </Pressable>
            <Text style={styles.headerTitle}>Contact introuvable</Text>
          </View>
        </View>
        <View style={styles.loadingBox}>
          <Feather name="user-x" size={48} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>Contact introuvable</Text>
        </View>
      </View>
    );
  }

  const avatarBg = ["#6366f1", "#ec4899", "#f59e0b", "#22c55e", "#0891b2"][contact.id % 5];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>{contact.firstName} {contact.lastName}</Text>
        </View>

        {/* Avatar + quick actions */}
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
            <Text style={styles.avatarText}>{initials(contact)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{contact.firstName} {contact.lastName}</Text>
            {contact.company && <Text style={styles.profileCompany}>{contact.company}</Text>}
            {contact.tags && contact.tags.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                {contact.tags.slice(0, 4).map(t => (
                  <View key={t} style={[styles.tagPill, { backgroundColor: tagColor(t) + "30" }]}>
                    <Text style={[styles.tagText, { color: tagColor(t) }]}>{t}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
          <View style={{ gap: 8 }}>
            {contact.phone && (
              <Pressable
                onPress={() => Linking.openURL(`tel:${contact.phone}`)}
                style={[styles.actionBtn, { backgroundColor: "#22c55e" }]}
              >
                <Feather name="phone" size={16} color="#fff" />
              </Pressable>
            )}
            {contact.email && (
              <Pressable
                onPress={() => Linking.openURL(`mailto:${contact.email}`)}
                style={[styles.actionBtn, { backgroundColor: "#3b82f6" }]}
              >
                <Feather name="mail" size={16} color="#fff" />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {/* Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
        contentContainerStyle={{ paddingHorizontal: 4 }}
      >
        {TABS.map(t => (
          <Pressable
            key={t.key}
            onPress={() => setActiveTab(t.key)}
            style={[styles.tab, activeTab === t.key && { borderBottomColor: "#0369a1", borderBottomWidth: 2 }]}
          >
            <Feather name={t.icon} size={12} color={activeTab === t.key ? "#0369a1" : colors.mutedForeground} />
            <Text style={[styles.tabText, { color: activeTab === t.key ? "#0369a1" : colors.mutedForeground }]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 40 : 20 }]}>
        {/* Aperçu */}
        {activeTab === "apercu" && (
          <View style={{ gap: 12 }}>
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Coordonnées</Text>
              {contact.phone && (
                <Pressable onPress={() => Linking.openURL(`tel:${contact.phone}`)} style={styles.infoRow}>
                  <Feather name="phone" size={14} color="#0369a1" />
                  <Text style={[styles.infoText, { color: "#0369a1" }]}>{contact.phone}</Text>
                </Pressable>
              )}
              {contact.email && (
                <Pressable onPress={() => Linking.openURL(`mailto:${contact.email}`)} style={styles.infoRow}>
                  <Feather name="mail" size={14} color="#0369a1" />
                  <Text style={[styles.infoText, { color: "#0369a1" }]}>{contact.email}</Text>
                </Pressable>
              )}
              {contact.company && (
                <View style={styles.infoRow}>
                  <Feather name="briefcase" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: colors.foreground }]}>{contact.company}</Text>
                </View>
              )}
              {contact.address && (
                <View style={styles.infoRow}>
                  <Feather name="map-pin" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.infoText, { color: colors.foreground }]}>{contact.address}</Text>
                </View>
              )}
              <View style={styles.infoRow}>
                <Feather name="calendar" size={14} color={colors.mutedForeground} />
                <Text style={[styles.infoText, { color: colors.mutedForeground }]}>Ajouté le {fmtDate(contact.createdAt)}</Text>
              </View>
            </View>

            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Activité résumée</Text>
              <View style={styles.statGrid}>
                {[
                  { label: "Appels", value: calls.length, icon: "phone" as const, color: "#0369a1" },
                  { label: "Tâches", value: tasks.length, icon: "check-square" as const, color: "#7c3aed" },
                  { label: "Projets", value: projets.length, icon: "folder" as const, color: "#0891b2" },
                  { label: "Devis", value: devis.length, icon: "file-text" as const, color: "#16a34a" },
                ].map(s => (
                  <View key={s.label} style={[styles.statCard, { backgroundColor: s.color + "12" }]}>
                    <Feather name={s.icon} size={18} color={s.color} />
                    <Text style={[styles.statNum, { color: s.color }]}>{s.value}</Text>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        )}

        {/* Appels */}
        {activeTab === "appels" && (
          <View style={{ gap: 8 }}>
            {calls.length === 0 ? (
              <View style={styles.emptyTab}>
                <Feather name="phone-off" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun appel enregistré</Text>
              </View>
            ) : calls.map(c => {
              const st = CALL_STATUS[c.status] ?? { label: c.status, color: "#64748b" };
              return (
                <View key={c.id} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Feather name={c.direction === "outbound" ? "phone-outgoing" : "phone-incoming"} size={14} color={st.color} />
                    <Text style={[styles.itemTitle, { color: colors.foreground }]}>{c.phoneNumber}</Text>
                    <View style={{ flex: 1 }} />
                    <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                      <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
                    <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{fmtDate(c.createdAt)}</Text>
                    <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>Durée : {fmtDuration(c.duration)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Tâches */}
        {activeTab === "taches" && (
          <View style={{ gap: 8 }}>
            {tasks.length === 0 ? (
              <View style={styles.emptyTab}>
                <Feather name="check-square" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucune tâche associée</Text>
              </View>
            ) : tasks.map(t => {
              const st = TASK_STATUS[t.status] ?? { label: t.status, color: "#64748b" };
              const overdue = t.dueDate && new Date(t.dueDate) < new Date() && t.status !== "terminee";
              return (
                <View key={t.id} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: st.color }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[styles.itemTitle, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>{t.title}</Text>
                    <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                      <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  {t.dueDate && (
                    <Text style={[styles.itemMeta, { color: overdue ? "#ef4444" : colors.mutedForeground, marginTop: 4 }]}>
                      Échéance : {fmtDate(t.dueDate)}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Projets */}
        {activeTab === "projets" && (
          <View style={{ gap: 8 }}>
            {projets.length === 0 ? (
              <View style={styles.emptyTab}>
                <Feather name="folder" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun projet associé</Text>
              </View>
            ) : projets.map(p => {
              const st = PROJET_STATUS[p.status] ?? { label: p.status, color: "#64748b" };
              return (
                <View key={p.id} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={[styles.itemTitle, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>{p.title}</Text>
                    <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                      <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                    </View>
                  </View>
                  <View style={{ marginTop: 8 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                      <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>Avancement</Text>
                      <Text style={[styles.itemMeta, { color: st.color }]}>{p.progress}%</Text>
                    </View>
                    <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
                      <View style={[styles.progressFill, { width: `${p.progress}%` as any, backgroundColor: st.color }]} />
                    </View>
                  </View>
                  {p.endDate && (
                    <Text style={[styles.itemMeta, { color: colors.mutedForeground, marginTop: 4 }]}>Fin : {fmtDate(p.endDate)}</Text>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Devis */}
        {activeTab === "devis" && (
          <View style={{ gap: 8 }}>
            {devis.length === 0 ? (
              <View style={styles.emptyTab}>
                <Feather name="file-text" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun devis associé</Text>
              </View>
            ) : devis.map(d => {
              const st = DEVIS_STATUS[d.status] ?? { label: d.status, color: "#64748b" };
              return (
                <View key={d.id} style={[styles.itemCard, { backgroundColor: colors.card, borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: st.color }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemMeta, { color: colors.mutedForeground }]}>{d.reference}</Text>
                      <Text style={[styles.itemTitle, { color: colors.foreground }]} numberOfLines={1}>{d.title}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={[styles.itemTitle, { color: st.color }]}>
                        {new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(parseFloat(d.totalAmount || "0"))}
                      </Text>
                      <View style={[styles.miniPill, { backgroundColor: st.color + "20" }]}>
                        <Text style={[styles.miniPillText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                  </View>
                  <Text style={[styles.itemMeta, { color: colors.mutedForeground, marginTop: 4 }]}>{fmtDate(d.createdAt)}</Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#0369a1", paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  profileRow: { flexDirection: "row", alignItems: "flex-start", gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  profileName: { fontSize: 18, fontFamily: "Inter_700Bold", color: "#fff" },
  profileCompany: { fontSize: 13, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)" },
  tagPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  actionBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  tabBar: { borderBottomWidth: 1, maxHeight: 48 },
  tab: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 12 },
  tabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { padding: 12, gap: 12 },
  section: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold", marginBottom: 2 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoText: { fontSize: 14, fontFamily: "Inter_400Regular", flex: 1 },
  statGrid: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, borderRadius: 10, padding: 10, alignItems: "center", gap: 4 },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular" },
  itemCard: { borderRadius: 10, borderWidth: 1, padding: 12 },
  itemTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  itemMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  miniPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  miniPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  progressBar: { height: 4, borderRadius: 2, marginTop: 4, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  emptyTab: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
