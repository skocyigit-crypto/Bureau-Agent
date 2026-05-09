import { useCallback, useEffect, useRef, useState } from "react";
import { useRequestAiInlineSuggest } from "@workspace/api-client-react";

export type InlineSuggestFieldType =
  | "note"
  | "prospect_note"
  | "email_body"
  | "call_note"
  | "task_description"
  | "message_content"
  | "project_description"
  | "project_note";

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

export function useInlineSuggestEnabled(): [boolean, (v: boolean) => void] {
  const [enabled, setEnabledState] = useState<boolean>(() => getInlineSuggestEnabled());
  useEffect(() => {
    const onChange = () => setEnabledState(getInlineSuggestEnabled());
    window.addEventListener("inline-suggest-toggle", onChange as EventListener);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("inline-suggest-toggle", onChange as EventListener);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const set = useCallback((v: boolean) => {
    setInlineSuggestEnabled(v);
    setEnabledState(v);
  }, []);
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

  return { suggestion, clear };
}
