import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useRequestAiInlineSuggest,
  recordAiInlineSuggestEvent,
  useGetMyPreferences,
  useUpdateMyPreferences,
  getGetMyPreferencesQueryKey,
  type UserPreferences,
  type InlineSuggestFieldFlags,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

interface FetchLikeError {
  status?: number;
}

function isUnauthenticatedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as FetchLikeError).status;
  return status === 401 || status === 403;
}

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

export type InlineSuggestConfigurableField =
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

export const INLINE_SUGGEST_CONFIGURABLE_FIELDS: ReadonlyArray<InlineSuggestConfigurableField> = [
  "note",
  "prospect_note",
  "email_body",
  "call_note",
  "task_description",
  "message_content",
  "project_description",
  "project_note",
  "quote_comment",
  "invoice_comment",
];

const CONFIGURABLE_FIELD_SET: ReadonlySet<string> = new Set(INLINE_SUGGEST_CONFIGURABLE_FIELDS);

function isConfigurableField(
  field: InlineSuggestFieldType,
): field is InlineSuggestConfigurableField {
  return CONFIGURABLE_FIELD_SET.has(field);
}

const STORAGE_KEY = "aiInlineSuggest:enabled";
const FIELDS_STORAGE_KEY = "aiInlineSuggest:fields";
const DEBOUNCE_MS = 600;
const MIN_CHARS = 8;

const LANGUAGE_STORAGE_KEY = "aiInlineSuggest:language";
const LAST_EXPLICIT_LANGUAGE_STORAGE_KEY = "aiInlineSuggest:lastExplicitLanguage";
export const INLINE_SUGGEST_LANGUAGES = [
  { value: "auto", label: "Auto (détection)" },
  { value: "francais", label: "Français" },
  { value: "english", label: "English" },
  { value: "deutsch", label: "Deutsch" },
  { value: "espanol", label: "Español" },
  { value: "italiano", label: "Italiano" },
  { value: "portugues", label: "Português" },
  { value: "nederlands", label: "Nederlands" },
  { value: "turkce", label: "Türkçe" },
  { value: "arabic", label: "العربية" },
] as const;
const DEFAULT_LANGUAGE = "francais";
const VALID_LANGUAGES: Set<string> = new Set(INLINE_SUGGEST_LANGUAGES.map((l) => l.value));

const LANGUAGE_LABELS: Record<string, string> = Object.fromEntries(
  INLINE_SUGGEST_LANGUAGES.map((l) => [l.value, l.label]),
);

/** Human-readable label for an inline-suggest language code (falls back to the code). */
export function inlineSuggestLanguageLabel(code: string | null | undefined): string {
  if (!code) return "";
  return LANGUAGE_LABELS[code] ?? code;
}

function getLastExplicitLanguage(): string {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const v = window.localStorage.getItem(LAST_EXPLICIT_LANGUAGE_STORAGE_KEY);
    if (v && VALID_LANGUAGES.has(v) && v !== "auto") return v;
    return DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function setLastExplicitLanguage(language: string): void {
  if (language === "auto" || !VALID_LANGUAGES.has(language)) return;
  try {
    window.localStorage.setItem(LAST_EXPLICIT_LANGUAGE_STORAGE_KEY, language);
  } catch {
    /* ignore */
  }
}

export function getInlineSuggestEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === "true";
  } catch {
    return true;
  }
}

export function setInlineSuggestEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(new CustomEvent("inline-suggest-toggle", { detail: enabled }));
  } catch {
    /* ignore */
  }
}

export function getInlineSuggestLanguage(): string {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;
  try {
    const v = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (v && VALID_LANGUAGES.has(v)) return v;
    return DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function setInlineSuggestLanguageStorage(language: string): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    window.dispatchEvent(new CustomEvent("inline-suggest-language", { detail: language }));
  } catch {
    /* ignore */
  }
}

function defaultFieldFlags(): Required<InlineSuggestFieldFlags> {
  return {
    note: true,
    prospect_note: true,
    email_body: true,
    call_note: true,
    task_description: true,
    message_content: true,
    project_description: true,
    project_note: true,
    quote_comment: true,
    invoice_comment: true,
  };
}

function mergeFieldFlags(
  partial: Partial<InlineSuggestFieldFlags> | null | undefined,
): Required<InlineSuggestFieldFlags> {
  const def = defaultFieldFlags();
  if (!partial || typeof partial !== "object") return def;
  const out = { ...def };
  for (const field of INLINE_SUGGEST_CONFIGURABLE_FIELDS) {
    const v = (partial as Record<string, unknown>)[field];
    if (typeof v === "boolean") out[field] = v;
  }
  return out;
}

export function getInlineSuggestFields(): Required<InlineSuggestFieldFlags> {
  const def = defaultFieldFlags();
  if (typeof window === "undefined") return def;
  try {
    const raw = window.localStorage.getItem(FIELDS_STORAGE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw) as Partial<InlineSuggestFieldFlags> | null;
    return mergeFieldFlags(parsed);
  } catch {
    return def;
  }
}

export function setInlineSuggestFields(flags: Required<InlineSuggestFieldFlags>): void {
  try {
    window.localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify(flags));
    window.dispatchEvent(
      new CustomEvent("inline-suggest-fields-toggle", { detail: flags }),
    );
  } catch {
    /* ignore */
  }
}

/**
 * Returns the user's inline-suggestion preference, persisted server-side
 * when authenticated, with a localStorage shim as graceful fallback for
 * unauthenticated/offline contexts.
 */
export function useInlineSuggestEnabled(): [boolean, (v: boolean) => void] {
  const queryClient = useQueryClient();
  const [localEnabled, setLocalEnabled] = useState<boolean>(() => getInlineSuggestEnabled());

  // Listen to local cross-tab/local-storage changes (fallback path).
  useEffect(() => {
    const onChange = () => setLocalEnabled(getInlineSuggestEnabled());
    window.addEventListener("inline-suggest-toggle", onChange as EventListener);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("inline-suggest-toggle", onChange as EventListener);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const prefsQuery = useGetMyPreferences({
    query: {
      queryKey: getGetMyPreferencesQueryKey(),
      retry: false,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  });

  // Mirror server value into localStorage shim so it works when offline.
  useEffect(() => {
    const v = prefsQuery.data?.inlineSuggestEnabled;
    if (typeof v === "boolean") {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        const desired = v ? "true" : "false";
        if (stored !== desired) {
          window.localStorage.setItem(STORAGE_KEY, desired);
        }
      } catch {
        /* ignore */
      }
      setLocalEnabled(v);
    }
  }, [prefsQuery.data?.inlineSuggestEnabled]);

  const updateMutation = useUpdateMyPreferences();

  // If the preferences fetch indicates the user is not authenticated, skip
  // server writes entirely so the localStorage shim remains the sole source
  // of truth (no noisy 401 churn on every toggle).
  const isAuthenticated = !isUnauthenticatedError(prefsQuery.error);

  const set = useCallback(
    (v: boolean) => {
      setInlineSuggestEnabled(v);
      setLocalEnabled(v);
      if (!isAuthenticated) return;
      // Optimistically update the cached server preference.
      queryClient.setQueryData<UserPreferences>(
        getGetMyPreferencesQueryKey(),
        (prev) => ({
          ...(prev ?? {}),
          inlineSuggestEnabled: v,
        }),
      );
      updateMutation.mutate(
        { data: { inlineSuggestEnabled: v } },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() });
          },
        },
      );
    },
    [queryClient, updateMutation, isAuthenticated],
  );

  // Server value wins when available; otherwise fall back to localStorage shim.
  const serverValue = prefsQuery.data?.inlineSuggestEnabled;
  const enabled = typeof serverValue === "boolean" ? serverValue : localEnabled;

  return [enabled, set];
}

/**
 * Returns the user's inline-suggestion language preference, persisted
 * server-side when authenticated and shimmed via localStorage otherwise.
 */
export function useInlineSuggestLanguage(): [string, (v: string) => void] {
  const queryClient = useQueryClient();
  const [localLanguage, setLocalLanguage] = useState<string>(() => getInlineSuggestLanguage());

  useEffect(() => {
    const onChange = () => setLocalLanguage(getInlineSuggestLanguage());
    window.addEventListener("inline-suggest-language", onChange as EventListener);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("inline-suggest-language", onChange as EventListener);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const prefsQuery = useGetMyPreferences({
    query: {
      queryKey: getGetMyPreferencesQueryKey(),
      retry: false,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    const v = prefsQuery.data?.inlineSuggestLanguage;
    if (typeof v === "string" && VALID_LANGUAGES.has(v)) {
      try {
        const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (stored !== v) window.localStorage.setItem(LANGUAGE_STORAGE_KEY, v);
      } catch {
        /* ignore */
      }
      setLocalLanguage(v);
      setLastExplicitLanguage(v);
    }
  }, [prefsQuery.data?.inlineSuggestLanguage]);

  const updateMutation = useUpdateMyPreferences();
  const isAuthenticated = !isUnauthenticatedError(prefsQuery.error);

  const set = useCallback(
    (v: string) => {
      if (!VALID_LANGUAGES.has(v)) return;
      setInlineSuggestLanguageStorage(v);
      setLocalLanguage(v);
      setLastExplicitLanguage(v);
      if (!isAuthenticated) return;
      queryClient.setQueryData<UserPreferences>(
        getGetMyPreferencesQueryKey(),
        (prev) => ({
          ...(prev ?? {}),
          inlineSuggestLanguage: v,
        }),
      );
      updateMutation.mutate(
        { data: { inlineSuggestLanguage: v } },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() });
          },
        },
      );
    },
    [queryClient, updateMutation, isAuthenticated],
  );

  const serverValue = prefsQuery.data?.inlineSuggestLanguage;
  const language =
    typeof serverValue === "string" && VALID_LANGUAGES.has(serverValue)
      ? serverValue
      : localLanguage;

  return [language, set];
}

/**
 * Returns the user's per-field inline-suggestion preferences. Each
 * configurable field type — see `INLINE_SUGGEST_CONFIGURABLE_FIELDS` for
 * the authoritative list — can be toggled independently; the master
 * switch from `useInlineSuggestEnabled` still applies on top. Persisted
 * server-side when authenticated, with a localStorage shim for
 * unauthenticated/offline contexts.
 */
export function useInlineSuggestFields(): [
  Required<InlineSuggestFieldFlags>,
  (field: InlineSuggestConfigurableField, value: boolean) => void,
] {
  const queryClient = useQueryClient();
  const [localFlags, setLocalFlags] = useState<Required<InlineSuggestFieldFlags>>(
    () => getInlineSuggestFields(),
  );

  useEffect(() => {
    const onChange = () => setLocalFlags(getInlineSuggestFields());
    window.addEventListener(
      "inline-suggest-fields-toggle",
      onChange as EventListener,
    );
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(
        "inline-suggest-fields-toggle",
        onChange as EventListener,
      );
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const prefsQuery = useGetMyPreferences({
    query: {
      queryKey: getGetMyPreferencesQueryKey(),
      retry: false,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  });

  const serverFlags = prefsQuery.data?.inlineSuggestFields;

  // Mirror server flags into localStorage shim.
  const serverFlagsKey = serverFlags
    ? INLINE_SUGGEST_CONFIGURABLE_FIELDS.map((f) =>
        typeof serverFlags[f] === "boolean" ? (serverFlags[f] ? "1" : "0") : "_",
      ).join("")
    : "";

  useEffect(() => {
    if (!serverFlags) return;
    const merged = mergeFieldFlags(serverFlags);
    try {
      window.localStorage.setItem(FIELDS_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
    setLocalFlags(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFlagsKey]);

  const updateMutation = useUpdateMyPreferences();
  const isAuthenticated = !isUnauthenticatedError(prefsQuery.error);

  const effective = useMemo<Required<InlineSuggestFieldFlags>>(() => {
    if (serverFlags) return mergeFieldFlags(serverFlags);
    return localFlags;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverFlagsKey, localFlags]);

  const setField = useCallback(
    (field: InlineSuggestConfigurableField, value: boolean) => {
      const next: Required<InlineSuggestFieldFlags> = { ...effective, [field]: value };
      setInlineSuggestFields(next);
      setLocalFlags(next);
      if (!isAuthenticated) return;
      queryClient.setQueryData<UserPreferences>(
        getGetMyPreferencesQueryKey(),
        (prev) => ({
          ...(prev ?? {}),
          inlineSuggestFields: { ...(prev?.inlineSuggestFields ?? {}), [field]: value },
        }),
      );
      updateMutation.mutate(
        { data: { inlineSuggestFields: { [field]: value } } },
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: getGetMyPreferencesQueryKey() });
          },
        },
      );
    },
    [effective, queryClient, updateMutation, isAuthenticated],
  );

  return [effective, setField];
}

interface UseInlineSuggestOptions {
  fieldType: InlineSuggestFieldType;
  text: string;
  title?: string | null;
  contactName?: string | null;
  enabled?: boolean;
}

interface UseInlineSuggestResult {
  suggestion: string;
  /** Language the server auto-detected for the current suggestion, or null. */
  detectedLanguage: string | null;
  clear: () => void;
  trackAccepted: (length: number) => void;
  trackDismissed: (length: number) => void;
  trackEdited: (survivedLength: number) => void;
}

function fireEvent(
  fieldType: InlineSuggestFieldType,
  event: "shown" | "accepted" | "dismissed" | "edited",
  length: number,
): void {
  try {
    void recordAiInlineSuggestEvent({ fieldType, event, length: Math.max(0, Math.floor(length || 0)) }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/**
 * Estimate how much of an accepted suggestion survived in the final text.
 * Word-based (cheap, robust to edits anywhere in the field): returns a
 * ratio 0..1 of accepted characters whose word still appears in `finalText`.
 * Short suggestions fall back to substring containment.
 */
export function measureSuggestionSurvival(accepted: string, finalText: string): number {
  const acc = (accepted ?? "").trim();
  if (!acc) return 1;
  const finalNorm = (finalText ?? "").toLowerCase();
  const words = acc.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) {
    return finalNorm.includes(acc.toLowerCase()) ? 1 : 0;
  }
  let survived = 0;
  let total = 0;
  for (const w of words) {
    total += w.length;
    if (finalNorm.includes(w.toLowerCase())) survived += w.length;
  }
  return total > 0 ? survived / total : 1;
}

/** Below this survival ratio, an accepted suggestion is considered "edited". */
export const INLINE_SUGGEST_EDIT_THRESHOLD = 0.6;

export function useInlineSuggest(opts: UseInlineSuggestOptions): UseInlineSuggestResult {
  const { fieldType, text, title, contactName, enabled = true } = opts;
  const [globalEnabled] = useInlineSuggestEnabled();
  const [language] = useInlineSuggestLanguage();
  const [fieldFlags] = useInlineSuggestFields();
  const fieldEnabled = isConfigurableField(fieldType) ? fieldFlags[fieldType] : true;
  const [suggestion, setSuggestion] = useState("");
  // Language the server actually used, surfaced only when the field is in
  // "auto" mode so the UI can show a discreet detected-language hint.
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const lastReqTextRef = useRef<string>("");
  const reqIdRef = useRef(0);
  const mutate = useRequestAiInlineSuggest();

  // Clear suggestion if user keeps typing past it (suggestion no longer matches end)
  useEffect(() => {
    if (!suggestion) return;
    if (text !== lastReqTextRef.current) {
      // If user typed forward and the new text is the old text + prefix of suggestion, trim suggestion
      if (text.startsWith(lastReqTextRef.current)) {
        const extra = text.slice(lastReqTextRef.current.length);
        if (extra && suggestion.startsWith(extra)) {
          setSuggestion(suggestion.slice(extra.length));
          lastReqTextRef.current = text;
          return;
        }
      }
      setSuggestion("");
    }
  }, [text, suggestion]);

  useEffect(() => {
    if (!enabled || !globalEnabled || !fieldEnabled) {
      // Invalidate any in-flight request so its onSuccess is ignored,
      // and clear any currently-shown suggestion.
      reqIdRef.current++;
      lastReqTextRef.current = text;
      setSuggestion("");
      setDetectedLanguage(null);
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length < MIN_CHARS) {
      setSuggestion("");
      return;
    }
    // Don't refire if same text we already requested
    if (text === lastReqTextRef.current && suggestion) return;

    const myReqId = ++reqIdRef.current;
    const handle = window.setTimeout(() => {
      mutate.mutate(
        {
          data: {
            fieldType,
            text,
            title: title ?? null,
            contactName: contactName ?? null,
            language: language ?? null,
            fallbackLanguage: language === "auto" ? getLastExplicitLanguage() : null,
          },
        },
        {
          onSuccess: (data) => {
            if (myReqId !== reqIdRef.current) return;
            const s = (data?.suggestion ?? "").toString();
            lastReqTextRef.current = text;
            setSuggestion(s);
            // Only surface the detected language when the server auto-detected
            // it (field in "auto" mode) and we actually have a suggestion.
            setDetectedLanguage(s && data?.detected ? (data.language ?? null) : null);
            if (s) fireEvent(fieldType, "shown", s.length);
          },
          onError: () => {
            if (myReqId !== reqIdRef.current) return;
            // Fail silently
            setSuggestion("");
            setDetectedLanguage(null);
          },
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fieldType, title, contactName, enabled, globalEnabled, language, fieldEnabled]);

  const clear = useCallback(() => {
    reqIdRef.current++;
    lastReqTextRef.current = text;
    setSuggestion("");
    setDetectedLanguage(null);
  }, [text]);

  const trackAccepted = useCallback((length: number) => {
    fireEvent(fieldType, "accepted", length);
  }, [fieldType]);

  const trackDismissed = useCallback((length: number) => {
    fireEvent(fieldType, "dismissed", length);
  }, [fieldType]);

  const trackEdited = useCallback((survivedLength: number) => {
    fireEvent(fieldType, "edited", survivedLength);
  }, [fieldType]);

  return { suggestion, detectedLanguage, clear, trackAccepted, trackDismissed, trackEdited };
}
