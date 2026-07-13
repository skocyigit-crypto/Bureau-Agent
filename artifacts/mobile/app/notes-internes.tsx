import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { useAuth, API_BASE } from "@/contexts/AuthContext";
import { useOfflineCache } from "@/hooks/useOfflineCache";
import { useColors } from "@/hooks/useColors";
import { useInlineSuggest } from "@/hooks/useInlineSuggest";

interface Note {
  id: number;
  title?: string | null;
  content: string;
  color: string;
  pinned: boolean;
  tags?: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const COLOR_MAP: Record<string, string> = {
  default: "#ffffff",
  yellow:  "#fefce8",
  blue:    "#eff6ff",
  green:   "#f0fdf4",
  pink:    "#fdf2f8",
  violet:  "#f5f3ff",
  orange:  "#fff7ed",
};
const COLOR_ACCENTS: Record<string, string> = {
  default: "#e2e8f0",
  yellow:  "#fde68a",
  blue:    "#bfdbfe",
  green:   "#bbf7d0",
  pink:    "#fbcfe8",
  violet:  "#ddd6fe",
  orange:  "#fed7aa",
};
const COLORS = ["default", "yellow", "blue", "green", "pink", "violet", "orange"];
const DARK_CARD_COLORS: Record<string, string> = {
  default: "#1e293b",
  yellow:  "#1c1a05",
  blue:    "#0c1a2e",
  green:   "#052e16",
  pink:    "#2d0a1f",
  violet:  "#1a0f33",
  orange:  "#1c0f00",
};

function fmtDate(d: string) {
  const now = new Date();
  const dt = new Date(d);
  const diff = Math.floor((now.getTime() - dt.getTime()) / 1000);
  if (diff < 60) return "À l'instant";
  if (diff < 3600) return `${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h`;
  return dt.toLocaleDateString("fr-FR");
}

interface NoteCardProps {
  note: Note;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  isDark: boolean;
  onPress: () => void;
  onPin: () => void;
  onDelete: () => void;
}

function NoteCard({ note, colors, isDark, onPress, onPin, onDelete }: NoteCardProps) {
  const cardBg = isDark ? DARK_CARD_COLORS[note.color] ?? "#1e293b" : COLOR_MAP[note.color] ?? "#ffffff";
  const accent = COLOR_ACCENTS[note.color] ?? "#e2e8f0";
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.noteCard,
        { backgroundColor: cardBg, borderColor: accent },
        note.pinned && { borderTopWidth: 3, borderTopColor: "#f59e0b" },
        pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
      ]}
    >
      <View style={styles.noteCardHeader}>
        {note.pinned && <Feather name="bookmark" size={13} color="#f59e0b" style={{ marginRight: 4 }} />}
        {note.title ? (
          <Text style={[styles.noteTitle, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>{note.title}</Text>
        ) : (
          <Text style={[styles.noteTitle, { color: colors.mutedForeground, flex: 1, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
            {note.content.split("\n")[0] || "Note sans titre"}
          </Text>
        )}
        <View style={styles.noteCardActions}>
          <Pressable onPress={onPin} hitSlop={8} style={styles.noteActionBtn}>
            <Feather name="bookmark" size={14} color={note.pinned ? "#f59e0b" : colors.mutedForeground} />
          </Pressable>
          <Pressable onPress={onDelete} hitSlop={8} style={styles.noteActionBtn}>
            <Feather name="trash-2" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>
      <Text style={[styles.noteContent, { color: colors.mutedForeground }]} numberOfLines={4}>
        {note.content}
      </Text>
      {note.tags && note.tags.length > 0 && (
        <View style={styles.tagsRow}>
          {note.tags.slice(0, 3).map(t => (
            <View key={t} style={[styles.tagPill, { backgroundColor: accent }]}>
              <Text style={[styles.tagText, { color: colors.foreground }]}>{t}</Text>
            </View>
          ))}
        </View>
      )}
      <Text style={[styles.noteDate, { color: colors.mutedForeground }]}>{fmtDate(note.updatedAt)}</Text>
    </Pressable>
  );
}

interface NoteEditorProps {
  note?: Note | null;
  onSave: (data: { title: string; content: string; color: string; tags: string }) => void;
  onClose: () => void;
  saving: boolean;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  isDark: boolean;
}

function NoteEditor({ note, onSave, onClose, saving, colors, isDark }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [color, setColor] = useState(note?.color ?? "default");
  const [tags, setTags] = useState(note?.tags?.join(", ") ?? "");
  const cardBg = isDark ? DARK_CARD_COLORS[color] ?? "#1e293b" : COLOR_MAP[color] ?? "#ffffff";

  const { suggestion, clear, trackAccepted, trackDismissed } = useInlineSuggest({
    fieldType: "note",
    text: content,
    title: title || null,
  });
  const acceptSuggestion = useCallback(() => {
    if (!suggestion) return;
    setContent(prev => prev + suggestion);
    trackAccepted(suggestion.length);
    clear();
  }, [suggestion, clear, trackAccepted]);
  const dismissSuggestion = useCallback(() => {
    if (!suggestion) return;
    trackDismissed(suggestion.length);
    clear();
  }, [suggestion, clear, trackDismissed]);

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={[styles.editorOverlay, { backgroundColor: "rgba(0,0,0,0.5)" }]}>
        <View style={[styles.editorCard, { backgroundColor: cardBg, borderColor: COLOR_ACCENTS[color] ?? "#e2e8f0" }]}>
          <View style={styles.editorHeader}>
            <Pressable onPress={onClose} style={styles.editorCloseBtn}>
              <Feather name="x" size={18} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.editorTitle, { color: colors.foreground }]}>
              {note ? "Modifier la note" : "Nouvelle note"}
            </Text>
            <Pressable
              onPress={() => onSave({ title, content, color, tags })}
              disabled={saving || !content.trim()}
              style={[styles.editorSaveBtn, { backgroundColor: colors.primary, opacity: saving || !content.trim() ? 0.5 : 1 }]}
            >
              {saving
                ? <Feather name="loader" size={16} color="#fff" />
                : <Feather name="check" size={16} color="#fff" />
              }
            </Pressable>
          </View>

          <TextInput
            style={[styles.editorTitleInput, { color: colors.foreground, borderBottomColor: COLOR_ACCENTS[color] }]}
            placeholder="Titre (optionnel)"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
          />

          <TextInput
            style={[styles.editorContentInput, { color: colors.foreground }]}
            placeholder="Écrivez votre note ici..."
            placeholderTextColor={colors.mutedForeground}
            value={content}
            onChangeText={setContent}
            multiline
            autoFocus={!note}
            textAlignVertical="top"
          />

          {suggestion ? (
            <View style={styles.suggestionRow}>
              <Feather name="zap" size={12} color={colors.mutedForeground} />
              <Text
                style={[styles.suggestionText, { color: colors.mutedForeground }]}
                numberOfLines={3}
              >
                {suggestion}
              </Text>
              <Pressable
                onPress={acceptSuggestion}
                style={[styles.suggestionBtn, { borderColor: colors.primary }]}
                hitSlop={6}
              >
                <Text style={[styles.suggestionBtnText, { color: colors.primary }]}>
                  Ajouter
                </Text>
              </Pressable>
              <Pressable onPress={dismissSuggestion} hitSlop={8} style={styles.suggestionDismiss}>
                <Feather name="x" size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ) : null}

          <TextInput
            style={[styles.editorTagsInput, { color: colors.foreground, borderTopColor: COLOR_ACCENTS[color] }]}
            placeholder="Tags (séparés par des virgules)"
            placeholderTextColor={colors.mutedForeground}
            value={tags}
            onChangeText={setTags}
          />

          <View style={styles.colorRow}>
            {COLORS.map(c => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: isDark ? DARK_CARD_COLORS[c] : COLOR_MAP[c], borderColor: COLOR_ACCENTS[c] },
                  color === c && styles.colorDotSelected,
                ]}
              >
                {color === c && <Feather name="check" size={10} color={colors.foreground} />}
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </TouchableWithoutFeedback>
  );
}

export default function NotesInternesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { fetchAuth } = useAuth();
  const isWeb = Platform.OS === "web";
  const isDark = colors.background === "#0f172a" || colors.background === "#020817";

  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const { cached, isFromCache, updateCache } = useOfflineCache<Note[]>("notes_internes_list", []);

  const load = useCallback(async () => {
    try {
      const res = await fetchAuth(`${API_BASE}/api/notes-internes`);
      if (res.ok) {
        const list: Note[] = await res.json();
        setNotes(list);
        updateCache(list);
      }
    } catch {
      if (cached.length > 0 && notes.length === 0) setNotes(cached);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchAuth, cached, notes.length, updateCache]);

  useEffect(() => {
    if (isFromCache && cached.length > 0 && notes.length === 0) setNotes(cached);
  }, [isFromCache, cached, notes.length]);

  useEffect(() => { load(); }, [load]);

  function onRefresh() { setRefreshing(true); load(); }

  async function handleSave(data: { title: string; content: string; color: string; tags: string }) {
    if (!data.content.trim()) return;
    setSaving(true);
    try {
      const body = {
        title: data.title.trim() || null,
        content: data.content.trim(),
        color: data.color,
        tags: data.tags ? data.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
      };
      if (editing) {
        await fetchAuth(`${API_BASE}/api/notes-internes/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await fetchAuth(`${API_BASE}/api/notes-internes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      setEditing(null);
      setCreating(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handlePin(note: Note) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await fetchAuth(`${API_BASE}/api/notes-internes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !note.pinned }),
    });
    load();
  }

  async function handleDelete(note: Note) {
    if (Platform.OS === "web") {
      doDelete(note);
    } else {
      Alert.alert("Supprimer", `Supprimer cette note ?`, [
        { text: "Annuler", style: "cancel" },
        { text: "Supprimer", style: "destructive", onPress: () => doDelete(note) },
      ]);
    }
  }

  async function doDelete(note: Note) {
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setNotes(prev => prev.filter(n => n.id !== note.id));
    try {
      await fetchAuth(`${API_BASE}/api/notes-internes/${note.id}`, { method: "DELETE" });
      load();
    } catch { load(); }
  }

  const filtered = notes.filter(n => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (n.title?.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.tags?.some(t => t.toLowerCase().includes(q)));
  });

  const pinned = filtered.filter(n => n.pinned);
  const unpinned = filtered.filter(n => !n.pinned);
  const sorted = [...pinned, ...unpinned];

  const showEditor = creating || !!editing;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.secondary, paddingTop: (isWeb ? 67 : insets.top) + 12 }]}>
        <View style={styles.headerTop}>
          <Pressable onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color="#fff" />
          </Pressable>
          <Text style={styles.headerTitle}>Notes internes</Text>
          {isFromCache && (
            <View style={[styles.cacheBadge, { backgroundColor: "rgba(255,255,255,0.12)" }]}>
              <Feather name="wifi-off" size={10} color="rgba(255,255,255,0.6)" />
              <Text style={styles.cacheText}>Cache</Text>
            </View>
          )}
        </View>
        <View style={[styles.searchContainer, { backgroundColor: "rgba(255,255,255,0.1)" }]}>
          <Feather name="search" size={16} color="rgba(255,255,255,0.5)" />
          <TextInput
            style={styles.searchInput}
            placeholder="Rechercher une note..."
            placeholderTextColor="rgba(255,255,255,0.4)"
            value={search}
            onChangeText={setSearch}
          />
          {search ? <Feather name="x" size={16} color="rgba(255,255,255,0.5)" onPress={() => setSearch("")} /> : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={item => item.id.toString()}
          numColumns={2}
          columnWrapperStyle={styles.columnWrapper}
          contentContainerStyle={[styles.listContent, { paddingBottom: isWeb ? 118 : 100 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            notes.length > 0 ? (
              <View style={styles.statsRow}>
                <Text style={[styles.statsText, { color: colors.mutedForeground }]}>
                  {notes.length} note{notes.length !== 1 ? "s" : ""}
                  {pinned.length > 0 ? ` · ${pinned.length} épinglée${pinned.length !== 1 ? "s" : ""}` : ""}
                </Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="file-text"
              title="Aucune note"
              subtitle={search ? "Aucune note ne correspond à votre recherche." : "Appuyez sur + pour créer votre première note."}
            />
          }
          renderItem={({ item }) => (
            <View style={styles.noteCardWrapper}>
              <NoteCard
                note={item}
                colors={colors}
                isDark={isDark}
                onPress={() => setEditing(item)}
                onPin={() => handlePin(item)}
                onDelete={() => handleDelete(item)}
              />
            </View>
          )}
        />
      )}

      <Pressable
        style={[styles.fab, { backgroundColor: colors.primary }]}
        onPress={() => { setEditing(null); setCreating(true); }}
      >
        <Feather name="plus" size={24} color="#fff" />
      </Pressable>

      {showEditor && (
        <NoteEditor
          note={editing}
          onSave={handleSave}
          onClose={() => { setEditing(null); setCreating(false); }}
          saving={saving}
          colors={colors}
          isDark={isDark}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold", color: "#ffffff", flex: 1 },
  cacheBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  cacheText: { fontSize: 10, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.6)" },
  searchContainer: { flexDirection: "row", alignItems: "center", borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8 },
  searchInput: { flex: 1, color: "#ffffff", fontSize: 14, fontFamily: "Inter_400Regular" },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { padding: 12 },
  columnWrapper: { gap: 8 },
  statsRow: { paddingHorizontal: 4, paddingBottom: 8 },
  statsText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  noteCardWrapper: { flex: 1 },
  noteCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  noteCardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  noteTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noteCardActions: { flexDirection: "row", gap: 4 },
  noteActionBtn: { padding: 4 },
  noteContent: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18, marginBottom: 8 },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginBottom: 6 },
  tagPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  tagText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  noteDate: { fontSize: 10, fontFamily: "Inter_400Regular", textAlign: "right" },
  fab: { position: "absolute", right: 20, bottom: 90, width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 5 },
  editorOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "flex-end" },
  editorCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 16, paddingBottom: 32, maxHeight: "90%" },
  editorHeader: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  editorCloseBtn: { padding: 4, marginRight: 8 },
  editorTitle: { flex: 1, fontSize: 16, fontFamily: "Inter_600SemiBold" },
  editorSaveBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  editorTitleInput: { fontSize: 16, fontFamily: "Inter_600SemiBold", paddingVertical: 8, borderBottomWidth: 1, marginBottom: 12 },
  editorContentInput: { fontSize: 14, fontFamily: "Inter_400Regular", minHeight: 120, marginBottom: 12, lineHeight: 22 },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  suggestionText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  suggestionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
  },
  suggestionBtnText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  suggestionDismiss: {
    padding: 2,
  },
  editorTagsInput: { fontSize: 13, fontFamily: "Inter_400Regular", paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  colorRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  colorDot: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  colorDotSelected: { transform: [{ scale: 1.2 }] },
});
