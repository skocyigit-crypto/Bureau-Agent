import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface ActivityItem {
  type: string;
  title: string;
  subtitle?: string;
  amount?: string | number;
  status?: string;
  createdAt: string;
}

const ENTITY_CFG: Record<string, { icon: keyof typeof Feather.glyphMap; color: string; label: string }> = {
  devis:    { icon: "file-text",    color: "#3b82f6", label: "Devis"           },
  facture:  { icon: "dollar-sign",  color: "#22c55e", label: "Facture"         },
  prospect: { icon: "trending-up",  color: "#f59e0b", label: "Prospect"        },
  commande: { icon: "shopping-cart",color: "#8b5cf6", label: "Bon de Commande" },
  contact:  { icon: "user",         color: "#0ea5e9", label: "Contact"         },
  appel:    { icon: "phone",        color: "#22c55e", label: "Appel"           },
  tache:    { icon: "check-square", color: "#f97316", label: "Tâche"           },
  message:  { icon: "message-square",color:"#a855f7", label: "Message"         },
  projet:   { icon: "folder",       color: "#6366f1", label: "Projet"          },
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const diff = Math.floor((now - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return "À l'instant";
  if (diff < 3600) return `Il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `Il y a ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `Il y a ${Math.floor(diff / 86400)} j`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function groupByDate(items: ActivityItem[]): { date: string; items: ActivityItem[] }[] {
  const map: Record<string, ActivityItem[]> = {};
  for (const item of items) {
    const d = new Date(item.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    let label: string;
    if (d.toDateString() === today.toDateString()) label = "Aujourd'hui";
    else if (d.toDateString() === yesterday.toDateString()) label = "Hier";
    else label = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (!map[label]) map[label] = [];
    map[label].push(item);
  }
  return Object.entries(map).map(([date, items]) => ({ date, items }));
}

const DAYS_OPTIONS = [
  { val: 1,  label: "24h"    },
  { val: 7,  label: "7 jours" },
  { val: 30, label: "30 jours"},
];

function ActivityRow({ item, colors }: { item: ActivityItem; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const cfg = ENTITY_CFG[item.type] ?? { icon: "activity" as const, color: "#6b7280", label: item.type };
  const hasAmount = item.amount !== undefined && item.amount !== null && item.amount !== 0 && item.amount !== "0";

  return (
    <View style={[styles.actRow, { borderColor: colors.border }]}>
      <View style={styles.actLeft}>
        <View style={[styles.actIcon, { backgroundColor: cfg.color + "18" }]}>
          <Feather name={cfg.icon} size={14} color={cfg.color} />
        </View>
        <View style={[styles.actLine, { backgroundColor: colors.border }]} />
      </View>
      <View style={[styles.actContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.actHeader}>
          <View style={[styles.typePill, { backgroundColor: cfg.color + "18" }]}>
            <Text style={[styles.typeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
          <Text style={[styles.actTime, { color: colors.mutedForeground }]}>{relativeTime(item.createdAt)}</Text>
        </View>
        <Text style={[styles.actTitle, { color: colors.foreground }]} numberOfLines={1}>{item.title}</Text>
        {item.subtitle && (
          <Text style={[styles.actSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>{item.subtitle}</Text>
        )}
        {(hasAmount || item.status) && (
          <View style={styles.actFooter}>
            {hasAmount && (
              <Text style={[styles.actAmount, { color: "#22c55e" }]}>
                {Number(item.amount).toLocaleString("fr-FR")} €
              </Text>
            )}
            {item.status && (
              <View style={[styles.statusPill, { backgroundColor: colors.background }]}>
                <Text style={[styles.statusText, { color: colors.mutedForeground }]}>{item.status}</Text>
              </View>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

type FlatItem = { kind: "header"; date: string } | { kind: "item"; data: ActivityItem };

export default function ActiviteRecenteScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [days, setDays] = useState(7);
  const [typeFilter, setTypeFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const [devisR, facturesR, prospectsR, commandesR, contactsR, callsR, tasksR, messagesR, projetsR] = await Promise.all([
        fetchAuth(`${API_BASE}/api/devis?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/factures-client?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/prospects?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/commandes-fournisseur?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/contacts?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/calls?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/tasks?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/messages?limit=30&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetchAuth(`${API_BASE}/api/projets?limit=20&sortBy=createdAt&sortOrder=desc`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const items: ActivityItem[] = [];

      (devisR?.data || []).forEach((d: any) => items.push({
        type: "devis", title: d.reference || `Devis #${d.id}`, subtitle: d.clientName,
        amount: d.totalAmount, status: d.status, createdAt: d.createdAt,
      }));
      (facturesR?.data || []).forEach((f: any) => items.push({
        type: "facture", title: f.reference || `Facture #${f.id}`, subtitle: f.clientName,
        amount: f.totalAmount, status: f.status, createdAt: f.createdAt,
      }));
      (prospectsR?.prospects || []).forEach((p: any) => items.push({
        type: "prospect", title: p.title, subtitle: p.company || p.contactName,
        amount: p.value, status: p.stage, createdAt: p.createdAt,
      }));
      (commandesR?.data || []).forEach((c: any) => items.push({
        type: "commande", title: c.reference || `BC #${c.id}`, subtitle: c.fournisseurName,
        amount: c.totalAmount, status: c.status, createdAt: c.createdAt,
      }));
      (contactsR?.contacts || []).forEach((c: any) => items.push({
        type: "contact", title: `${c.firstName} ${c.lastName}`.trim(), subtitle: c.company || c.email,
        createdAt: c.createdAt,
      }));
      (callsR?.calls || callsR?.data || []).forEach((c: any) => items.push({
        type: "appel", title: c.contactName || c.phoneNumber || "Appel",
        subtitle: c.direction === "entrant" ? "Appel entrant" : "Appel sortant",
        status: c.status, createdAt: c.createdAt,
      }));
      (tasksR?.tasks || tasksR?.data || []).forEach((t: any) => items.push({
        type: "tache", title: t.title, subtitle: t.assignedTo || t.priority,
        status: t.status, createdAt: t.createdAt,
      }));
      (messagesR?.messages || messagesR?.data || []).forEach((m: any) => items.push({
        type: "message", title: m.subject || (m.content || "").slice(0, 60) || "Message",
        subtitle: m.fromName || m.from, status: m.isRead ? "lu" : "non_lu", createdAt: m.createdAt,
      }));
      (projetsR?.projets || []).forEach((p: any) => items.push({
        type: "projet", title: p.title, subtitle: p.clientName || p.clientCompany,
        status: p.status, createdAt: p.createdAt,
      }));

      items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const cutoff = Date.now() - days * 86400000;
      setActivities(items.filter(i => new Date(i.createdAt).getTime() > cutoff).slice(0, 150));
    } catch {} finally { setLoading(false); setRefreshing(false); }
  }, [fetchAuth, days]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  function onRefresh() { setRefreshing(true); load(); }

  const filtered = typeFilter === "all" ? activities : activities.filter(a => a.type === typeFilter);
  const grouped = groupByDate(filtered);

  // Flatten for FlatList
  const flatData: FlatItem[] = [];
  for (const g of grouped) {
    flatData.push({ kind: "header", date: g.date });
    for (const item of g.items) flatData.push({ kind: "item", data: item });
  }

  const typeFilters = [
    { key: "all",     label: "Tout"     },
    { key: "appel",   label: "Appels"   },
    { key: "tache",   label: "Tâches"   },
    { key: "prospect",label: "Prospects"},
    { key: "devis",   label: "Devis"    },
    { key: "facture", label: "Factures" },
    { key: "projet",  label: "Projets"  },
    { key: "contact", label: "Contacts" },
    { key: "message", label: "Messages" },
    { key: "commande",label: "Commandes"},
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#0f172a", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Activité Récente</Text>
            {!loading && <Text style={styles.headerSub}>{filtered.length} événement{filtered.length !== 1 ? "s" : ""}</Text>}
          </View>
          <Pressable onPress={onRefresh} style={styles.backBtn}>
            <Feather name="refresh-cw" size={18} color="rgba(255,255,255,0.8)" />
          </Pressable>
        </View>

        <View style={styles.periodRow}>
          {DAYS_OPTIONS.map(p => (
            <Pressable
              key={p.val}
              onPress={() => setDays(p.val)}
              style={[styles.periodChip, { backgroundColor: days === p.val ? "#fff" : "rgba(255,255,255,0.15)" }]}
            >
              <Text style={[styles.periodText, { color: days === p.val ? "#0f172a" : "rgba(255,255,255,0.85)" }]}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Type filter horizontal scroll */}
      <View style={[styles.typeFilterBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <FlatList
          data={typeFilters}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={item => item.key}
          contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingVertical: 8 }}
          renderItem={({ item: f }) => {
            const cfg = ENTITY_CFG[f.key];
            const isActive = typeFilter === f.key;
            return (
              <Pressable
                onPress={() => setTypeFilter(f.key)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor: isActive ? (cfg?.color ?? "#1e293b") : colors.background,
                    borderColor: isActive ? (cfg?.color ?? "#1e293b") : colors.border,
                  },
                ]}
              >
                {cfg && <Feather name={cfg.icon} size={10} color={isActive ? "#fff" : cfg.color} />}
                <Text style={[styles.typeChipText, { color: isActive ? "#fff" : colors.foreground }]}>{f.label}</Text>
              </Pressable>
            );
          }}
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#0f172a" /></View>
      ) : (
        <FlatList
          data={flatData}
          keyExtractor={(item, i) => item.kind === "header" ? `h-${item.date}` : `i-${i}`}
          contentContainerStyle={[styles.listContent, { paddingBottom: 40 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0f172a" />}
          ListEmptyComponent={
            <EmptyState
              icon="activity"
              title="Aucune activité"
              subtitle="Il n'y a pas d'activité récente à afficher pour cette période."
            />
          }
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <View style={styles.dateHeader}>
                  <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
                  <View style={[styles.dateBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.dateText, { color: colors.mutedForeground }]}>{item.date}</Text>
                  </View>
                  <View style={[styles.dateLine, { backgroundColor: colors.border }]} />
                </View>
              );
            }
            return <ActivityRow item={item.data} colors={colors} />;
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 21, fontFamily: "Inter_700Bold", color: "#fff" },
  headerSub: { fontSize: 11, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.6)", marginTop: 1 },
  periodRow: { flexDirection: "row", gap: 8 },
  periodChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20 },
  periodText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  typeFilterBar: { borderBottomWidth: 1 },
  typeChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  typeChipText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: 16, paddingTop: 12 },
  dateHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, marginTop: 6 },
  dateLine: { flex: 1, height: 1 },
  dateBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  dateText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  actRow: { flexDirection: "row", gap: 10, marginBottom: 8 },
  actLeft: { alignItems: "center", width: 32 },
  actIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  actLine: { width: 1, flex: 1, marginTop: 4 },
  actContent: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 2 },
  actHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  typePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  typeText: { fontSize: 9, fontFamily: "Inter_600SemiBold" },
  actTime: { fontSize: 10, fontFamily: "Inter_400Regular" },
  actTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginBottom: 2 },
  actSubtitle: { fontSize: 11, fontFamily: "Inter_400Regular", marginBottom: 4 },
  actFooter: { flexDirection: "row", alignItems: "center", gap: 6 },
  actAmount: { fontSize: 12, fontFamily: "Inter_700Bold" },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 9, fontFamily: "Inter_400Regular" },
});
