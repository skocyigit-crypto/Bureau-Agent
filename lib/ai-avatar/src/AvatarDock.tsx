import { useCallback, useEffect, useRef, useState } from "react";
import { TalkingAvatar, type TalkingAvatarHandle } from "./TalkingAvatar";
import type { SpeechLang } from "./useTextToSpeech";
import type { AvatarPalette } from "./AvatarFace";

export interface AvatarDockProps {
  /** Latest assistant reply to speak when it changes (if voice is on). */
  text?: string;
  /** Default spoken language when nothing is persisted yet. */
  defaultLang?: SpeechLang;
  /** Avatar diameter in px. Default 44. */
  size?: number;
  /** Accent color for the active language pill / ring. Default violet. */
  accent?: string;
  /** Persist voice on/off + language under this key (localStorage). */
  storageKey?: string;
  /**
   * When true (default) the latest `text` is spoken automatically as it changes
   * — ideal for chat screens. Set false on summary/briefing screens so nothing
   * speaks on load; the user replays on demand with the replay button.
   */
  autoSpeak?: boolean;
  /** Visual theme for the controls. Default "light". */
  theme?: "light" | "dark";
  palette?: Partial<AvatarPalette>;
  className?: string;
}

interface Persisted {
  on: boolean;
  lang: SpeechLang;
}

function loadPrefs(key: string | undefined, defaultLang: SpeechLang): Persisted {
  if (!key || typeof window === "undefined") return { on: true, lang: defaultLang };
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Persisted>;
      return {
        on: typeof p.on === "boolean" ? p.on : true,
        lang: p.lang === "tr" || p.lang === "fr" ? p.lang : defaultLang,
      };
    }
  } catch {
    /* ignore corrupt prefs */
  }
  return { on: true, lang: defaultLang };
}

/**
 * Self-contained avatar with controls: FR/TR toggle, mute, replay/stop, and a
 * "no voice on this device" hint. Persists the voice on/off + language choice
 * so the user's preference survives navigation. Speech stays on-device.
 */
export function AvatarDock({
  text,
  defaultLang = "fr",
  size = 44,
  accent = "#a855f7",
  storageKey,
  autoSpeak = true,
  theme = "light",
  palette,
  className,
}: AvatarDockProps) {
  const init = loadPrefs(storageKey, defaultLang);
  const [voiceOn, setVoiceOn] = useState(init.on);
  const [voiceLang, setVoiceLang] = useState<SpeechLang>(init.lang);
  const [speaking, setSpeaking] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const avatarRef = useRef<TalkingAvatarHandle>(null);
  const lastText = useRef<string>("");

  useEffect(() => {
    if (text && text.trim()) lastText.current = text;
  }, [text]);

  useEffect(() => {
    if (!storageKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ on: voiceOn, lang: voiceLang }));
    } catch {
      /* ignore quota / private mode */
    }
  }, [storageKey, voiceOn, voiceLang]);

  const onAvailability = useCallback((a: { supported: boolean; hasVoiceForLang: boolean }) => {
    setUnavailable(a.supported && !a.hasVoiceForLang);
  }, []);

  const replay = () => {
    if (speaking) {
      avatarRef.current?.stop();
    } else if (lastText.current.trim()) {
      avatarRef.current?.speak(lastText.current, voiceLang);
    }
  };

  const mutedColor = theme === "dark" ? "rgba(255,255,255,0.4)" : "#9ca3af";
  const iconColor = theme === "dark" ? "rgba(255,255,255,0.8)" : "#4b5563";
  const pillIdle =
    theme === "dark" ? "transparent" : "rgba(0,0,0,0.04)";
  const pillIdleText = theme === "dark" ? "rgba(255,255,255,0.6)" : "#6b7280";
  const borderColor = theme === "dark" ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.12)";

  return (
    <div className={className} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "9999px",
          overflow: "hidden",
          flexShrink: 0,
          boxShadow: `0 0 0 2px ${accent}40`,
        }}
      >
        <TalkingAvatar
          ref={avatarRef}
          text={voiceOn && autoSpeak ? text : ""}
          lang={voiceLang}
          autoPlay={voiceOn && autoSpeak}
          size={size}
          palette={{ ring: accent, ...palette }}
          onStart={() => setSpeaking(true)}
          onEnd={() => setSpeaking(false)}
          onAvailability={onAvailability}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <div
          style={{
            display: "flex",
            border: `1px solid ${borderColor}`,
            borderRadius: 6,
            overflow: "hidden",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {(["fr", "tr"] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setVoiceLang(l)}
              style={{
                padding: "3px 8px",
                cursor: "pointer",
                border: "none",
                background: voiceLang === l ? accent : pillIdle,
                color: voiceLang === l ? "#fff" : pillIdleText,
              }}
              aria-pressed={voiceLang === l}
              aria-label={l === "fr" ? "Français" : "Turc"}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setVoiceOn((v) => !v)}
          title={voiceOn ? "Couper la voix" : "Activer la voix"}
          aria-label={voiceOn ? "Couper la voix" : "Activer la voix"}
          style={iconBtn(iconColor)}
        >
          {voiceOn ? <IconVolumeOn /> : <IconVolumeOff color={mutedColor} />}
        </button>

        <button
          type="button"
          onClick={replay}
          disabled={!voiceOn || (!speaking && !lastText.current.trim())}
          title={speaking ? "Arrêter" : "Réécouter la dernière réponse"}
          aria-label={speaking ? "Arrêter" : "Réécouter"}
          style={{
            ...iconBtn(iconColor),
            opacity: !voiceOn || (!speaking && !lastText.current.trim()) ? 0.4 : 1,
            cursor: !voiceOn || (!speaking && !lastText.current.trim()) ? "default" : "pointer",
          }}
        >
          {speaking ? <IconStop /> : <IconReplay />}
        </button>
      </div>

      {voiceOn && unavailable && (
        <span
          style={{
            fontSize: 10,
            lineHeight: 1.2,
            maxWidth: 130,
            color: theme === "dark" ? "rgba(255,255,255,0.55)" : "#9ca3af",
          }}
        >
          Voix indisponible sur cet appareil
        </span>
      )}
    </div>
  );
}

function iconBtn(color: string): React.CSSProperties {
  return {
    width: 28,
    height: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color,
    cursor: "pointer",
  };
}

function IconVolumeOn() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function IconVolumeOff({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}

function IconReplay() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}
