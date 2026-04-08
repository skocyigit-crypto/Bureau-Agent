import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, X } from "lucide-react";

const POLL_INTERVAL_MS = 30_000;

export function UpdateBanner() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const baseVersionRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkVersion = useCallback(async () => {
    try {
      const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${baseUrl}/api/data-version`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const data = await res.json();
      const version = data.version;

      if (!baseVersionRef.current) {
        baseVersionRef.current = version;
        return;
      }

      if (version !== baseVersionRef.current && version !== "unknown") {
        setHasUpdate(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    checkVersion();
    timerRef.current = setInterval(checkVersion, POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkVersion]);

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleDismiss = () => {
    setDismissed(true);
    setTimeout(() => {
      setDismissed(false);
    }, 5 * 60 * 1000);
  };

  if (!hasUpdate || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center px-4 py-2 bg-amber-500 text-white shadow-lg animate-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-3 text-sm font-medium">
        <RefreshCw className="h-4 w-4 animate-spin-slow" />
        <span>De nouvelles donnees sont disponibles.</span>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-amber-700 rounded-md font-semibold hover:bg-amber-50 transition-colors text-xs"
        >
          <RefreshCw className="h-3 w-3" />
          Actualiser
        </button>
        <button
          onClick={handleDismiss}
          className="ml-1 p-1 rounded hover:bg-amber-600 transition-colors"
          title="Ignorer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
