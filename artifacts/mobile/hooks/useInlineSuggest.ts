import { useCallback, useEffect, useRef, useState } from "react";

import { API_BASE, useAuth } from "@/contexts/AuthContext";

export const INLINE_SUGGEST_LANGUAGES: { value: string; label: string }[] = [
  { value: "francais", label: "Français" },
  { value: "english", label: "English" },
  { value: "deutsch", label: "Deutsch" },
  { value: "espanol", label: "Español" },
  { value: "italiano", label: "Italiano" },
  { value: "portugues", label: "Português" },
  { value: "nederlands", label: "Nederlands" },
  { value: "turkce", label: "Türkçe" },
  { value: "arabic", label: "العربية" },
];
export const VALID_INLINE_SUGGEST_LANGUAGES: Set<string> = new Set(
  INLINE_SUGGEST_LANGUAGES.map(l => l.value),
);
export const DEFAULT_INLINE_SUGGEST_LANGUAGE = "francais";

export type InlineSuggestFieldType =
  | "note"
  | "prospect_note"
  | "email_body"
  | "call_note"
  | "task_description"
  | "message_content"
  | "project_description"
  | "project_note"
  | "quote_comment"
  | "invoice_comment";

export type InlineSuggestConfigurableField = "note" | "prospect_note" | "email_body";

export const INLINE_SUGGEST_CONFIGURABLE_FIELDS: ReadonlyArray<InlineSuggestConfigurableField> = [
  "note",
  "prospect_note",
  "email_body",
];

export type InlineSuggestFieldFlags = Record<InlineSuggestConfigurableField, boolean>;

const DEFAULT_INLINE_SUGGEST_FIELDS: InlineSuggestFieldFlags = {
  note: true,
  prospect_note: true,
  email_body: true,
};

function isConfigurableField(field: InlineSuggestFieldType): field is InlineSuggestConfigurableField {
  return field === "note" || field === "prospect_note" || field === "email_body";
}

function normalizeFieldFlags(value: unknown): InlineSuggestFieldFlags {
  if (!value || typeof value !== "object") return { ...DEFAULT_INLINE_SUGGEST_FIELDS };
  const src = value as Record<string, unknown>;
  return {
    note: typeof src.note === "boolean" ? src.note : true,
    prospect_note: typeof src.prospect_note === "boolean" ? src.prospect_note : true,
    email_body: typeof src.email_body === "boolean" ? src.email_body : true,
  };
}

interface PreferencesState {
  enabled: boolean;
  language: string;
  fields: InlineSuggestFieldFlags;
  loaded: boolean;
}

interface CacheEntry {
  state: PreferencesState;
  listeners: Set<(s: PreferencesState) => void>;
  fetchedFor: string | null;
}

const cache: CacheEntry = {
  state: {
    enabled: true,
    language: DEFAULT_INLINE_SUGGEST_LANGUAGE,
    fields: { ...DEFAULT_INLINE_SUGGEST_FIELDS },
    loaded: false,
  },
  listeners: new Set(),
  fetchedFor: null,
};

function setState(next: Partial<PreferencesState>) {
  cache.state = { ...cache.state, ...next };
  for (const fn of cache.listeners) fn(cache.state);
}

/**
 * Loads and persists the user's inline-suggest preferences via
 * /api/me/preferences. Cached in-memory and shared across all hook
 * consumers so settings and editor screens stay in sync without
 * refetching.
 */
export function useInlineSuggestPreferences() {
  const { fetchAuth, isAuthenticated, user } = useAuth();
  const [state, setLocal] = useState<PreferencesState>(cache.state);

  useEffect(() => {
    cache.listeners.add(setLocal);
    return () => {
      cache.listeners.delete(setLocal);
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      cache.fetchedFor = null;
      setState({ loaded: true });
      return;
    }
    const userKey = user?.id != null ? String(user.id) : user?.email ?? "anon";
    if (cache.fetchedFor === userKey && cache.state.loaded) return;
    cache.fetchedFor = userKey;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/me/preferences`);
        if (cancelled) return;
        const next: Partial<PreferencesState> = { loaded: true };
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (typeof data?.inlineSuggestEnabled === "boolean") next.enabled = data.inlineSuggestEnabled;
          if (
            typeof data?.inlineSuggestLanguage === "string" &&
            VALID_INLINE_SUGGEST_LANGUAGES.has(data.inlineSuggestLanguage)
          ) {
            next.language = data.inlineSuggestLanguage;
          }
          if (data && "inlineSuggestFields" in data) {
            next.fields = normalizeFieldFlags(data.inlineSuggestFields);
          }
        } else {
          console.warn("[useInlineSuggestPreferences] non-OK response:", res.status);
        }
        setState(next);
      } catch (err) {
        console.warn("[useInlineSuggestPreferences] fetch failed:", err);
        if (!cancelled) setState({ loaded: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAuth, isAuthenticated, user?.id, user?.email]);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      if (!isAuthenticated) return;
      try {
        await fetchAuth(`${API_BASE}/api/me/preferences`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        console.warn("[useInlineSuggestPreferences] patch failed:", err);
      }
    },
    [fetchAuth, isAuthenticated],
  );

  const setEnabled = useCallback(
    (v: boolean) => {
      setState({ enabled: v });
      void patch({ inlineSuggestEnabled: v });
    },
    [patch],
  );

  const setLanguage = useCallback(
    (v: string) => {
      if (!VALID_INLINE_SUGGEST_LANGUAGES.has(v) || v === cache.state.language) return;
      setState({ language: v });
      void patch({ inlineSuggestLanguage: v });
    },
    [patch],
  );

  const setField = useCallback(
    (field: InlineSuggestConfigurableField, value: boolean) => {
      if (cache.state.fields[field] === value) return;
      const nextFields = { ...cache.state.fields, [field]: value };
      setState({ fields: nextFields });
      void patch({ inlineSuggestFields: { [field]: value } });
    },
    [patch],
  );

  return { ...state, setEnabled, setLanguage, setField, isAuthenticated };
}

interface UseInlineSuggestOptions {
  fieldType: InlineSuggestFieldType;
  text: string;
  title?: string | null;
  contactName?: string | null;
  enabled?: boolean;
}

const DEBOUNCE_MS = 500;
const MIN_CHARS = 8;

/**
 * Issues debounced inline-suggest requests against /api/ai/inline-suggest,
 * forwarding the user's saved language preference. Suggestions are
 * surfaced to the caller as `suggestion`.
 */
export function useInlineSuggest(opts: UseInlineSuggestOptions) {
  const { fieldType, text, title, contactName, enabled = true } = opts;
  const { fetchAuth, isAuthenticated } = useAuth();
  const { enabled: globalEnabled, language, loaded, fields } = useInlineSuggestPreferences();
  const [suggestion, setSuggestion] = useState("");
  const reqIdRef = useRef(0);
  const lastReqTextRef = useRef("");

  const fieldEnabled = isConfigurableField(fieldType) ? fields[fieldType] : true;
  const active = enabled && globalEnabled && fieldEnabled && isAuthenticated && loaded;

  useEffect(() => {
    if (!active) {
      reqIdRef.current++;
      setSuggestion("");
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS) {
      setSuggestion("");
      return;
    }
    if (text === lastReqTextRef.current && suggestion) return;

    const myReqId = ++reqIdRef.current;
    const handle = setTimeout(async () => {
      try {
        const res = await fetchAuth(`${API_BASE}/api/ai/inline-suggest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fieldType,
            text,
            title: title ?? null,
            contactName: contactName ?? null,
            language,
          }),
        });
        if (myReqId !== reqIdRef.current) return;
        if (!res.ok) {
          setSuggestion("");
          return;
        }
        const data = await res.json();
        const s = (data?.suggestion ?? "").toString();
        lastReqTextRef.current = text;
        setSuggestion(s);
      } catch {
        if (myReqId !== reqIdRef.current) return;
        setSuggestion("");
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fieldType, title, contactName, active, language]);

  const clear = useCallback(() => {
    reqIdRef.current++;
    lastReqTextRef.current = text;
    setSuggestion("");
  }, [text]);

  return { suggestion, clear, language };
}
