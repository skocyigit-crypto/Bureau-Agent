import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";

import { TalkingAvatar, type TalkingAvatarHandle } from "@/components/TalkingAvatar";

export interface AvatarDockProps {
  /** Latest assistant reply to speak when it changes (if voice is on). */
  text?: string;
  /** Default spoken language until a stored preference exists. */
  defaultLang?: "fr" | "tr";
  /** Avatar diameter. Default 40. */
  size?: number;
  /** Persist voice on/off + language under this key. */
  storageKey?: string;
  /**
   * When true (default) the latest `text` is spoken automatically as it changes
   * — ideal for chat screens. Set false on summary/briefing screens so nothing
   * speaks on load; the user replays on demand with the replay button.
   */
  autoSpeak?: boolean;
}

function haptic() {
  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/**
 * Reusable header avatar with controls (FR/TR, mute, replay/stop) plus a
 * "no voice on this device" hint, persisting the user's voice preference.
 * Speech is on-device via expo-speech.
 */
export function AvatarDock({ text, defaultLang = "fr", size = 40, storageKey, autoSpeak = true }: AvatarDockProps) {
  const [voiceOn, setVoiceOn] = useState(true);
  const [voiceLang, setVoiceLang] = useState<"fr" | "tr">(defaultLang);
  const [speaking, setSpeaking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [loaded, setLoaded] = useState(!storageKey);
  const avatarRef = useRef<TalkingAvatarHandle>(null);
  const lastText = useRef("");

  useEffect(() => {
    if (text && text.trim()) lastText.current = text;
  }, [text]);

  // load persisted prefs once
  useEffect(() => {
    if (!storageKey) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(storageKey);
        if (raw && !cancelled) {
          const p = JSON.parse(raw) as { on?: boolean; lang?: string };
          if (typeof p.on === "boolean") setVoiceOn(p.on);
          if (p.lang === "fr" || p.lang === "tr") setVoiceLang(p.lang);
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // persist on change (after initial load to avoid clobbering)
  useEffect(() => {
    if (!storageKey || !loaded) return;
    AsyncStorage.setItem(storageKey, JSON.stringify({ on: voiceOn, lang: voiceLang })).catch(() => {});
  }, [storageKey, loaded, voiceOn, voiceLang]);

  const onAvailability = useCallback((a: { hasVoice: boolean }) => {
    setUnavailable(!a.hasVoice);
  }, []);

  const replay = () => {
    haptic();
    if (speaking) {
      avatarRef.current?.stop();
    } else if (lastText.current.trim()) {
      avatarRef.current?.speak(lastText.current);
    }
  };

  const canReplay = voiceOn && (speaking || !!lastText.current.trim());

  return (
    <View style={styles.row}>
      <View style={[styles.avatarWrap, { width: size + 4, height: size + 4, borderRadius: (size + 4) / 2 }]}>
        <TalkingAvatar
          ref={avatarRef}
          text={voiceOn && autoSpeak && loaded ? text : ""}
          lang={voiceLang}
          size={size}
          muted={!voiceOn}
          autoPlay={autoSpeak && loaded}
          onAvailability={onAvailability}
          onSpeakingChange={setSpeaking}
        />
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => {
            haptic();
            setVoiceLang((l) => (l === "fr" ? "tr" : "fr"));
          }}
          style={styles.langBtn}
          hitSlop={8}
        >
          <Text style={styles.langTxt}>{voiceLang.toUpperCase()}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            haptic();
            setVoiceOn((v) => !v);
          }}
          style={styles.iconBtn}
          hitSlop={10}
        >
          <Feather name={voiceOn ? "volume-2" : "volume-x"} size={16} color="rgba(255,255,255,0.85)" />
        </Pressable>

        <Pressable onPress={replay} disabled={!canReplay} style={[styles.iconBtn, !canReplay && styles.disabled]} hitSlop={10}>
          <Feather name={speaking ? "square" : "rotate-ccw"} size={15} color="rgba(255,255,255,0.85)" />
        </Pressable>
      </View>

      {voiceOn && unavailable && <Text style={styles.hint}>Voix indisponible</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  avatarWrap: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  controls: { flexDirection: "row", alignItems: "center", gap: 4 },
  langBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  langTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
  iconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  disabled: { opacity: 0.4 },
  hint: { color: "rgba(255,255,255,0.55)", fontSize: 10, maxWidth: 90 },
});
