import { useCallback, useEffect, useRef, useState } from "react";
import {
  useRequestAiInlineSuggest,
  recordAiInlineSuggestEvent,
  useGetMyPreferences,
  useUpdateMyPreferences,
  getGetMyPreferencesQueryKey,
  type UserPreferences,
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

const STORAGE_KEY = "aiInlineSuggest:enabled";
const DEBOUNCE_MS = 400;
const MIN_CHARS = 8;

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

interface UseInlineSuggestOptions {
  fieldType: InlineSuggestFieldType;
  text: string;
  title?: string | null;
  contactName?: string | null;
  enabled?: boolean;
}

interface UseInlineSuggestResult {
  suggestion: string;
  clear: () => void;
  trackAccepted: (length: number) => void;
  trackDismissed: (length: number) => void;
}

function fireEvent(fieldType: InlineSuggestFieldType, event: "shown" | "accepted" | "dismissed", length: number): void {
  try {
    void recordAiInlineSuggestEvent({ fieldType, event, length: Math.max(0, Math.floor(length || 0)) }).catch(() => {});
  } catch {
    /* ignore */
  }
}

export function useInlineSuggest(opts: UseInlineSuggestOptions): UseInlineSuggestResult {
  const { fieldType, text, title, contactName, enabled = true } = opts;
  const [globalEnabled] = useInlineSuggestEnabled();
  const [suggestion, setSuggestion] = useState("");
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
    if (!enabled || !globalEnabled) {
      // Invalidate any in-flight request so its onSuccess is ignored,
      // and clear any currently-shown suggestion.
      reqIdRef.current++;
      lastReqTextRef.current = text;
      setSuggestion("");
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
          },
        },
        {
          onSuccess: (data) => {
            if (myReqId !== reqIdRef.current) return;
            const s = (data?.suggestion ?? "").toString();
            lastReqTextRef.current = text;
            setSuggestion(s);
            if (s) fireEvent(fieldType, "shown", s.length);
          },
          onError: () => {
            if (myReqId !== reqIdRef.current) return;
            // Fail silently
            setSuggestion("");
          },
        },
      );
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fieldType, title, contactName, enabled, globalEnabled]);

  const clear = useCallback(() => {
    reqIdRef.current++;
    lastReqTextRef.current = text;
    setSuggestion("");
  }, [text]);

  const trackAccepted = useCallback((length: number) => {
    fireEvent(fieldType, "accepted", length);
  }, [fieldType]);

  const trackDismissed = useCallback((length: number) => {
    fireEvent(fieldType, "dismissed", length);
  }, [fieldType]);

  return { suggestion, clear, trackAccepted, trackDismissed };
}
