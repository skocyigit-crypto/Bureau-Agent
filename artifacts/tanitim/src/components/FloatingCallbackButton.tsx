import { lazy, Suspense, useEffect, useState } from "react";
import { PhoneCall, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const ContactModal = lazy(() =>
  import("@/components/ContactModal").then((m) => ({ default: m.ContactModal })),
);

const FAB_MARKER_ATTR = "data-floating-callback-fab";

function trackFabEvent(action: "shown" | "click" | "dismiss") {
  try {
    const w = window as unknown as {
      gtag?: (...args: unknown[]) => void;
      dataLayer?: unknown[];
      plausible?: (event: string, opts?: Record<string, unknown>) => void;
      umami?: { track: (event: string, data?: Record<string, unknown>) => void };
    };
    const eventName = `fab_callback_${action}`;
    if (typeof w.gtag === "function") {
      w.gtag("event", eventName, { event_category: "engagement" });
    }
    if (Array.isArray(w.dataLayer)) {
      w.dataLayer.push({ event: eventName });
    }
    if (typeof w.plausible === "function") {
      w.plausible(eventName);
    }
    if (w.umami && typeof w.umami.track === "function") {
      w.umami.track(eventName);
    }
  } catch {
    // analytics never blocks UI
  }
}

export function FloatingCallbackButton() {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [otherModalOpen, setOtherModalOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Defer mount so it never blocks first paint and avoids SSR mismatch.
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 150);
    return () => window.clearTimeout(t);
  }, []);

  // Detect any other modal overlay (z-[100] fixed full-screen) so the FAB
  // does not float above an open dialog.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const check = () => {
      const overlays = document.querySelectorAll<HTMLElement>(
        ".fixed.inset-0.z-\\[100\\]",
      );
      let foreign = false;
      overlays.forEach((el) => {
        if (!el.closest(`[${FAB_MARKER_ATTR}]`)) foreign = true;
      });
      setOtherModalOpen(foreign);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (mounted && !dismissed && !otherModalOpen && !open) {
      trackFabEvent("shown");
    }
    // We intentionally only fire on first becoming visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  const visible = mounted && !dismissed && !otherModalOpen;

  const handleClick = () => {
    trackFabEvent("click");
    setOpen(true);
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    trackFabEvent("dismiss");
    setDismissed(true);
  };

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.85 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="fixed bottom-5 right-5 sm:bottom-6 sm:right-6 z-[90] print:hidden"
          >
            <div className="relative group">
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Masquer le bouton de rappel"
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-background border border-border shadow-md flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleClick}
                aria-label="Être rappelé par notre équipe"
                className="flex items-center gap-2 sm:gap-3 h-14 pl-4 pr-5 sm:pl-5 sm:pr-6 rounded-full bg-[#f59e0b] text-[#1a2744] font-bold shadow-[0_10px_30px_-8px_rgba(245,158,11,0.6)] hover:shadow-[0_14px_40px_-8px_rgba(245,158,11,0.75)] hover:scale-[1.04] active:scale-95 transition-all"
              >
                <span className="relative flex items-center justify-center w-9 h-9 rounded-full bg-[#1a2744] text-[#f59e0b]">
                  <span className="absolute inset-0 rounded-full bg-[#1a2744] animate-ping opacity-30" />
                  <PhoneCall className="w-4 h-4 relative" />
                </span>
                <span className="text-sm sm:text-base whitespace-nowrap">
                  Être rappelé
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {open && (
        <Suspense fallback={null}>
          <div {...{ [FAB_MARKER_ATTR]: "" }}>
            <ContactModal
              open={open}
              kind="rappel"
              onClose={() => setOpen(false)}
            />
          </div>
        </Suspense>
      )}
    </>
  );
}
