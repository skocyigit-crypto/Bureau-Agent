import { Feather } from "@expo/vector-icons";
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
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type Tab = "briefing" | "search" | "email" | "taches" | "finance";

interface BriefingData {
  greeting?: string;
  summary?: string;
  weather?: { condition?: string; temperature?: number };
  stats?: {
    appelsAujourdhui?: number;
    tachesEnRetard?: number;
    facturesImpayees?: number;
    montantImpaye?: number;
    rendezVousAujourdhui?: number;
    projetsActifs?: number;
    projetsEnRetard?: number;
  };
  urgentItems?: Array<{ type: string; title: string; description?: string; id?: number }>;
  suggestions?: string[];
  reminders?: Array<{ type: string; title: string; dueDate?: string; priority?: string }>;
}

interface SearchResult {
  id: number;
  type: string;
  title: string;
  subtitle?: string;
}

const WEATHER_ICONS: Record<string, string> = {
  ensoleille: "☀️", nuageux: "⛅", orageux: "⛈️", pluvieux: "🌧️", neigeux: "❄️",
};
const TYPE_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  contact: "user", tache: "check-square", evenement: "calendar",
  message: "message-circle", projet: "folder", facture: "file-text",
};
const TYPE_COLORS: Record<string, string> = {
  contact: "#3b82f6", tache: "#22c55e", evenement: "#8b5cf6",
  message: "#f59e0b", projet: "#6366f1", facture: "#ef4444",
};

function StatCard({ label, value, color, icon }: { label: string; value: string | number; color: string; icon: keyof typeof Feather.glyphMap }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: color + "30", borderLeftWidth: 3, borderLeftColor: color }]}>
      <Feather name={icon} size={16} color={color} style={{ marginBottom: 4 }} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function BriefingSection({ data, loading, onRefresh }: { data: BriefingData | null; loading: boolean; onRefresh: () => void }) {
  const colors = useColors();

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator size="large" color="#f59e0b" />
        <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Chargement du briefing IA...</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.emptyBox}>
        <Feather name="coffee" size={40} color="#f59e0b" />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Prêt pour votre briefing</Text>
        <Pressable style={[styles.refreshBtn, { backgroundColor: "#f59e0b" }]} onPress={onRefresh}>
          <Feather name="refresh-cw" size={16} color="#fff" />
          <Text style={styles.refreshBtnText}>Charger le briefing</Text>
        </Pressable>
      </View>
    );
  }

  const s = data.stats ?? {};
  const wIcon = data.weather?.condition ? (WEATHER_ICONS[data.weather.condition] ?? "🌤️") : "🌤️";

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {data.greeting && (
        <View style={[styles.greetingCard, { backgroundColor: "#f59e0b18", borderColor: "#f59e0b30" }]}>
          <View style={styles.greetingRow}>
            <Text style={styles.coffeeIcon}>☕</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.greetingText, { color: colors.foreground }]}>{data.greeting}</Text>
              {data.weather && (
                <Text style={[styles.weatherText, { color: colors.mutedForeground }]}>
                  {wIcon} {data.weather.condition} {data.weather.temperature != null ? `· ${data.weather.temperature}°C` : ""}
                </Text>
              )}
            </View>
            <Pressable onPress={onRefresh} style={styles.miniRefresh}>
              <Feather name="refresh-cw" size={14} color="#f59e0b" />
            </Pressable>
          </View>
          {data.summary && (
            <Text style={[styles.summaryText, { color: colors.foreground }]}>{data.summary}</Text>
          )}
        </View>
      )}

      {Object.keys(s).some(k => (s as any)[k]) && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tableau de bord</Text>
          <View style={styles.statsGrid}>
            {s.appelsAujourdhui != null && <StatCard label="Appels auj." value={s.appelsAujourdhui} color="#3b82f6" icon="phone" />}
            {s.tachesEnRetard != null && <StatCard label="Tâches retard" value={s.tachesEnRetard} color="#ef4444" icon="check-square" />}
            {s.rendezVousAujourdhui != null && <StatCard label="RDV auj." value={s.rendezVousAujourdhui} color="#8b5cf6" icon="calendar" />}
            {s.projetsActifs != null && <StatCard label="Projets actifs" value={s.projetsActifs} color="#6366f1" icon="folder" />}
            {s.projetsEnRetard != null && s.projetsEnRetard > 0 && <StatCard label="Projets retard" value={s.projetsEnRetard} color="#f97316" icon="alert-triangle" />}
            {s.facturesImpayees != null && <StatCard label="Factures dues" value={s.facturesImpayees} color="#ef4444" icon="file-text" />}
            {s.montantImpaye != null && s.montantImpaye > 0 && (
              <StatCard
                label="Impayé"
                value={new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(s.montantImpaye)}
                color="#dc2626"
                icon="dollar-sign"
              />
            )}
          </View>
        </View>
      )}

      {data.urgentItems && data.urgentItems.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Points urgents</Text>
          {data.urgentItems.slice(0, 5).map((item, i) => (
            <View key={i} style={[styles.urgentItem, { backgroundColor: colors.card, borderColor: (TYPE_COLORS[item.type] ?? "#64748b") + "30" }]}>
              <View style={[styles.urgentDot, { backgroundColor: TYPE_COLORS[item.type] ?? "#64748b" }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.urgentTitle, { color: colors.foreground }]}>{item.title}</Text>
                {item.description && (
                  <Text style={[styles.urgentDesc, { color: colors.mutedForeground }]}>{item.description}</Text>
                )}
              </View>
              <View style={[styles.urgentBadge, { backgroundColor: (TYPE_COLORS[item.type] ?? "#64748b") + "18" }]}>
                <Feather name={TYPE_ICONS[item.type] ?? "circle"} size={10} color={TYPE_COLORS[item.type] ?? "#64748b"} />
                <Text style={[styles.urgentBadgeText, { color: TYPE_COLORS[item.type] ?? "#64748b" }]}>{item.type}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {data.suggestions && data.suggestions.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Suggestions IA</Text>
          {data.suggestions.slice(0, 4).map((s, i) => (
            <View key={i} style={[styles.suggestionItem, { backgroundColor: "#6366f118", borderColor: "#6366f130" }]}>
              <Feather name="star" size={12} color="#6366f1" />
              <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
            </View>
          ))}
        </View>
      )}

      {data.reminders && data.reminders.length > 0 && (
        <View style={{ marginBottom: 20 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Rappels</Text>
          {data.reminders.slice(0, 5).map((r, i) => (
            <View key={i} style={[styles.reminderItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="bell" size={13} color="#f59e0b" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.reminderTitle, { color: colors.foreground }]}>{r.title}</Text>
                {r.dueDate && (
                  <Text style={[styles.reminderDate, { color: colors.mutedForeground }]}>
                    {new Date(r.dueDate).toLocaleDateString("fr-FR")}
                  </Text>
                )}
              </View>
              {r.priority && (
                <View style={[styles.urgentBadge, { backgroundColor: r.priority === "haute" ? "#ef444418" : "#f59e0b18" }]}>
                  <Text style={[styles.urgentBadgeText, { color: r.priority === "haute" ? "#ef4444" : "#f59e0b" }]}>{r.priority}</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function SearchSection() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiSummary, setAiSummary] = useState("");
  const [total, setTotal] = useState(0);

  async function doSearch() {
    if (!query.trim() || query.length < 2) return;
    setSearching(true);
    setResults([]);
    setAiSummary("");
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/smart-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success) {
          const flatResults: SearchResult[] = [];
          if (d.results && typeof d.results === "object") {
            for (const items of Object.values(d.results)) {
              if (Array.isArray(items)) flatResults.push(...items);
            }
          }
          setResults(flatResults);
          setAiSummary(d.aiSummary ?? "");
          setTotal(d.totalResults ?? flatResults.length);
        }
      }
    } catch {}
    finally { setSearching(false); }
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: colors.foreground }]}
          placeholder="Recherche intelligente — contacts, tâches, projets..."
          placeholderTextColor={colors.mutedForeground}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={doSearch}
          returnKeyType="search"
        />
        {query ? <Pressable onPress={() => { setQuery(""); setResults([]); }}><Feather name="x" size={14} color={colors.mutedForeground} /></Pressable> : null}
        <Pressable onPress={doSearch} style={[styles.searchBtn, { backgroundColor: "#3b82f6" }]}>
          {searching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Feather name="arrow-right" size={14} color="#fff" />
          }
        </Pressable>
      </View>

      {aiSummary ? (
        <View style={[styles.aiSummaryBox, { backgroundColor: "#3b82f618", borderColor: "#3b82f630" }]}>
          <Feather name="cpu" size={12} color="#3b82f6" />
          <Text style={[styles.aiSummaryText, { color: colors.foreground }]}>{aiSummary}</Text>
        </View>
      ) : null}

      {total > 0 && (
        <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>{total} résultat{total !== 1 ? "s" : ""}</Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item, i) => `${item.type}-${item.id}-${i}`}
        ListEmptyComponent={
          !searching && query.length >= 2 ? (
            <View style={styles.emptyBox}>
              <Feather name="search" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>Aucun résultat trouvé</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[styles.resultItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.resultIcon, { backgroundColor: (TYPE_COLORS[item.type] ?? "#64748b") + "18" }]}>
              <Feather name={TYPE_ICONS[item.type] ?? "file"} size={14} color={TYPE_COLORS[item.type] ?? "#64748b"} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.resultTitle, { color: colors.foreground }]}>{item.title}</Text>
              {item.subtitle && <Text style={[styles.resultSub, { color: colors.mutedForeground }]}>{item.subtitle}</Text>}
            </View>
            <View style={[styles.urgentBadge, { backgroundColor: (TYPE_COLORS[item.type] ?? "#64748b") + "18" }]}>
              <Text style={[styles.urgentBadgeText, { color: TYPE_COLORS[item.type] ?? "#64748b" }]}>{item.type}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}

function EmailSection() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [context, setContext] = useState("");
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!context.trim()) return;
    setLoading(true);
    setResult("");
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/email-compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callContext: context, recipientName: recipient, emailPurpose: purpose }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success) setResult(d.emailContent ?? d.email ?? "");
      }
    } catch {}
    finally { setLoading(false); }
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Rédaction email IA</Text>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Contexte</Text>
      <TextInput
        style={[styles.multilineInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
        placeholder="Décrivez le contexte, l'objet, le ton souhaité..."
        placeholderTextColor={colors.mutedForeground}
        value={context}
        onChangeText={setContext}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Destinataire (optionnel)</Text>
      <TextInput
        style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
        placeholder="Nom du destinataire"
        placeholderTextColor={colors.mutedForeground}
        value={recipient}
        onChangeText={setRecipient}
      />
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Objectif (optionnel)</Text>
      <TextInput
        style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
        placeholder="Relance, proposition, remerciement..."
        placeholderTextColor={colors.mutedForeground}
        value={purpose}
        onChangeText={setPurpose}
      />
      <Pressable
        style={[styles.generateBtn, { backgroundColor: "#3b82f6", opacity: loading || !context.trim() ? 0.6 : 1 }]}
        onPress={generate}
        disabled={loading || !context.trim()}
      >
        {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
        <Text style={styles.generateBtnText}>{loading ? "Génération..." : "Générer l'email"}</Text>
      </Pressable>
      {result ? (
        <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: "#3b82f630" }]}>
          <View style={styles.resultBoxHeader}>
            <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>Email généré</Text>
            <Pressable onPress={() => setResult("")}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{result}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function FinanceSection() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/payment-overview`);
      if (res.ok) {
        const d = await res.json();
        if (d.success) setData(d);
      }
    } catch {}
    finally { setLoading(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.loadingBox}><ActivityIndicator size="large" color="#22c55e" /></View>;
  if (!data) return (
    <View style={styles.emptyBox}>
      <Feather name="dollar-sign" size={40} color="#22c55e" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Aperçu financier</Text>
      <Pressable style={[styles.refreshBtn, { backgroundColor: "#22c55e" }]} onPress={load}>
        <Feather name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.refreshBtnText}>Actualiser</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <View style={styles.statsGrid}>
        {data.totalRevenue != null && <StatCard label="Revenus" value={new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(data.totalRevenue)} color="#22c55e" icon="trending-up" />}
        {data.totalPending != null && <StatCard label="En attente" value={new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(data.totalPending)} color="#f59e0b" icon="clock" />}
        {data.totalOverdue != null && <StatCard label="En retard" value={new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(data.totalOverdue)} color="#ef4444" icon="alert-triangle" />}
        {data.overdueCount != null && <StatCard label="Factures retard" value={data.overdueCount} color="#dc2626" icon="file-text" />}
      </View>
      {data.aiInsights && (
        <View style={[styles.resultBox, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
          <Text style={[styles.resultBoxTitle, { color: colors.foreground, marginBottom: 8 }]}>Analyse IA</Text>
          <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{data.aiInsights}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "briefing", label: "Briefing", icon: "coffee",       color: "#f59e0b" },
  { key: "search",   label: "Recherche", icon: "search",      color: "#3b82f6" },
  { key: "email",    label: "Email",     icon: "mail",        color: "#8b5cf6" },
  { key: "finance",  label: "Finance",   icon: "dollar-sign", color: "#22c55e" },
];

export default function CommandantIAScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";

  const [tab, setTab] = useState<Tab>("briefing");
  const [briefingData, setBriefingData] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadBriefing = useCallback(async () => {
    setBriefingLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/daily-briefing`);
      if (res.ok) {
        const d = await res.json();
        if (d.success) setBriefingData(d);
      }
    } catch {}
    finally { setBriefingLoading(false); setRefreshing(false); }
  }, [fetchAuth]);

  useEffect(() => { loadBriefing(); }, [loadBriefing]);

  function onRefresh() { setRefreshing(true); loadBriefing(); }

  const activeColor = TABS.find(t => t.key === tab)?.color ?? "#f59e0b";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#7c3aed", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>AI Commandant</Text>
          <View style={styles.headerBadges}>
            <View style={[styles.aiBadge, { backgroundColor: "#10b98120" }]}>
              <Text style={[styles.aiBadgeText, { color: "#10b981" }]}>Gemini</Text>
            </View>
            <View style={[styles.aiBadge, { backgroundColor: "#8b5cf620" }]}>
              <Text style={[styles.aiBadgeText, { color: "#a78bfa" }]}>OpenAI</Text>
            </View>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ gap: 8 }}>
          {TABS.map(t => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[
                styles.tabChip,
                { backgroundColor: tab === t.key ? t.color : "rgba(255,255,255,0.1)" },
              ]}
            >
              <Feather name={t.icon} size={13} color={tab === t.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[styles.tabChipText, { color: tab === t.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.content}>
        {tab === "briefing" && (
          <ScrollView
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={activeColor} />}
            contentContainerStyle={{ padding: 16, paddingBottom: isWeb ? 118 : 100 }}
            showsVerticalScrollIndicator={false}
          >
            <BriefingSection data={briefingData} loading={briefingLoading} onRefresh={loadBriefing} />
          </ScrollView>
        )}
        {tab === "search" && (
          <View style={{ flex: 1, padding: 16, paddingBottom: isWeb ? 118 : 100 }}>
            <SearchSection />
          </View>
        )}
        {tab === "email" && (
          <View style={{ flex: 1, padding: 16, paddingBottom: isWeb ? 118 : 100 }}>
            <EmailSection />
          </View>
        )}
        {tab === "finance" && (
          <View style={{ flex: 1, padding: 16, paddingBottom: isWeb ? 118 : 100 }}>
            <FinanceSection />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 8 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  headerBadges: { flexDirection: "row", gap: 6 },
  aiBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  aiBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  tabBar: { flexGrow: 0 },
  tabChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20 },
  tabChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  content: { flex: 1 },
  loadingBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 },
  loadingText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, paddingTop: 60 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_500Medium" },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  refreshBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", marginBottom: 10, marginTop: 16 },
  greetingCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 4 },
  greetingRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 8 },
  coffeeIcon: { fontSize: 24 },
  greetingText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  weatherText: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  miniRefresh: { padding: 4 },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  statCard: { borderRadius: 12, borderWidth: 1, padding: 12, minWidth: "47%", flex: 1 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2 },
  urgentItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, gap: 10 },
  urgentDot: { width: 8, height: 8, borderRadius: 4 },
  urgentTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  urgentDesc: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  urgentBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  urgentBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  suggestionItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  suggestionText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 19 },
  reminderItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, gap: 10 },
  reminderTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  reminderDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 48, gap: 8, marginBottom: 12 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  searchBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  aiSummaryBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  aiSummaryText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  resultCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 10 },
  resultItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, gap: 10 },
  resultIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resultSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 6, marginTop: 12 },
  multilineInput: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular", minHeight: 100 },
  singleInput: { borderRadius: 10, borderWidth: 1, padding: 12, fontSize: 13, fontFamily: "Inter_400Regular", height: 44 },
  generateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 44, borderRadius: 12, marginTop: 16, marginBottom: 16 },
  generateBtnText: { color: "#fff", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  resultBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  resultBoxHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  resultBoxTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  resultBoxText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
