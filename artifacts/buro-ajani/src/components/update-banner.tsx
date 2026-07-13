import { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, X, Download, Sparkles, AlertTriangle, ChevronDown, ChevronUp, Rocket, Shield, Zap, Bug } from "lucide-react";

const POLL_INTERVAL_MS = 60 * 1000;

interface ReleaseInfo {
  id: number;
  version: string;
  title: string;
  description: string | null;
  changes: string | null;
  type: string;
  forceUpdate: boolean;
  publishedAt: string;
}

const typeConfig: Record<string, { icon: typeof Rocket; label: string; color: string }> = {
  major: { icon: Rocket, label: "Mise a jour majeure", color: "from-purple-600 to-indigo-600" },
  feature: { icon: Sparkles, label: "Nouvelles fonctionnalites", color: "from-blue-600 to-cyan-600" },
  security: { icon: Shield, label: "Mise a jour de securite", color: "from-red-600 to-orange-600" },
  fix: { icon: Bug, label: "Corrections", color: "from-amber-600 to-yellow-600" },
  update: { icon: Zap, label: "Mise a jour", color: "from-blue-600 to-indigo-600" },
  performance: { icon: Zap, label: "Amelioration des performances", color: "from-green-600 to-emerald-600" },
};

export function UpdateBanner() {
  const [hasAppUpdate, setHasAppUpdate] = useState(false);
  const [hasDataUpdate, setHasDataUpdate] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [updating, setUpdating] = useState(false);

  const buildHashRef = useRef<string | null>(null);
  const dataVersionRef = useRef<string | null>(null);
  const lastSeenReleaseRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("adb-last-seen-release");
    if (stored) lastSeenReleaseRef.current = parseInt(stored, 10);
  }, []);

  const checkForUpdates = useCallback(async () => {
    const baseUrl = import.meta.env.BASE_URL.replace(/\/$/, "");

    try {
      const [appRes, dataRes] = await Promise.all([
        fetch(`${baseUrl}/api/app-version`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${baseUrl}/api/data-version`, { credentials: "include" }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      if (appRes) {
        if (!buildHashRef.current) {
          buildHashRef.current = appRes.buildHash;
        } else if (appRes.buildHash !== buildHashRef.current) {
          setHasAppUpdate(true);
        }

        if (appRes.latestRelease) {
          const releaseId = appRes.latestRelease.id;
          if (appRes.latestRelease.forceUpdate) {
            setRelease(appRes.latestRelease);
            setForceUpdate(true);
            setHasAppUpdate(true);
          } else if (!lastSeenReleaseRef.current || releaseId > lastSeenReleaseRef.current) {
            setRelease(appRes.latestRelease);
            setForceUpdate(false);
            setHasAppUpdate(true);
          }
        }
      }

      if (dataRes) {
        if (!dataVersionRef.current) {
          dataVersionRef.current = dataRes.version;
        } else if (dataRes.version !== dataVersionRef.current && dataRes.version !== "unknown") {
          setHasDataUpdate(true);
        }
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => {
      checkForUpdates();
      timerRef.current = setInterval(checkForUpdates, POLL_INTERVAL_MS);
    }, 5000);
    return () => {
      clearTimeout(delay);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [checkForUpdates]);

  const handleUpdate = () => {
    setUpdating(true);
    if (release && !release.forceUpdate) {
      localStorage.setItem("adb-last-seen-release", String(release.id));
    }
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const handleDismiss = () => {
    if (forceUpdate) return;
    setDismissed(true);
    if (release) {
      localStorage.setItem("adb-last-seen-release", String(release.id));
      lastSeenReleaseRef.current = release.id;
    }
    dataVersionRef.current = null;
    buildHashRef.current = null;
    setHasAppUpdate(false);
    setHasDataUpdate(false);
  };

  const showBanner = (hasAppUpdate || hasDataUpdate) && !dismissed;
  if (!showBanner) return null;

  const isAppUpdate = hasAppUpdate && release;
  const config = isAppUpdate ? (typeConfig[release.type] || typeConfig.update) : typeConfig.update;
  const TypeIcon = config.icon;

  const changesList = release?.changes
    ? release.changes.split("\n").filter(line => line.trim())
    : [];

  if (forceUpdate) {
    return (
      <div className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <AlertTriangle className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-xl font-bold mb-2">Mise a jour obligatoire</h2>
          <p className="text-muted-foreground mb-2">
            Version {release?.version} — {release?.title}
          </p>
          {release?.description && (
            <p className="text-sm text-muted-foreground mb-4">{release.description}</p>
          )}
          {changesList.length > 0 && (
            <div className="text-left bg-muted/50 rounded-lg p-4 mb-6 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Changements:</p>
              <ul className="space-y-1">
                {changesList.map((change, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-green-500 mt-0.5">+</span>
                    <span>{change.replace(/^[-*•]\s*/, "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={handleUpdate}
            disabled={updating}
            className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-xl font-semibold hover:from-amber-600 hover:to-orange-600 transition-all disabled:opacity-50"
          >
            {updating ? (
              <><RefreshCw className="h-5 w-5 animate-spin" /> Mise a jour en cours...</>
            ) : (
              <><Download className="h-5 w-5" /> Mettre a jour maintenant</>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9999] bg-gradient-to-r ${config.color} text-white shadow-lg animate-in slide-in-from-top-2 duration-300`}>
      <div className="max-w-7xl mx-auto px-4 py-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white/20 rounded-full px-3 py-1">
              <TypeIcon className="h-4 w-4" />
              <span className="text-xs font-semibold">{config.label}</span>
            </div>

            {isAppUpdate ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="font-bold">v{release.version}</span>
                <span className="opacity-90">— {release.title}</span>
                {release.description && (
                  <span className="hidden md:inline opacity-75 text-xs">| {release.description}</span>
                )}
              </div>
            ) : (
              <span className="text-sm font-medium">De nouvelles donnees sont disponibles.</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isAppUpdate && changesList.length > 0 && (
              <button
                onClick={() => setShowChangelog(!showChangelog)}
                className="inline-flex items-center gap-1 px-2 py-1 bg-white/15 rounded-md text-xs font-medium hover:bg-white/25 transition-colors"
              >
                Details
                {showChangelog ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            )}

            <button
              onClick={handleUpdate}
              disabled={updating}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white text-gray-800 rounded-md font-semibold hover:bg-gray-100 transition-colors text-sm disabled:opacity-50"
            >
              {updating ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Mise a jour...</>
              ) : (
                <><RefreshCw className="h-3.5 w-3.5" /> Mettre a jour</>
              )}
            </button>

            <button
              onClick={handleDismiss}
              className="p-1 rounded hover:bg-white/20 transition-colors"
              title="Plus tard"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {showChangelog && changesList.length > 0 && (
          <div className="mt-2 pt-2 border-t border-white/20 pb-1">
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {changesList.map((change, i) => (
                <li key={i} className="text-xs flex items-start gap-1.5 opacity-90">
                  <span className="text-green-300 mt-px">+</span>
                  <span>{change.replace(/^[-*•]\s*/, "")}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
