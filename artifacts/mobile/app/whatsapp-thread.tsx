import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

interface Conversation {
  id: number;
  customerPhone: string;
  customerName: string | null;
  status: string;
  unreadCount: number;
  draftReply: string | null;
  draftStatus: string;
  draftError: string | null;
}

interface Message {
  id: number;
  conversationId: number;
  direction: string;
  body: string | null;
  mediaUrls: string[];
  createdAt: string;
}

export default function WhatsappThreadScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const conversationId = Number(Array.isArray(idParam) ? idParam[0] : idParam);

  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const listRef = useRef<FlatList<Message>>(null);
  // Empêche d'écraser ce que l'utilisateur a tapé/édité avec un brouillon IA.
  const userEditedRef = useRef(false);
  // Mémorise le dernier brouillon déjà inséré pour ne pas le ré-appliquer.
  const appliedDraftRef = useRef<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!Number.isFinite(conversationId)) return;
    try {
      const res = await fetchAuth(`${API_BASE}/api/whatsapp/conversations/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setConv(data.conversation ?? null);
        setMessages(data.messages ?? []);
      }
    } catch {
      // Silencieux : l'utilisateur peut réessayer via le bouton retour/entrée.
    } finally {
      setLoading(false);
    }
  }, [conversationId, fetchAuth]);

  useEffect(() => {
    setLoading(true);
    fetchDetail();
  }, [fetchDetail]);

  // Pré-remplit le composer avec le brouillon IA quand il est prêt, sauf si
  // l'utilisateur a déjà écrit/édité ou si ce brouillon précis est déjà inséré.
  useEffect(() => {
    if (!conv) return;
    if (conv.draftStatus === "ready" && conv.draftReply) {
      if (!userEditedRef.current && composer.trim() === "" && appliedDraftRef.current !== conv.draftReply) {
        appliedDraftRef.current = conv.draftReply;
        setComposer(conv.draftReply);
      }
    }
  }, [conv]);

  // Tant que l'IA rédige, on interroge le détail en arrière-plan jusqu'à ce que
  // le statut se stabilise (ready / failed) — équivalent mobile du SSE web.
  // GARDE-FOU: on borne le polling (~60 s). Sans cela, un /draft qui échoue
  // côté serveur ou des GET détail répétés en erreur laisseraient le statut
  // "generating" pour toujours → boucle de polling infinie + composer figé.
  useEffect(() => {
    if (conv?.draftStatus !== "generating") {
      setDrafting(false);
      return;
    }
    setDrafting(true);
    let attempts = 0;
    const MAX_ATTEMPTS = 24; // 24 × 2.5 s = 60 s
    const interval = setInterval(async () => {
      attempts += 1;
      await fetchDetail();
      if (attempts >= MAX_ATTEMPTS) {
        clearInterval(interval);
        // Si après le budget de temps le statut est toujours "generating",
        // on bascule localement en échec récupérable et on stoppe la boucle.
        setConv((prev) =>
          prev && prev.draftStatus === "generating"
            ? { ...prev, draftStatus: "failed", draftError: "Le brouillon IA a expiré. Réessayez." }
            : prev,
        );
        setDrafting(false);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [conv?.draftStatus, fetchDetail]);

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  async function handleRegenerate() {
    if (!conv || drafting) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // On autorise un nouveau pré-remplissage du composer s'il est encore vide.
    if (composer.trim() === "") {
      userEditedRef.current = false;
      appliedDraftRef.current = null;
    }
    setDrafting(true);
    setConv((prev) => (prev ? { ...prev, draftStatus: "generating", draftError: null } : prev));
    try {
      const res = await fetchAuth(`${API_BASE}/api/whatsapp/conversations/${conv.id}/draft`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // Échec immédiat (quota, erreur serveur…) : on sort de "generating"
        // pour ne pas lancer une boucle de polling qui ne se terminerait jamais.
        setConv((prev) =>
          prev ? { ...prev, draftStatus: "failed", draftError: err.error || "Impossible de lancer la génération du brouillon." } : prev,
        );
        setDrafting(false);
        return;
      }
      // Le polling déclenché par draftStatus="generating" récupérera le résultat.
      fetchDetail();
    } catch {
      setConv((prev) =>
        prev ? { ...prev, draftStatus: "failed", draftError: "Erreur réseau lors de la génération du brouillon." } : prev,
      );
      setDrafting(false);
    }
  }

  async function handleSend() {
    if (!conv || composer.trim() === "" || sending) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const text = composer.trim();
    setSending(true);
    try {
      const res = await fetchAuth(`${API_BASE}/api/whatsapp/conversations/${conv.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        setComposer("");
        userEditedRef.current = false;
        appliedDraftRef.current = null;
        await fetchDetail();
      } else {
        const err = await res.json().catch(() => ({}));
        if (Platform.OS === "web") {
          // eslint-disable-next-line no-alert
          window.alert(err.error || "Échec de l'envoi du message.");
        } else {
          Alert.alert("Envoi impossible", err.error || "Échec de l'envoi du message.");
        }
      }
    } catch {
      if (Platform.OS === "web") {
        window.alert("Erreur réseau lors de l'envoi.");
      } else {
        Alert.alert("Erreur", "Erreur réseau lors de l'envoi.");
      }
    } finally {
      setSending(false);
    }
  }

  async function toggleStatus() {
    if (!conv) return;
    const next = conv.status === "closed" ? "open" : "closed";
    setConv((prev) => (prev ? { ...prev, status: next } : prev));
    try {
      await fetchAuth(`${API_BASE}/api/whatsapp/conversations/${conv.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
    } catch {
      fetchDetail();
    }
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  }

  const title = conv?.customerName || conv?.customerPhone || "Conversation";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color="#ffffff" />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            {conv?.customerName ? (
              <Text style={styles.headerSub} numberOfLines={1}>{conv.customerPhone}</Text>
            ) : null}
          </View>
          {conv ? (
            <Pressable onPress={toggleStatus} hitSlop={12}>
              <Feather name={conv.status === "closed" ? "rotate-ccw" : "check-circle"} size={20} color="#ffffff" />
            </Pressable>
          ) : (
            <View style={{ width: 20 }} />
          )}
        </View>
      </View>

      {loading && messages.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.threadContent}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.emptyThread}>
                <Feather name="message-circle" size={36} color={colors.mutedForeground} />
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>Aucun message pour l'instant</Text>
              </View>
            }
            renderItem={({ item }) => {
              const outbound = item.direction === "outbound";
              return (
                <View style={[styles.bubbleRow, { justifyContent: outbound ? "flex-end" : "flex-start" }]}>
                  <View
                    style={[
                      styles.bubble,
                      outbound
                        ? { backgroundColor: "#DCF8C6", borderBottomRightRadius: 4 }
                        : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 },
                    ]}
                  >
                    {item.body ? (
                      <Text style={[styles.bubbleText, { color: outbound ? "#0b2e13" : colors.foreground }]}>{item.body}</Text>
                    ) : null}
                    {item.mediaUrls?.length > 0 ? (
                      <View style={styles.mediaRow}>
                        <Feather name="paperclip" size={12} color={outbound ? "#0b2e13" : colors.mutedForeground} />
                        <Text style={[styles.mediaText, { color: outbound ? "#0b2e13" : colors.mutedForeground }]}>
                          {item.mediaUrls.length} pièce(s) jointe(s)
                        </Text>
                      </View>
                    ) : null}
                    <Text style={[styles.bubbleTime, { color: outbound ? "#3a6b3a" : colors.mutedForeground }]}>
                      {formatTime(item.createdAt)}
                    </Text>
                  </View>
                </View>
              );
            }}
          />

          {conv?.draftStatus === "failed" && conv.draftError ? (
            <View style={[styles.draftError, { backgroundColor: "#ef444415" }]}>
              <Feather name="alert-triangle" size={13} color="#ef4444" />
              <Text style={[styles.draftErrorText, { color: "#ef4444" }]}>{conv.draftError}</Text>
            </View>
          ) : null}

          <View style={[styles.composerWrap, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: (isWeb ? 12 : insets.bottom) + 8 }]}>
            <View style={styles.draftBar}>
              <Pressable
                onPress={handleRegenerate}
                disabled={drafting}
                style={({ pressed }) => [styles.draftBtn, { backgroundColor: colors.primary + "15" }, (pressed || drafting) && { opacity: 0.6 }]}
              >
                {drafting ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="cpu" size={14} color={colors.primary} />
                )}
                <Text style={[styles.draftBtnText, { color: colors.primary }]}>
                  {drafting ? "IA rédige…" : "Brouillon IA"}
                </Text>
              </Pressable>
              <Text style={[styles.charCount, { color: colors.mutedForeground }]}>{composer.length}</Text>
            </View>
            <View style={styles.composerRow}>
              <TextInput
                style={[styles.composerInput, { backgroundColor: colors.background, color: colors.foreground, borderColor: colors.border }]}
                placeholder="Relire, modifier, puis envoyer…"
                placeholderTextColor={colors.mutedForeground}
                value={composer}
                onChangeText={(t) => {
                  userEditedRef.current = true;
                  setComposer(t);
                }}
                multiline
              />
              <Pressable
                onPress={handleSend}
                disabled={composer.trim() === "" || sending}
                style={({ pressed }) => [
                  styles.sendBtn,
                  { backgroundColor: composer.trim() === "" || sending ? colors.mutedForeground : colors.primary },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Feather name="send" size={18} color="#fff" />
                )}
              </Pressable>
            </View>
            <Text style={[styles.safetyNote, { color: colors.mutedForeground }]}>
              Rien n'est envoyé sans votre validation.
            </Text>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 14 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: "#ffffff" },
  headerSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: "rgba(255,255,255,0.7)", marginTop: 1 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  threadContent: { padding: 16, gap: 8, flexGrow: 1 },
  emptyThread: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  bubbleRow: { flexDirection: "row" },
  bubble: { maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  bubbleText: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 19 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 4, alignSelf: "flex-end" },
  mediaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  mediaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  draftError: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  draftErrorText: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1 },
  composerWrap: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingTop: 10 },
  draftBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  draftBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  draftBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  charCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  composerInput: { flex: 1, minHeight: 44, maxHeight: 130, borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 14, fontFamily: "Inter_400Regular" },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  safetyNote: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
});
