import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, X, Download } from "lucide-react";

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export function UpdateBanner() {
  const [hasUpdate, setHasUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [updateCount, setUpdateCount] = useState(0);
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
        setUpdateCount(prev => prev + 1);
      }
    } catch (err) { /* silent */ }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => {
      checkVersion();
      timerRef.current = setInterval(checkVersion, POLL_INTERVAL_MS);
    }, 10000);
    return () => {
      clearTimeout(delay);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkVersion]);

  const handleRefresh = () => {
    window.location.reload();
  };

  const handleDismiss = () => {
    setDismissed(true);
    baseVersionRef.current = null;
    setHasUpdate(false);
    setUpdateCount(0);
  };

  if (!hasUpdate || dismissed) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg animate-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-3 text-sm font-medium">
        <Download className="h-4 w-4" />
        <span>Une mise a jour est disponible.</span>
        <button
          onClick={handleRefresh}
          className="inline-flex items-center gap-1.5 px-3 py-1 bg-white text-blue-700 rounded-md font-semibold hover:bg-blue-50 transition-colors text-xs"
        >
          <RefreshCw className="h-3 w-3" />
          Mettre a jour
        </button>
        <button
          onClick={handleDismiss}
          className="ml-1 p-1 rounded hover:bg-blue-700 transition-colors"
          title="Plus tard"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
