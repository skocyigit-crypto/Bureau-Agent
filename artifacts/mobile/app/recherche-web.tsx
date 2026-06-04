import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type UrlRisk = "safe" | "suspicious" | "dangerous";
type SearchMode = "web" | "news";
type Freshness = "any" | "day" | "week" | "month" | "year";
type SearchLang = "fr" | "en" | "tr";

interface WebSearchResultItem {
  title: string;
  url: string;
  displayUrl: string;
  domain: string;
  snippet: string;
  risk: UrlRisk;
  reasons: string[];
  threatTypes?: string[];
}

interface WebSearchResponse {
  query: string;
  answer: string;
  results: WebSearchResultItem[];
  relatedSearches: string[];
  mode?: SearchMode;
  freshness?: Freshness;
  lang?: SearchLang;
  site?: string;
}

const FRESHNESS_OPTIONS: { value: Freshness; label: string }[] = [
  { value: "any", label: "Toutes dates" },
  { value: "day", label: "24 h" },
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "year", label: "Année" },
];

const LANG_OPTIONS: { value: SearchLang; label: string }[] = [
  { value: "fr", label: "FR" },
  { value: "en", label: "EN" },
  { value: "tr", label: "TR" },
];

const EXAMPLE_QUERIES = [
  "Actualités économiques en France",
  "Taux de TVA pour une PME en 2026",
  "Modèle de facture conforme",
];

const RISK_META: Record<
  UrlRisk,
  { label: string; color: string; icon: keyof typeof Feather.glyphMap }
> = {
  safe: { label: "Sûr", color: "#10b981", icon: "shield" },
  suspicious: { label: "Suspect", color: "#f59e0b", icon: "alert-triangle" },
  dangerous: { label: "Dangereux", color: "#ef4444", icon: "shield-off" },
};

export default function RechercheWebScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("web");
  const [freshness, setFreshness] = useState<Freshness>("any");
  const [lang, setLang] = useState<SearchLang>("fr");
  const [site, setSite] = useState("");

  const [data, setData] = useState<WebSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [safeOnly, setSafeOnly] = useState(false);

  const runSearch = useCallback(
    async (override?: {
      term?: string;
      mode?: SearchMode;
      freshness?: Freshness;
      lang?: SearchLang;
      site?: string;
    }) => {
      const q = (override?.term ?? query).trim();
      if (q.length < 2) return;
      if (override?.term) setQuery(q);
      setLoading(true);
      setSearched(true);
      setError(null);
      try {
        const res = await fetchAuth(`${API_BASE}/api/web-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: q,
            mode: override?.mode ?? mode,
            freshness: override?.freshness ?? freshness,
            lang: override?.lang ?? lang,
            site: (override?.site ?? site).trim() || undefined,
          }),
        });
        const json = (await res.json()) as WebSearchResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || "La recherche a échoué.");
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Recherche impossible.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [query, mode, freshness, lang, site, fetchAuth],
  );

  // Change un filtre ; relance si une recherche est déjà affichée.
  const changeMode = (m: SearchMode) => {
    setMode(m);
    if (searched && !loading) void runSearch({ mode: m });
  };
  const changeFreshness = (f: Freshness) => {
    setFreshness(f);
    if (searched && !loading) void runSearch({ freshness: f });
  };
  const changeLang = (l: SearchLang) => {
    setLang(l);
    if (searched && !loading) void runSearch({ lang: l });
  };

  const openResult = (item: WebSearchResultItem) => {
    if (item.risk === "dangerous") {
      Alert.alert(
        "Lien signalé comme dangereux",
        `L'antivirus a détecté un risque sur ${item.domain || item.displayUrl}.\n\nSouhaitez-vous vraiment ouvrir ce lien ?`,
        [
          { text: "Annuler", style: "cancel" },
          {
            text: "Ouvrir quand même",
            style: "destructive",
            onPress: () => void Linking.openURL(item.url),
          },
        ],
      );
      return;
    }
    void Linking.openURL(item.url);
  };

  const visibleResults = data
    ? safeOnly
      ? data.results.filter((r) => r.risk !== "dangerous")
      : data.results
    : [];
  const hiddenCount = data ? data.results.length - visibleResults.length : 0;
  const dangerousCount = data ? data.results.filter((r) => r.risk === "dangerous").length : 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1e293b", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Recherche web</Text>
        </View>
        <View style={[styles.searchBox, { backgroundColor: "#fff" }]}>
          <Feather name="search" size={16} color="#6b7280" />
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Rechercher sur le web…"
            placeholderTextColor="#9ca3af"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void runSearch()}
            returnKeyType="search"
            maxLength={300}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery("")}>
              <Feather name="x" size={16} color="#6b7280" />
            </Pressable>
          )}
        </View>

        {/* Filtres : mode + période + langue */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          <Chip
            active={mode === "web"}
            label="Web"
            icon="globe"
            onPress={() => changeMode("web")}
          />
          <Chip
            active={mode === "news"}
            label="Actualités"
            icon="rss"
            onPress={() => changeMode("news")}
          />
          <View style={styles.filterDivider} />
          {FRESHNESS_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              active={freshness === o.value}
              label={o.label}
              onPress={() => changeFreshness(o.value)}
            />
          ))}
          <View style={styles.filterDivider} />
          {LANG_OPTIONS.map((o) => (
            <Chip
              key={o.value}
              active={lang === o.value}
              label={o.label}
              onPress={() => changeLang(o.value)}
            />
          ))}
        </ScrollView>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: isWeb ? 118 : 100 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Filtre site: */}
          <View style={[styles.siteBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="filter" size={14} color={colors.mutedForeground} />
            <TextInput
              style={[styles.siteInput, { color: colors.foreground }]}
              placeholder="Limiter à un site (ex. lemonde.fr)"
              placeholderTextColor={colors.mutedForeground}
              value={site}
              onChangeText={setSite}
              onSubmitEditing={() => searched && void runSearch()}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {site.length > 0 && (
              <Pressable
                onPress={() => {
                  setSite("");
                  if (searched && !loading) void runSearch({ site: "" });
                }}
              >
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            )}
          </View>

          {/* Initial */}
          {!searched && (
            <View style={styles.emptyState}>
              <View style={[styles.emptyIcon, { backgroundColor: "#f1f5f9" }]}>
                <Feather name="globe" size={34} color="#94a3b8" />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Recherche web sécurisée</Text>
              <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
                Chaque lien est analysé par l'antivirus intégré avant que vous ne cliquiez.
              </Text>
              <View style={styles.examplesWrap}>
                {EXAMPLE_QUERIES.map((ex) => (
                  <Pressable
                    key={ex}
                    onPress={() => void runSearch({ term: ex })}
                    style={[styles.exampleChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Feather name="search" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.exampleText, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {ex}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {loading && (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
                {mode === "news" ? "Recherche d'actualités" : "Recherche"} et analyse de sécurité…
              </Text>
            </View>
          )}

          {error && !loading && (
            <View style={[styles.errorCard, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "40" }]}>
              <Feather name="alert-triangle" size={15} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          {/* Réponse IA */}
          {!loading && data?.answer ? (
            <View style={[styles.answerCard, { backgroundColor: colors.primary + "0d", borderColor: colors.primary + "33" }]}>
              <View style={styles.answerHeader}>
                <Feather name="zap" size={14} color={colors.primary} />
                <Text style={[styles.answerHeaderText, { color: colors.primary }]}>Résumé IA</Text>
                {data.mode === "news" && (
                  <View style={[styles.miniBadge, { borderColor: colors.primary + "55" }]}>
                    <Text style={[styles.miniBadgeText, { color: colors.primary }]}>Actualités</Text>
                  </View>
                )}
                {data.site ? (
                  <View style={[styles.miniBadge, { borderColor: colors.primary + "55" }]}>
                    <Text style={[styles.miniBadgeText, { color: colors.primary }]}>site:{data.site}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.answerBody, { color: colors.foreground }]}>{data.answer}</Text>
            </View>
          ) : null}

          {/* Résumé sécurité */}
          {!loading && data && data.results.length > 0 && (
            <View style={styles.securityRow}>
              <Feather name="shield" size={13} color={colors.mutedForeground} />
              <Text style={[styles.securityText, { color: colors.mutedForeground }]}>
                {data.results.length} résultat{data.results.length > 1 ? "s" : ""} analysé{data.results.length > 1 ? "s" : ""}
              </Text>
              {dangerousCount > 0 && (
                <Pressable
                  onPress={() => setSafeOnly((v) => !v)}
                  style={[styles.safeToggle, { borderColor: safeOnly ? "#10b981" : colors.border, backgroundColor: safeOnly ? "#10b98115" : "transparent" }]}
                >
                  <Text style={[styles.safeToggleText, { color: safeOnly ? "#10b981" : colors.mutedForeground }]}>
                    {safeOnly ? "✓ Dangereux masqués" : "Masquer dangereux"}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {/* Résultats */}
          {!loading && data && data.results.length === 0 && (
            <Text style={[styles.noResults, { color: colors.mutedForeground }]}>
              Aucune source web n'a pu être récupérée pour cette recherche.
            </Text>
          )}

          {!loading &&
            visibleResults.map((item, i) => {
              const meta = RISK_META[item.risk];
              const fav = item.domain
                ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(item.domain)}&sz=64`
                : null;
              return (
                <Pressable
                  key={`${item.url}-${i}`}
                  onPress={() => openResult(item)}
                  style={({ pressed }) => [
                    styles.resultCard,
                    { backgroundColor: colors.card, borderColor: item.risk === "dangerous" ? "#ef444455" : colors.border },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <View style={styles.resultTop}>
                    <View style={styles.resultDomain}>
                      {fav ? (
                        <Image source={{ uri: fav }} style={styles.favicon} />
                      ) : (
                        <Feather name="globe" size={12} color={colors.mutedForeground} />
                      )}
                      <Text style={[styles.resultUrl, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.displayUrl || item.domain || item.url}
                      </Text>
                    </View>
                    <View style={[styles.riskBadge, { backgroundColor: meta.color + "18" }]}>
                      <Feather name={meta.icon} size={10} color={meta.color} />
                      <Text style={[styles.riskBadgeText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>
                  <Text style={[styles.resultTitle, { color: colors.primary }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                  {item.snippet ? (
                    <Text style={[styles.resultSnippet, { color: colors.mutedForeground }]} numberOfLines={3}>
                      {item.snippet}
                    </Text>
                  ) : null}
                  {item.reasons.length > 0 && (
                    <View style={styles.reasonsWrap}>
                      {item.reasons.slice(0, 2).map((r, ri) => (
                        <Text key={ri} style={[styles.reasonText, { color: meta.color }]} numberOfLines={1}>
                          • {r}
                        </Text>
                      ))}
                    </View>
                  )}
                </Pressable>
              );
            })}

          {!loading && hiddenCount > 0 && (
            <Pressable
              onPress={() => setSafeOnly(false)}
              style={[styles.showHidden, { borderColor: colors.border }]}
            >
              <Text style={[styles.showHiddenText, { color: colors.mutedForeground }]}>
                {hiddenCount} lien{hiddenCount > 1 ? "s" : ""} dangereux masqué{hiddenCount > 1 ? "s" : ""} — tout afficher
              </Text>
            </Pressable>
          )}

          {/* Recherches associées */}
          {!loading && data && data.relatedSearches.length > 0 && (
            <View style={styles.relatedWrap}>
              <Text style={[styles.relatedTitle, { color: colors.mutedForeground }]}>RECHERCHES ASSOCIÉES</Text>
              <View style={styles.relatedChips}>
                {data.relatedSearches.map((rs) => (
                  <Pressable
                    key={rs}
                    onPress={() => void runSearch({ term: rs })}
                    style={[styles.relatedChip, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <Text style={[styles.relatedChipText, { color: colors.foreground }]} numberOfLines={1}>
                      {rs}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Chip({
  active,
  label,
  icon,
  onPress,
}: {
  active: boolean;
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active ? { backgroundColor: "#fff" } : { backgroundColor: "#ffffff22" },
      ]}
    >
      {icon && <Feather name={icon} size={12} color={active ? "#1e293b" : "#cbd5e1"} />}
      <Text style={[styles.chipText, { color: active ? "#1e293b" : "#cbd5e1" }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", borderRadius: 12, paddingHorizontal: 14, height: 44, gap: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  searchInput: { flex: 1, color: "#111827", fontSize: 15, fontFamily: "Inter_400Regular" },
  filterRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 8 },
  filterDivider: { width: StyleSheet.hairlineWidth, height: 20, backgroundColor: "#ffffff44", marginHorizontal: 2 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 16 },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scrollContent: { padding: 16, gap: 12 },
  siteBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, height: 40 },
  siteInput: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  emptyState: { alignItems: "center", padding: 24, gap: 10 },
  emptyIcon: { width: 70, height: 70, borderRadius: 22, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold", textAlign: "center" },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20, maxWidth: 300 },
  examplesWrap: { gap: 8, marginTop: 8, width: "100%" },
  exampleChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  exampleText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 14, justifyContent: "center" },
  loadingText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  answerCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  answerHeader: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  answerHeaderText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  miniBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7, borderWidth: 1 },
  miniBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  answerBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  securityText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  safeToggle: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  safeToggleText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  noResults: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingVertical: 24 },
  resultCard: { borderRadius: 12, borderWidth: 1, padding: 13, gap: 6 },
  resultTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  resultDomain: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  favicon: { width: 14, height: 14, borderRadius: 3 },
  resultUrl: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
  riskBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  riskBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  resultTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  resultSnippet: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  reasonsWrap: { gap: 2, marginTop: 2 },
  reasonText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  showHidden: { borderWidth: 1, borderStyle: "dashed", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  showHiddenText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  relatedWrap: { gap: 8, marginTop: 4 },
  relatedTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  relatedChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  relatedChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, maxWidth: "100%" },
  relatedChipText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
