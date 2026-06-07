import * as React from "react";
import { Sparkles } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  useInlineSuggest,
  useInlineSuggestEnabled,
  measureSuggestionSurvival,
  INLINE_SUGGEST_EDIT_THRESHOLD,
  type InlineSuggestFieldType,
} from "@/hooks/use-inline-suggest";

interface GhostTextareaProps
  extends Omit<React.ComponentProps<"textarea">, "value" | "onChange"> {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  fieldType: InlineSuggestFieldType;
  context?: { title?: string | null; contactName?: string | null };
  enableSuggest?: boolean;
  showToggle?: boolean;
}

export const GhostTextarea = React.forwardRef<HTMLTextAreaElement, GhostTextareaProps>(
  function GhostTextarea(
    { value, onChange, fieldType, context, enableSuggest = true, showToggle = false, className, onKeyDown, onBlur, ...rest },
    forwardedRef,
  ) {
    const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
    const ghostRef = React.useRef<HTMLDivElement | null>(null);
    const [globalEnabled, setGlobalEnabled] = useInlineSuggestEnabled();
    // Remembers the most recently accepted suggestion so we can measure, on
    // blur, whether the user kept it or rewrote it (a "edited" quality signal).
    const lastAcceptRef = React.useRef<string | null>(null);

    React.useImperativeHandle(forwardedRef, () => innerRef.current as HTMLTextAreaElement);

    const { suggestion, clear, trackAccepted, trackDismissed, trackEdited } = useInlineSuggest({
      fieldType,
      text: value,
      title: context?.title ?? null,
      contactName: context?.contactName ?? null,
      enabled: enableSuggest && globalEnabled,
    });

    // Sync ghost overlay scroll with textarea scroll
    const handleScroll = React.useCallback(() => {
      if (innerRef.current && ghostRef.current) {
        ghostRef.current.scrollTop = innerRef.current.scrollTop;
        ghostRef.current.scrollLeft = innerRef.current.scrollLeft;
      }
    }, []);

    const acceptSuggestion = React.useCallback(() => {
      if (!suggestion || !innerRef.current) return false;
      const el = innerRef.current;
      const accepted = suggestion;
      const newValue = value + accepted;
      // Update via native setter so React picks up the change
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(el, newValue);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      // Move caret to end
      requestAnimationFrame(() => {
        try {
          el.selectionStart = el.selectionEnd = newValue.length;
        } catch { /* noop */ }
      });
      trackAccepted(accepted.length);
      lastAcceptRef.current = accepted;
      clear();
      return true;
    }, [suggestion, value, clear, trackAccepted]);

    const handleBlur = React.useCallback(
      (e: React.FocusEvent<HTMLTextAreaElement>) => {
        const accepted = lastAcceptRef.current;
        if (accepted) {
          lastAcceptRef.current = null;
          const survival = measureSuggestionSurvival(accepted, e.target.value);
          if (survival < INLINE_SUGGEST_EDIT_THRESHOLD) {
            trackEdited(Math.round(survival * accepted.length));
          }
        }
        onBlur?.(e);
      },
      [trackEdited, onBlur],
    );

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (suggestion && e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        acceptSuggestion();
        return;
      }
      if (suggestion && e.key === "Escape") {
        e.preventDefault();
        trackDismissed(suggestion.length);
        clear();
        return;
      }
      onKeyDown?.(e);
    };

    return (
      <div className="relative w-full">
        {/* Ghost overlay (absolute, behind textarea text) */}
        <div
          ref={ghostRef}
          aria-hidden
          className={cn(
            "ghost-suggest-overlay pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words rounded-md border border-transparent px-3 py-2 text-base leading-normal text-transparent md:text-sm",
            className,
          )}
        >
          <span className="invisible">{value}</span>
          {suggestion && (
            <span className="text-muted-foreground/60">{suggestion}</span>
          )}
        </div>
        <Textarea
          ref={innerRef}
          value={value}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onScroll={handleScroll}
          spellCheck={rest.spellCheck}
          className={cn("relative bg-transparent", className)}
          {...rest}
        />
        {suggestion && (
          <div className="pointer-events-auto absolute bottom-1 right-2 flex items-center gap-1 rounded-md border border-border/60 bg-background/90 px-1.5 py-0.5 text-[10px] text-muted-foreground shadow-sm backdrop-blur-sm">
            <Sparkles className="h-2.5 w-2.5 text-primary" />
            <span>
              <kbd className="font-sans font-semibold">Tab</kbd> pour accepter ·{" "}
              <kbd className="font-sans font-semibold">Esc</kbd>
            </span>
          </div>
        )}
        {showToggle && (
          <button
            type="button"
            onClick={() => setGlobalEnabled(!globalEnabled)}
            className={cn(
              "pointer-events-auto absolute -top-7 right-0 flex items-center gap-1 rounded-md border border-border/40 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-muted",
              globalEnabled ? "text-primary" : "text-muted-foreground",
            )}
            title={
              globalEnabled
                ? "Désactiver les suggestions IA en ligne"
                : "Activer les suggestions IA en ligne"
            }
          >
            <Sparkles className="h-2.5 w-2.5" />
            <span>IA: {globalEnabled ? "on" : "off"}</span>
          </button>
        )}
      </div>
    );
  },
);
