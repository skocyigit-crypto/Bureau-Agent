import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { trackScanResult } from "@/lib/scan-result";
import { useColors } from "@/hooks/useColors";

interface GWApp {
  id: string;
  name: string;
  description: string;
  icon: string;
  url: string;
  category: string;
  connected: boolean;
  badge?: string;
}

interface GWHub {
  authenticated: boolean;
  userEmail?: string;
  apps: GWApp[];
  categories: string[];
}

interface GWEmail {
  id: string;
  from: string;
  subject: string;
  date: string;
  read: boolean;
}

interface GWEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: number;
  location?: string;
}

interface GWFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink?: string;
}

const ICON_MAP: Record<string, keyof typeof Feather.glyphMap> = {
  mail: "mail", calendar: "calendar", "hard-drive": "hard-drive",
  "file-text": "file-text", table: "grid", presentation: "monitor",
  users: "users", "check-square": "check-square", "sticky-note": "file",
  video: "video", image: "image", "play-circle": "play-circle",
  "message-circle": "message-circle", "clipboard-list": "list",
};

const CATEGORY_COLORS: Record<string, string> = {
  communication: "#3b82f6", productivite: "#8b5cf6", stockage: "#22c55e",
  collaboration: "#f59e0b", administration: "#ef4444",
};

function fmtDate(s: string) {
  if (!s) return "";
  const d = new Date(s);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 86400000 && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

type Tab = "apps" | "emails" | "events" | "files";

export default function GoogleWorkspaceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [hub, setHub] = useState<GWHub | null>(null);
  const [emails, setEmails] = useState<GWEmail[]>([]);
  const [events, setEvents] = useState<GWEvent[]>([]);
  const [files, setFiles] = useState<GWFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("apps");
  const [activeCategory, setActiveCategory] = useState("all");
  const [tabLoading, setTabLoading] = useState(false);
  const [importingFile, setImportingFile] = useState<string | null>(null);

  const handleImportFile = useCallback(async (file: GWFile) => {
    if (!file?.id) return;
    setImportingFile(file.id);
    try {
      const res = await fetchAuth(`${API_BASE}/api/google-workspace/drive-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: file.id }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const d = await res.json(); msg = d?.error || msg; } catch {}
        throw new Error(msg);
      }
      let docId: number | string | undefined;
      try { const d = await res.json(); docId = d?.document?.id; } catch {}
      Alert.alert("Importé dans Documents", `${file.name} — analyse antivirus en cours.`);
      if (docId != null) void trackScanResult(fetchAuth, docId, file.name);
    } catch (e: any) {
      Alert.alert("Échec de l'import", e?.message || "Réessayez.");
    } finally {
      setImportingFile(null);
    }
  }, [fetchAuth]);

  const loadHub = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/google-workspace/hub`);
      if (res.ok) {
        const d = await res.json();
        setHub(d);
        return d;
      }
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
    return null;
  }, [fetchAuth]);

  const loadTabData = useCallback(async (t: Tab, authenticated: boolean) => {
    if (!authenticated) return;
    setTabLoading(true);
    try {
      if (t === "emails") {
        const r = await fetchAuth(`${API_BASE}/api/google-workspace/recent-emails`);
        if (r.ok) setEmails((await r.json()).emails ?? []);
      } else if (t === "events") {
        const r = await fetchAuth(`${API_BASE}/api/google-workspace/upcoming-events`);
        if (r.ok) setEvents((await r.json()).events ?? []);
      } else if (t === "files") {
        const r = await fetchAuth(`${API_BASE}/api/google-workspace/recent-files`);
        if (r.ok) setFiles((await r.json()).files ?? []);
      }
    } catch {} finally { setTabLoading(false); }
  }, [fetchAuth]);

  useEffect(() => {
    loadHub().then(d => { if (d?.authenticated) loadTabData("apps", true); });
  }, []);

  useEffect(() => {
    if (hub?.authenticated) loadTabData(tab, true);
  }, [tab, hub?.authenticated]);

  function onRefresh() {
    setRefreshing(true);
    loadHub().then(d => { if (d?.authenticated) loadTabData(tab, true); });
  }

  function openUrl(url: string) {
    if (url) Linking.openURL(url).catch(() => {});
  }

  const filteredApps = (hub?.apps ?? []).filter(a =>
    activeCategory === "all" || a.category === activeCategory
  );

  const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: "apps", label: "Applications", icon: "grid" },
    { key: "emails", label: "Emails", icon: "mail" },
    { key: "events", label: "Agenda", icon: "calendar" },
    { key: "files", label: "Drive", icon: "hard-drive" },
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Google Workspace</Text>
            {hub?.userEmail && <Text style={styles.headerSub}>{hub.userEmail}</Text>}
          </View>
          <View style={[styles.statusDot, { backgroundColor: hub?.authenticated ? "#22c55e" : "#ef4444" }]} />
        </View>

        {/* Tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 4 }}>
          <View style={styles.tabRow}>
            {TABS.map(t => (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                style={[styles.tabChip, { backgroundColor: tab === t.key ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)" }]}
              >
                <Feather name={t.icon} size={13} color="#fff" />
                <Text style={styles.tabChipText}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4285f4" />
        </View>
      ) : !hub?.authenticated ? (
        <View style={styles.notConnected}>
          <View style={[styles.notConnectedIcon, { backgroundColor: "#dbeafe" }]}>
            <Feather name="globe" size={32} color="#4285f4" />
          </View>
          <Text style={[styles.notConnectedTitle, { color: colors.foreground }]}>Google Workspace non connecté</Text>
          <Text style={[styles.notConnectedSub, { color: colors.mutedForeground }]}>
            Connectez votre compte Google pour accéder à Gmail, Google Drive, Agenda et plus encore.
          </Text>
          <Pressable onPress={() => router.push("/integrations" as any)} style={styles.connectBtn}>
            <Feather name="link" size={16} color="#fff" />
            <Text style={styles.connectBtnText}>Connecter Google</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4285f4" />}
        >
          {/* Stats */}
          <View style={styles.statsRow}>
            {[
              { label: "Apps", value: hub.apps.length, color: "#4285f4" },
              { label: "Connectées", value: hub.apps.filter(a => a.connected).length, color: "#22c55e" },
              { label: "Disponibles", value: hub.apps.filter(a => !a.connected).length, color: "#f59e0b" },
            ].map(s => (
              <View key={s.label} style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.statNum, { color: s.color }]}>{s.value}</Text>
                <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* APPS TAB */}
          {tab === "apps" && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: "row", gap: 6, paddingBottom: 2 }}>
                  {["all", ...(hub.categories ?? [])].map(c => (
                    <Pressable
                      key={c}
                      onPress={() => setActiveCategory(c)}
                      style={[styles.categoryChip, {
                        backgroundColor: activeCategory === c ? "#4285f4" : colors.card,
                        borderColor: activeCategory === c ? "#4285f4" : colors.border,
                      }]}
                    >
                      <Text style={[styles.categoryChipText, { color: activeCategory === c ? "#fff" : colors.foreground }]}>
                        {c === "all" ? "Tout" : c}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <View style={styles.appsGrid}>
                {filteredApps.map(app => (
                  <Pressable
                    key={app.id}
                    onPress={() => openUrl(app.url)}
                    style={[styles.appCard, { backgroundColor: colors.card, borderColor: app.connected ? "#4285f4" : colors.border }]}
                  >
                    <View style={[styles.appIconBox, { backgroundColor: "#eff6ff" }]}>
                      <Feather name={ICON_MAP[app.icon] ?? "grid"} size={18} color="#4285f4" />
                    </View>
                    <Text style={[styles.appName, { color: colors.foreground }]} numberOfLines={1}>{app.name}</Text>
                    <Text style={[styles.appDesc, { color: colors.mutedForeground }]} numberOfLines={2}>{app.description}</Text>
                    {app.connected ? (
                      <View style={styles.connectedBadge}>
                        <Feather name="check" size={10} color="#22c55e" />
                        <Text style={styles.connectedText}>Connecté</Text>
                      </View>
                    ) : (
                      <View style={styles.disconnectedBadge}>
                        <Text style={styles.disconnectedText}>Disponible</Text>
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* EMAILS TAB */}
          {tab === "emails" && (
            tabLoading ? <ActivityIndicator color="#4285f4" style={{ marginTop: 24 }} /> :
            emails.length === 0 ? <EmptyState icon="mail" title="Aucun email" subtitle="Vos emails récents apparaîtront ici." /> :
            emails.map(e => (
              <Pressable
                key={e.id}
                onPress={() => router.push("/gmail-agent" as any)}
                style={[styles.emailRow, { backgroundColor: colors.card, borderColor: colors.border, borderLeftWidth: e.read ? 1 : 3, borderLeftColor: e.read ? colors.border : "#ea4335" }]}
              >
                <View style={[styles.emailAvatar, { backgroundColor: "#ea4335" }]}>
                  <Text style={styles.emailAvatarText}>{e.from[0]?.toUpperCase() ?? "?"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={[styles.emailFrom, { color: colors.foreground, fontFamily: e.read ? "Inter_400Regular" : "Inter_700Bold" }]} numberOfLines={1}>{e.from}</Text>
                    <Text style={[styles.emailDate, { color: colors.mutedForeground }]}>{fmtDate(e.date)}</Text>
                  </View>
                  <Text style={[styles.emailSubject, { color: colors.foreground }]} numberOfLines={1}>{e.subject}</Text>
                </View>
              </Pressable>
            ))
          )}

          {/* EVENTS TAB */}
          {tab === "events" && (
            tabLoading ? <ActivityIndicator color="#4285f4" style={{ marginTop: 24 }} /> :
            events.length === 0 ? <EmptyState icon="calendar" title="Aucun événement" subtitle="Vos prochains événements apparaîtront ici." /> :
            events.map(e => (
              <View key={e.id} style={[styles.eventCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[styles.eventDate, { backgroundColor: "#eff6ff" }]}>
                  <Text style={[styles.eventDay, { color: "#4285f4" }]}>{new Date(e.start).getDate()}</Text>
                  <Text style={[styles.eventMonth, { color: "#4285f4" }]}>{new Date(e.start).toLocaleDateString("fr-FR", { month: "short" })}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.eventTitle, { color: colors.foreground }]} numberOfLines={1}>{e.title}</Text>
                  <Text style={[styles.eventTime, { color: colors.mutedForeground }]}>
                    {new Date(e.start).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                    {e.end ? ` → ${new Date(e.end).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
                  </Text>
                  {e.location && <Text style={[styles.eventLoc, { color: colors.mutedForeground }]} numberOfLines={1}>{e.location}</Text>}
                  {e.attendees > 0 && (
                    <View style={styles.eventAttendees}>
                      <Feather name="users" size={10} color={colors.mutedForeground} />
                      <Text style={[styles.eventAttendeesText, { color: colors.mutedForeground }]}>{e.attendees} participant{e.attendees > 1 ? "s" : ""}</Text>
                    </View>
                  )}
                </View>
              </View>
            ))
          )}

          {/* FILES TAB */}
          {tab === "files" && (
            tabLoading ? <ActivityIndicator color="#4285f4" style={{ marginTop: 24 }} /> :
            files.length === 0 ? <EmptyState icon="hard-drive" title="Aucun fichier" subtitle="Vos fichiers Google Drive récents apparaîtront ici." /> :
            files.map(f => {
              const isFolder = f.mimeType === "application/vnd.google-apps.folder";
              return (
                <Pressable
                  key={f.id}
                  onPress={() => f.webViewLink && openUrl(f.webViewLink)}
                  style={[styles.fileRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.fileIcon, { backgroundColor: "#eff6ff" }]}>
                    <Feather name={isFolder ? "folder" : "file-text"} size={16} color="#4285f4" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fileName, { color: colors.foreground }]} numberOfLines={1}>{f.name}</Text>
                    <Text style={[styles.fileDate, { color: colors.mutedForeground }]}>Modifié {fmtDate(f.modifiedTime)}</Text>
                  </View>
                  {!isFolder && (
                    <Pressable
                      onPress={() => handleImportFile(f)}
                      disabled={importingFile === f.id}
                      style={[styles.importBtn, { backgroundColor: "#6366f115", opacity: importingFile === f.id ? 0.6 : 1 }]}
                    >
                      {importingFile === f.id
                        ? <ActivityIndicator size="small" color="#6366f1" />
                        : <Feather name="folder-plus" size={14} color="#6366f1" />}
                      <Text style={styles.importBtnText}>Documents</Text>
                    </Pressable>
                  )}
                  {f.webViewLink && <Feather name="external-link" size={14} color={colors.mutedForeground} />}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { backgroundColor: "#4285f4", paddingHorizontal: 20, paddingBottom: 12, gap: 8 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.75)" },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  tabRow: { flexDirection: "row", gap: 6 },
  tabChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20 },
  tabChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#fff" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  notConnected: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 14 },
  notConnectedIcon: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  notConnectedTitle: { fontSize: 18, fontFamily: "Inter_700Bold", textAlign: "center" },
  notConnectedSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, maxWidth: 300 },
  connectBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#4285f4", paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, marginTop: 4 },
  connectBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  content: { padding: 16, gap: 10 },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12, borderWidth: 1 },
  statNum: { fontSize: 20, fontFamily: "Inter_700Bold" },
  statLbl: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  categoryChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  appsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  appCard: { width: "47%", borderRadius: 14, borderWidth: 1, padding: 12, gap: 4 },
  appIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  appName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  appDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 15 },
  connectedBadge: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 4 },
  connectedText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: "#22c55e" },
  disconnectedBadge: { marginTop: 4 },
  disconnectedText: { fontSize: 10, fontFamily: "Inter_400Regular", color: "#94a3b8" },
  emailRow: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  emailAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  emailAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  emailFrom: { fontSize: 13, flex: 1, marginRight: 8 },
  emailDate: { fontSize: 11, fontFamily: "Inter_400Regular" },
  emailSubject: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  eventCard: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "flex-start" },
  eventDate: { width: 44, alignItems: "center", paddingVertical: 6, borderRadius: 10 },
  eventDay: { fontSize: 18, fontFamily: "Inter_700Bold" },
  eventMonth: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  eventTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  eventTime: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  eventLoc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  eventAttendees: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  eventAttendeesText: { fontSize: 10, fontFamily: "Inter_400Regular" },
  fileRow: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  fileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  fileName: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  fileDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  importBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
  importBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "#6366f1" },
});
