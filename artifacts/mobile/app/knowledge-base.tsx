import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

interface KbStatus {
  totalDocuments: number;
  indexableDocuments: number;
  indexedDocuments: number;
  staleDocuments: number;
  totalChunks: number;
  embeddedChunks: number;
  searchMode: "semantic" | "lexical";
  lastIndexedAt: string | null;
}

interface KbSource {
  ref: number;
  documentId: number;
  fileName: string;
  score: number;
  snippet: string;
}

interface KbAnswer {
  answer: string;
  sources: KbSource[];
  grounded: boolean;
}

const EXAMPLE_QUESTIONS = [
  "Quelle est notre politique de congés ?",
  "Quel est le délai de remboursement client ?",
  "Quelles sont nos conditions de paiement ?",
];

export default function KnowledgeBaseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth, user } = useAuth();
  const isWeb = Platform.OS === "web";
  const isAdmin = user?.role === "super_admin" || user?.role === "administrateur";

  const [status, setStatus] = useState<KbStatus | null>(null);
  const [reindexing, setReindexing] = useState(false);

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [result, setResult] = useState<KbAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/knowledge-base/status`);
      if (res.ok) setStatus((await res.json()) as KbStatus);
    } catch {
      // Statut non bloquant.
    }
  }, [fetchAuth]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleReindex = useCallback(async () => {
    setReindexing(true);
    setError(null);
    try {
      const res = await fetchAuth(`${API_BASE}/api/knowledge-base/reindex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: false }),
      });
      const data = (await res.json()) as {
        error?: string;
        status?: KbStatus;
      };
      if (!res.ok) throw new Error(data.error || "Échec de l'indexation");
      if (data.status) setStatus(data.status);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Indexation impossible");
    } finally {
      setReindexing(false);
    }
  }, [fetchAuth]);

  const handleAsk = useCallback(
    async (q?: string) => {
      const text = (q ?? question).trim();
      if (!text) return;
      if (q) setQuestion(q);
      setAsking(true);
      setResult(null);
      setError(null);
      try {
        const res = await fetchAuth(`${API_BASE}/api/knowledge-base/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
        });
        const data = (await res.json()) as KbAnswer & { error?: string };
        if (!res.ok) throw new Error(data.error || "Échec de la recherche");
        setResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Recherche impossible");
      } finally {
        setAsking(false);
      }
    },
    [question, fetchAuth],
  );

  const hasIndex = (status?.totalChunks ?? 0) > 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: "#1e293b", paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Base de connaissances</Text>
        </View>
        <Text style={styles.headerSub}>
          Posez une question, obtenez une réponse fondée sur vos documents.
        </Text>
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
          {/* Statut */}
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.statusRow}>
              <StatItem icon="file-text" label="Indexables" value={status?.indexableDocuments ?? 0} colors={colors} />
              <StatItem icon="cpu" label="Indexés" value={status?.indexedDocuments ?? 0} colors={colors} />
              <StatItem icon="book-open" label="Extraits" value={status?.totalChunks ?? 0} colors={colors} />
            </View>
            <View style={styles.statusFooter}>
              {status && (
                <View style={[styles.modeBadge, { backgroundColor: colors.primary + "18" }]}>
                  <Feather
                    name={status.searchMode === "semantic" ? "zap" : "search"}
                    size={11}
                    color={colors.primary}
                  />
                  <Text style={[styles.modeBadgeText, { color: colors.primary }]}>
                    {status.searchMode === "semantic" ? "Recherche sémantique" : "Recherche par mots-clés"}
                  </Text>
                </View>
              )}
              {isAdmin && (
                <Pressable
                  onPress={() => void handleReindex()}
                  disabled={reindexing}
                  style={({ pressed }) => [
                    styles.reindexBtn,
                    { borderColor: colors.border },
                    pressed && { opacity: 0.7 },
                    reindexing && { opacity: 0.5 },
                  ]}
                >
                  {reindexing ? (
                    <ActivityIndicator size="small" color={colors.foreground} />
                  ) : (
                    <Feather name="refresh-cw" size={13} color={colors.foreground} />
                  )}
                  <Text style={[styles.reindexText, { color: colors.foreground }]}>
                    {reindexing ? "Indexation…" : "Indexer"}
                  </Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Question */}
          <View style={[styles.askCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TextInput
              style={[styles.askInput, { color: colors.foreground, borderColor: colors.border }]}
              placeholder="Ex. : Quelle est notre politique de congés ?"
              placeholderTextColor={colors.mutedForeground}
              value={question}
              onChangeText={setQuestion}
              multiline
              maxLength={1000}
            />
            <Pressable
              onPress={() => void handleAsk()}
              disabled={asking || !question.trim()}
              style={({ pressed }) => [
                styles.askBtn,
                { backgroundColor: colors.primary },
                pressed && { opacity: 0.85 },
                (asking || !question.trim()) && { opacity: 0.5 },
              ]}
            >
              {asking ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="send" size={15} color={colors.primaryForeground} />
              )}
              <Text style={[styles.askBtnText, { color: colors.primaryForeground }]}>
                {asking ? "Recherche…" : "Demander"}
              </Text>
            </Pressable>

            {hasIndex && !result && !asking && (
              <View style={styles.examplesWrap}>
                {EXAMPLE_QUESTIONS.map((ex) => (
                  <Pressable
                    key={ex}
                    onPress={() => void handleAsk(ex)}
                    style={[styles.exampleChip, { backgroundColor: colors.background, borderColor: colors.border }]}
                  >
                    <Text style={[styles.exampleText, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {ex}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {!hasIndex && status && (
              <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
                Aucun document indexé pour le moment. {isAdmin ? "Lancez l'indexation ci-dessus." : "Demandez à un administrateur de lancer l'indexation."}
              </Text>
            )}
          </View>

          {error && (
            <View style={[styles.errorCard, { backgroundColor: colors.destructive + "12", borderColor: colors.destructive + "40" }]}>
              <Feather name="alert-triangle" size={15} color={colors.destructive} />
              <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            </View>
          )}

          {/* Réponse */}
          {result && !asking && (
            <View style={[styles.answerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.answerHeader}>
                <Feather name="message-circle" size={15} color={colors.primary} />
                <Text style={[styles.answerHeaderText, { color: colors.foreground }]}>Réponse</Text>
                <View style={[styles.groundedBadge, { backgroundColor: (result.grounded ? colors.primary : colors.mutedForeground) + "18" }]}>
                  <Text style={[styles.groundedText, { color: result.grounded ? colors.primary : colors.mutedForeground }]}>
                    {result.grounded ? `${result.sources.length} source(s)` : "Hors périmètre"}
                  </Text>
                </View>
              </View>

              <Text style={[styles.answerBody, { color: colors.foreground }]}>{result.answer}</Text>

              {result.sources.length > 0 && (
                <View style={styles.sourcesWrap}>
                  <Text style={[styles.sourcesTitle, { color: colors.mutedForeground }]}>SOURCES</Text>
                  {result.sources.map((s) => (
                    <View
                      key={s.ref}
                      style={[styles.sourceItem, { backgroundColor: colors.background, borderColor: colors.border }]}
                    >
                      <View style={styles.sourceHead}>
                        <View style={[styles.sourceRef, { backgroundColor: colors.primary + "18" }]}>
                          <Text style={[styles.sourceRefText, { color: colors.primary }]}>{s.ref}</Text>
                        </View>
                        <Feather name="file-text" size={12} color={colors.mutedForeground} />
                        <Text style={[styles.sourceName, { color: colors.foreground }]} numberOfLines={1}>
                          {s.fileName}
                        </Text>
                      </View>
                      <Text style={[styles.sourceSnippet, { color: colors.mutedForeground }]} numberOfLines={3}>
                        {s.snippet}…
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function StatItem({
  icon,
  label,
  value,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: number;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.statItem}>
      <Feather name={icon} size={14} color={colors.mutedForeground} />
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff", flex: 1 },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular", color: "#cbd5e1", lineHeight: 18 },
  scrollContent: { padding: 16, gap: 14 },
  statusCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  statusRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center", gap: 3 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statusFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  modeBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  modeBadgeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  reindexBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  reindexText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  askCard: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  askInput: { minHeight: 70, borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, fontFamily: "Inter_400Regular", textAlignVertical: "top" },
  askBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, borderRadius: 10 },
  askBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  examplesWrap: { gap: 6, marginTop: 2 },
  exampleChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  exampleText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  hintText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  errorCard: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 10, borderWidth: 1 },
  errorText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  answerCard: { borderRadius: 12, borderWidth: 1, padding: 16, gap: 12 },
  answerHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  answerHeaderText: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  groundedBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  groundedText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  answerBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  sourcesWrap: { gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#94a3b8", paddingTop: 12 },
  sourcesTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  sourceItem: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 5 },
  sourceHead: { flexDirection: "row", alignItems: "center", gap: 7 },
  sourceRef: { width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  sourceRefText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  sourceName: { fontSize: 13, fontFamily: "Inter_600SemiBold", flex: 1 },
  sourceSnippet: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
