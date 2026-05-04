import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

type Tab = "briefing" | "search" | "email" | "taches" | "reunions" | "equipe" | "finance";

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

function UrgencyBadge({ level }: { level: string }) {
  const cfg: Record<string, { color: string; label: string }> = {
    critique: { color: "#ef4444", label: "Critique" },
    haute:    { color: "#f97316", label: "Haute" },
    moyenne:  { color: "#f59e0b", label: "Moyenne" },
    basse:    { color: "#22c55e", label: "Basse" },
  };
  const c = cfg[level] ?? cfg.basse;
  return (
    <View style={[styles.urgencyBadge, { backgroundColor: c.color + "18" }]}>
      <Text style={[styles.urgencyBadgeText, { color: c.color }]}>{c.label}</Text>
    </View>
  );
}

// ─── BRIEFING ────────────────────────────────────────────────────────────────
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
          {data.summary && <Text style={[styles.summaryText, { color: colors.foreground }]}>{data.summary}</Text>}
        </View>
      )}

      {Object.keys(s).some(k => (s as any)[k] != null) && (
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
              <StatCard label="Impayé" value={new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(s.montantImpaye)} color="#dc2626" icon="dollar-sign" />
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
                {item.description && <Text style={[styles.urgentDesc, { color: colors.mutedForeground }]}>{item.description}</Text>}
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
                {r.dueDate && <Text style={[styles.reminderDate, { color: colors.mutedForeground }]}>{new Date(r.dueDate).toLocaleDateString("fr-FR")}</Text>}
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

// ─── SEARCH ──────────────────────────────────────────────────────────────────
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
    setResults([]); setAiSummary("");
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
              if (Array.isArray(items)) flatResults.push(...items as SearchResult[]);
            }
          }
          setResults(flatResults);
          setAiSummary(d.aiSummary ?? "");
          setTotal(d.totalResults ?? flatResults.length);
        }
      }
    } catch {} finally { setSearching(false); }
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
          {searching ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="arrow-right" size={14} color="#fff" />}
        </Pressable>
      </View>
      {aiSummary ? (
        <View style={[styles.aiSummaryBox, { backgroundColor: "#3b82f618", borderColor: "#3b82f630" }]}>
          <Feather name="cpu" size={12} color="#3b82f6" />
          <Text style={[styles.aiSummaryText, { color: colors.foreground }]}>{aiSummary}</Text>
        </View>
      ) : null}
      {total > 0 && <Text style={[styles.resultCount, { color: colors.mutedForeground }]}>{total} résultat{total !== 1 ? "s" : ""}</Text>}
      <FlatList
        data={results}
        keyExtractor={(item, i) => `${item.type}-${item.id}-${i}`}
        ListEmptyComponent={!searching && query.length >= 2 ? (
          <View style={styles.emptyBox}>
            <Feather name="search" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.mutedForeground }]}>Aucun résultat</Text>
          </View>
        ) : null}
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

// ─── EMAIL ───────────────────────────────────────────────────────────────────
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
    setLoading(true); setResult("");
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
    } catch {} finally { setLoading(false); }
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Rédaction email IA</Text>
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Contexte *</Text>
      <TextInput style={[styles.multilineInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholder="Contexte, objet, ton souhaité..." placeholderTextColor={colors.mutedForeground} value={context} onChangeText={setContext} multiline numberOfLines={4} textAlignVertical="top" />
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Destinataire (optionnel)</Text>
      <TextInput style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholder="Nom du destinataire" placeholderTextColor={colors.mutedForeground} value={recipient} onChangeText={setRecipient} />
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Objectif (optionnel)</Text>
      <TextInput style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholder="Relance, proposition, remerciement..." placeholderTextColor={colors.mutedForeground} value={purpose} onChangeText={setPurpose} />
      <Pressable style={[styles.generateBtn, { backgroundColor: "#3b82f6", opacity: loading || !context.trim() ? 0.6 : 1 }]} onPress={generate} disabled={loading || !context.trim()}>
        {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
        <Text style={styles.generateBtnText}>{loading ? "Génération..." : "Générer l'email"}</Text>
      </Pressable>
      {result ? (
        <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: "#3b82f630" }]}>
          <View style={styles.resultBoxHeader}>
            <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>Email généré</Text>
            <Pressable onPress={() => setResult("")}><Feather name="x" size={14} color={colors.mutedForeground} /></Pressable>
          </View>
          <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{result}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

// ─── TÂCHES & RAPPELS ────────────────────────────────────────────────────────
function TachesSection() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [sendingEmails, setSendingEmails] = useState(false);

  const load = useCallback(async (sendEmails = false) => {
    sendEmails ? setSendingEmails(true) : setLoading(true);
    setData(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/overdue-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sendEmails }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success) setData(d);
      }
    } catch {} finally { setLoading(false); setSendingEmails(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.loadingBox}><ActivityIndicator size="large" color="#22c55e" /><Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Analyse IA des retards...</Text></View>;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* Header counts */}
      {data && (
        <View style={styles.statsGrid}>
          <StatCard label="Tâches retard" value={data.overdue?.tasks ?? 0} color="#ef4444" icon="check-square" />
          <StatCard label="Factures dues" value={data.overdue?.invoices ?? 0} color="#f59e0b" icon="file-text" />
          <StatCard label="Évènements 48h" value={data.overdue?.events ?? 0} color="#8b5cf6" icon="calendar" />
          {data.emailsSent > 0 && <StatCard label="Emails envoyés" value={data.emailsSent} color="#22c55e" icon="send" />}
        </View>
      )}

      {/* Daily summary */}
      {data?.aiAnalysis?.dailySummary && (
        <View style={[styles.resultBox, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Feather name="cpu" size={13} color="#22c55e" />
            <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>Résumé IA</Text>
          </View>
          <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{data.aiAnalysis.dailySummary}</Text>
        </View>
      )}

      {/* Critical alerts */}
      {data?.aiAnalysis?.criticalAlerts?.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: "#ef4444" }]}>⚠ Alertes critiques</Text>
          {data.aiAnalysis.criticalAlerts.map((a: string, i: number) => (
            <View key={i} style={[styles.urgentItem, { backgroundColor: "#ef444410", borderColor: "#ef444430" }]}>
              <Feather name="alert-circle" size={14} color="#ef4444" />
              <Text style={[styles.urgentTitle, { color: "#ef4444" }]}>{a}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Task reminders */}
      {data?.aiAnalysis?.taskReminders?.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Tâches en retard</Text>
          {data.aiAnalysis.taskReminders.map((r: any, i: number) => (
            <View key={i} style={[styles.urgentItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="check-square" size={14} color="#ef4444" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.urgentTitle, { color: colors.foreground }]}>{r.message}</Text>
                {r.suggestedAction && <Text style={[styles.urgentDesc, { color: "#22c55e" }]}>→ {r.suggestedAction}</Text>}
              </View>
              <UrgencyBadge level={r.urgency ?? "moyenne"} />
            </View>
          ))}
        </View>
      )}

      {/* Invoice reminders */}
      {data?.aiAnalysis?.invoiceReminders?.length > 0 && (
        <View>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Factures impayées</Text>
          {data.aiAnalysis.invoiceReminders.map((r: any, i: number) => (
            <View key={i} style={[styles.urgentItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="file-text" size={14} color="#f59e0b" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.urgentTitle, { color: colors.foreground }]}>{r.clientName} — {Number(r.amount ?? 0).toFixed(2)} EUR</Text>
                <Text style={[styles.urgentDesc, { color: colors.mutedForeground }]}>{r.message}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Event reminders */}
      {data?.aiAnalysis?.eventReminders?.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Évènements proches</Text>
          {data.aiAnalysis.eventReminders.map((r: any, i: number) => (
            <View key={i} style={[styles.urgentItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="calendar" size={14} color="#8b5cf6" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.urgentTitle, { color: colors.foreground }]}>{r.title}</Text>
                <Text style={[styles.urgentDesc, { color: colors.mutedForeground }]}>{r.message}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Action buttons */}
      <View style={{ gap: 8, marginBottom: 20 }}>
        <Pressable onPress={() => load()} style={[styles.generateBtn, { backgroundColor: "#22c55e" }]} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="refresh-cw" size={16} color="#fff" />}
          <Text style={styles.generateBtnText}>Actualiser l'analyse</Text>
        </Pressable>
        <Pressable onPress={() => load(true)} style={[styles.generateBtn, { backgroundColor: "#f59e0b", opacity: sendingEmails ? 0.6 : 1 }]} disabled={sendingEmails}>
          {sendingEmails ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="send" size={16} color="#fff" />}
          <Text style={styles.generateBtnText}>{sendingEmails ? "Envoi en cours..." : "Envoyer rappels par email"}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

// ─── RÉUNIONS ────────────────────────────────────────────────────────────────
function ReunionsSection() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [title, setTitle] = useState("");
  const [participants, setParticipants] = useState("");
  const [notes, setNotes] = useState("");
  const [duration, setDuration] = useState("");
  const [meetingType, setMeetingType] = useState("reunion");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const MEETING_TYPES = [
    { value: "reunion", label: "Réunion" },
    { value: "appel", label: "Appel" },
    { value: "negociation", label: "Négociation" },
    { value: "formation", label: "Formation" },
    { value: "retrospective", label: "Rétrospective" },
  ];

  async function compile() {
    if (!notes.trim()) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/meeting-compile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingTitle: title || "Réunion",
          participants: participants.split(",").map(p => p.trim()).filter(Boolean),
          notes,
          duration: parseInt(duration) || undefined,
          meetingType,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        if (d.success) setResult(d);
      }
    } catch {} finally { setLoading(false); }
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Compilateur de réunion IA</Text>

      {/* Form */}
      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Titre de la réunion</Text>
      <TextInput style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholder="Ex: Point hebdomadaire équipe" placeholderTextColor={colors.mutedForeground} value={title} onChangeText={setTitle} />

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8, paddingBottom: 2 }}>
        {MEETING_TYPES.map(t => (
          <Pressable key={t.value} onPress={() => setMeetingType(t.value)} style={[styles.typeChip, { backgroundColor: meetingType === t.value ? "#8b5cf6" : colors.card, borderColor: meetingType === t.value ? "#8b5cf6" : colors.border }]}>
            <Text style={[styles.typeChipText, { color: meetingType === t.value ? "#fff" : colors.mutedForeground }]}>{t.label}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Participants (séparés par virgule)</Text>
      <TextInput style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholder="Marie Dupont, Jean Martin..." placeholderTextColor={colors.mutedForeground} value={participants} onChangeText={setParticipants} />

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Durée (minutes)</Text>
      <TextInput style={[styles.singleInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]} placeholder="60" placeholderTextColor={colors.mutedForeground} value={duration} onChangeText={setDuration} keyboardType="numeric" />

      <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes / compte-rendu *</Text>
      <TextInput style={[styles.multilineInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border, minHeight: 100 }]} placeholder="Collez ici les notes brutes de la réunion, points discutés, décisions..." placeholderTextColor={colors.mutedForeground} value={notes} onChangeText={setNotes} multiline textAlignVertical="top" />

      <Pressable onPress={compile} style={[styles.generateBtn, { backgroundColor: "#8b5cf6", opacity: loading || !notes.trim() ? 0.6 : 1 }]} disabled={loading || !notes.trim()}>
        {loading ? <ActivityIndicator size="small" color="#fff" /> : <Feather name="cpu" size={16} color="#fff" />}
        <Text style={styles.generateBtnText}>{loading ? "Compilation en cours..." : "Compiler la réunion"}</Text>
      </Pressable>

      {/* Result */}
      {result && (
        <View style={{ gap: 10, marginTop: 4, marginBottom: 24 }}>
          {result.aiReport?.summary && (
            <View style={[styles.resultBox, { backgroundColor: "#8b5cf610", borderColor: "#8b5cf630" }]}>
              <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>📋 Résumé</Text>
              <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{result.aiReport.summary}</Text>
              {result.aiReport.meetingEfficiency && (
                <Text style={[styles.resultSub, { color: colors.mutedForeground, marginTop: 6 }]}>Efficacité: {result.aiReport.meetingEfficiency}</Text>
              )}
            </View>
          )}

          {result.aiReport?.keyDecisions?.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>✅ Décisions</Text>
              {result.aiReport.keyDecisions.map((d: string, i: number) => (
                <View key={i} style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  <Text style={{ color: "#22c55e" }}>•</Text>
                  <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{d}</Text>
                </View>
              ))}
            </View>
          )}

          {result.createdTasks?.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
              <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>🗂 {result.createdTasks.length} tâche{result.createdTasks.length > 1 ? "s" : ""} créée{result.createdTasks.length > 1 ? "s" : ""}</Text>
              {result.createdTasks.slice(0, 5).map((t: any, i: number) => (
                <Text key={i} style={[styles.resultBoxText, { color: colors.foreground, marginTop: 4 }]}>• {t.title}</Text>
              ))}
            </View>
          )}

          {result.aiReport?.risks?.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: "#ef444410", borderColor: "#ef444430" }]}>
              <Text style={[styles.resultBoxTitle, { color: "#ef4444" }]}>⚠ Risques identifiés</Text>
              {result.aiReport.risks.map((r: string, i: number) => (
                <Text key={i} style={[styles.resultBoxText, { color: colors.foreground, marginTop: 4 }]}>• {r}</Text>
              ))}
            </View>
          )}

          {result.aiReport?.nextSteps?.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: "#3b82f610", borderColor: "#3b82f630" }]}>
              <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>→ Prochaines étapes</Text>
              {result.aiReport.nextSteps.map((s: string, i: number) => (
                <Text key={i} style={[styles.resultBoxText, { color: colors.foreground, marginTop: 4 }]}>• {s}</Text>
              ))}
            </View>
          )}

          <Pressable onPress={() => setResult(null)} style={[styles.generateBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}>
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
            <Text style={[styles.generateBtnText, { color: colors.mutedForeground }]}>Nouvelle réunion</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

// ─── ÉQUIPE ──────────────────────────────────────────────────────────────────
function EquipeSection() {
  const colors = useColors();
  const { fetchAuth } = useAuth();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/commandant/employee-stats`);
      if (res.ok) {
        const d = await res.json();
        if (d.success) setData(d);
      }
    } catch {} finally { setLoading(false); }
  }, [fetchAuth]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.loadingBox}><ActivityIndicator size="large" color="#ec4899" /><Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Analyse des performances...</Text></View>;
  if (!data) return (
    <View style={styles.emptyBox}>
      <Feather name="users" size={40} color="#ec4899" />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Statistiques équipe</Text>
      <Pressable style={[styles.refreshBtn, { backgroundColor: "#ec4899" }]} onPress={load}>
        <Feather name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.refreshBtnText}>Charger</Text>
      </Pressable>
    </View>
  );

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* AI analysis */}
      {data.analysis && (
        <View style={{ gap: 8, marginBottom: 4 }}>
          {data.analysis.teamInsights && (
            <View style={[styles.resultBox, { backgroundColor: "#ec489910", borderColor: "#ec489930" }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <Feather name="cpu" size={13} color="#ec4899" />
                <Text style={[styles.resultBoxTitle, { color: colors.foreground }]}>Analyse IA équipe</Text>
                {data.analysis.globalScore != null && (
                  <View style={[styles.urgencyBadge, { backgroundColor: "#ec489918", marginLeft: "auto" }]}>
                    <Text style={[styles.urgencyBadgeText, { color: "#ec4899" }]}>Score: {data.analysis.globalScore}/100</Text>
                  </View>
                )}
              </View>
              <Text style={[styles.resultBoxText, { color: colors.foreground }]}>{data.analysis.teamInsights}</Text>
            </View>
          )}
          {data.analysis.topPerformers?.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: "#22c55e10", borderColor: "#22c55e30" }]}>
              <Text style={[styles.resultBoxTitle, { color: "#22c55e" }]}>🏆 Top performers</Text>
              {data.analysis.topPerformers.map((p: any, i: number) => (
                <Text key={i} style={[styles.resultBoxText, { color: colors.foreground, marginTop: 4 }]}>• {p.name} — {p.reason}</Text>
              ))}
            </View>
          )}
          {data.analysis.needsAttention?.length > 0 && (
            <View style={[styles.resultBox, { backgroundColor: "#f59e0b10", borderColor: "#f59e0b30" }]}>
              <Text style={[styles.resultBoxTitle, { color: "#f59e0b" }]}>⚠ À surveiller</Text>
              {data.analysis.needsAttention.map((p: any, i: number) => (
                <View key={i} style={{ marginTop: 6 }}>
                  <Text style={[styles.resultBoxText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>{p.name}</Text>
                  <Text style={[styles.resultBoxText, { color: colors.mutedForeground }]}>{p.issue}</Text>
                  {p.suggestion && <Text style={[styles.resultBoxText, { color: "#22c55e" }]}>→ {p.suggestion}</Text>}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Employee cards */}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Membres de l'équipe ({data.employees?.length ?? 0})</Text>
      {(data.employees ?? []).map((emp: any, i: number) => {
        const score = emp.stats?.productivityScore ?? 0;
        const scoreColor = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
        return (
          <View key={i} style={[styles.urgentItem, { backgroundColor: colors.card, borderColor: colors.border, flexDirection: "column", alignItems: "stretch" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={[styles.empAvatar, { backgroundColor: "#ec489918" }]}>
                <Text style={[styles.empAvatarText, { color: "#ec4899" }]}>
                  {(emp.name || "?")[0].toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.urgentTitle, { color: colors.foreground }]}>{emp.name}</Text>
                <Text style={[styles.urgentDesc, { color: colors.mutedForeground }]}>{emp.role}{emp.department ? ` · ${emp.department}` : ""}</Text>
              </View>
              <View style={[styles.urgencyBadge, { backgroundColor: scoreColor + "18" }]}>
                <Text style={[styles.urgencyBadgeText, { color: scoreColor }]}>{score} pts</Text>
              </View>
            </View>
            <View style={[styles.empStatsRow]}>
              {[
                { icon: "check-square" as const, val: emp.stats?.tasksCompleted ?? 0, label: "Terminées", color: "#22c55e" },
                { icon: "alert-circle" as const, val: emp.stats?.tasksOverdue ?? 0,   label: "Retard",     color: "#ef4444" },
                { icon: "phone" as const,         val: emp.stats?.callsMade ?? 0,      label: "Appels",     color: "#3b82f6" },
                { icon: "calendar" as const,      val: emp.stats?.eventsAttended ?? 0, label: "Évènements", color: "#8b5cf6" },
              ].map(s => (
                <View key={s.label} style={styles.empStat}>
                  <Feather name={s.icon} size={12} color={s.color} />
                  <Text style={[styles.empStatVal, { color: colors.foreground }]}>{s.val}</Text>
                  <Text style={[styles.empStatLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
                </View>
              ))}
            </View>
          </View>
        );
      })}

      <Pressable onPress={load} style={[styles.generateBtn, { backgroundColor: "#ec4899", marginTop: 8, marginBottom: 24 }]}>
        <Feather name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.generateBtnText}>Actualiser</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── FINANCE ─────────────────────────────────────────────────────────────────
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
    } catch {} finally { setLoading(false); }
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
      <Pressable onPress={load} style={[styles.generateBtn, { backgroundColor: "#22c55e", marginTop: 4, marginBottom: 24 }]}>
        <Feather name="refresh-cw" size={16} color="#fff" />
        <Text style={styles.generateBtnText}>Actualiser</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
const TABS: { key: Tab; label: string; icon: keyof typeof Feather.glyphMap; color: string }[] = [
  { key: "briefing",  label: "Briefing",  icon: "coffee",      color: "#f59e0b" },
  { key: "taches",    label: "Tâches",    icon: "check-square",color: "#22c55e" },
  { key: "reunions",  label: "Réunions",  icon: "users",       color: "#8b5cf6" },
  { key: "equipe",    label: "Équipe",    icon: "user-check",  color: "#ec4899" },
  { key: "email",     label: "Email",     icon: "mail",        color: "#3b82f6" },
  { key: "search",    label: "Recherche", icon: "search",      color: "#6366f1" },
  { key: "finance",   label: "Finance",   icon: "dollar-sign", color: "#16a34a" },
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
    } catch {} finally { setBriefingLoading(false); setRefreshing(false); }
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
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tabChip, { backgroundColor: tab === t.key ? t.color : "rgba(255,255,255,0.1)" }]}>
              <Feather name={t.icon} size={13} color={tab === t.key ? "#fff" : "rgba(255,255,255,0.7)"} />
              <Text style={[styles.tabChipText, { color: tab === t.key ? "#fff" : "rgba(255,255,255,0.7)" }]}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.content}>
        {tab === "briefing" && (
          <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={activeColor} />} contentContainerStyle={{ padding: 16, paddingBottom: isWeb ? 118 : 100 }} showsVerticalScrollIndicator={false}>
            <BriefingSection data={briefingData} loading={briefingLoading} onRefresh={loadBriefing} />
          </ScrollView>
        )}
        {tab === "taches" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: isWeb ? 118 : 100 }} showsVerticalScrollIndicator={false}>
            <TachesSection />
          </ScrollView>
        )}
        {tab === "reunions" && (
          <View style={{ flex: 1, padding: 16, paddingBottom: isWeb ? 118 : 100 }}>
            <ReunionsSection />
          </View>
        )}
        {tab === "equipe" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: isWeb ? 118 : 100 }} showsVerticalScrollIndicator={false}>
            <EquipeSection />
          </ScrollView>
        )}
        {tab === "email" && (
          <View style={{ flex: 1, padding: 16, paddingBottom: isWeb ? 118 : 100 }}>
            <EmailSection />
          </View>
        )}
        {tab === "search" && (
          <View style={{ flex: 1, padding: 16, paddingBottom: isWeb ? 118 : 100 }}>
            <SearchSection />
          </View>
        )}
        {tab === "finance" && (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: isWeb ? 118 : 100 }} showsVerticalScrollIndicator={false}>
            <FinanceSection />
          </ScrollView>
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
  urgencyBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  urgencyBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  suggestionItem: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  suggestionText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  reminderItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, gap: 10 },
  reminderTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  reminderDate: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, gap: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  searchBtn: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  aiSummaryBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  aiSummaryText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  resultCount: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 8 },
  resultItem: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8, gap: 10 },
  resultIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  resultTitle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  resultSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  fieldLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginBottom: 6, marginTop: 4 },
  singleInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 10 },
  multilineInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 10, minHeight: 80 },
  generateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, marginBottom: 4 },
  generateBtnText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  resultBox: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  resultBoxHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  resultBoxTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  resultBoxText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  typeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  empAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  empAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  empStatsRow: { flexDirection: "row", marginTop: 10, gap: 8 },
  empStat: { flex: 1, alignItems: "center", gap: 3 },
  empStatVal: { fontSize: 14, fontFamily: "Inter_700Bold" },
  empStatLabel: { fontSize: 9, fontFamily: "Inter_400Regular" },
});
