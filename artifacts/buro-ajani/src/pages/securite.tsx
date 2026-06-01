import { useState, useEffect, useCallback, useRef } from "react";
import {
  ShieldCheck, Shield, Link2, FileSearch, Loader2,
  RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, XCircle, Lock,
  Wifi, Mail, Phone, MessageCircle, Bug, ServerCog, Sparkles,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const SECURITY_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/security";

type Risk = "safe" | "suspicious" | "dangerous";

interface UrlScanResult {
  url: string;
  displayUrl: string;
  domain: string;
  risk: Risk;
  reasons: string[];
  isShortener: boolean;
  isHttps: boolean;
  source?: string;
  threatTypes?: string[];
}

interface FileScanResult {
  safe: boolean;
  threats: string[];
}

interface ProtectionStatus {
  layers: Record<string, { active: boolean; label: string }>;
  summary: { total: number; dangerous: number; suspicious: number; last24h: number };
  recentScans: Array<{
    id: string; kind: string; target: string; verdict: Risk; details: string; at: string;
  }>;
}

const RISK_STYLE: Record<Risk, { badge: string; icon: typeof ShieldCheck; label: string }> = {
  safe: { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2, label: "Sûr" },
  suspicious: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: AlertTriangle, label: "Suspect" },
  dangerous: { badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: XCircle, label: "Dangereux" },
};

const KIND_ICON: Record<string, typeof Link2> = {
  url: Link2, file: FileSearch, whatsapp: MessageCircle, call: Phone, email: Mail,
};

// ── Statut de protection ──────────────────────────────────────────────────────
function ProtectionStatusCard({ status, loading, onRefresh }: {
  status: ProtectionStatus | null; loading: boolean; onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Votre protection
            </CardTitle>
            <CardDescription>Couches de sécurité actives sur votre compte Agent de Bureau.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`w-3 h-3 mr-1 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {status && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-blue-600">{status.summary.total}</div>
              <p className="text-xs text-muted-foreground">Analyses effectuées</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-600">{status.summary.dangerous}</div>
              <p className="text-xs text-muted-foreground">Menaces bloquées</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{status.summary.suspicious}</div>
              <p className="text-xs text-muted-foreground">Éléments suspects</p>
            </div>
            <div className="border rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-slate-600">{status.summary.last24h}</div>
              <p className="text-xs text-muted-foreground">Dernières 24h</p>
            </div>
          </div>
        )}
        {status && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(status.layers).map(([key, layer]) => (
              <div key={key} className="flex items-center gap-2 border rounded-lg p-2.5">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center ${layer.active ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-slate-100 dark:bg-slate-800"}`}>
                  {layer.active
                    ? <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    : <Shield className="w-4 h-4 text-slate-400" />}
                </div>
                <p className="text-xs font-medium flex-1">{layer.label}</p>
                <Badge className={`text-[9px] border-0 ${layer.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {layer.active ? "Actif" : "Inactif"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Scanner de lien + navigation sécurisée ────────────────────────────────────
function LinkScannerCard({ onScanned }: { onScanned: () => void }) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<UrlScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const { toast } = useToast();

  const scan = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setScanning(true);
    setResult(null);
    try {
      const res = await fetch(`${SECURITY_API}/scan-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      });
      if (res.ok) {
        setResult(await res.json());
        onScanned();
      } else {
        toast({ title: "Erreur", description: "Analyse impossible.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  }, [url, onScanned, toast]);

  const openSafely = () => {
    if (!result) return;
    const target = result.url.startsWith("http") ? result.url : `https://${result.url}`;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const rs = result ? RISK_STYLE[result.risk] : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="w-5 h-5 text-blue-600" />
          Scanner un lien
        </CardTitle>
        <CardDescription>
          Vérifiez un lien suspect avant de l'ouvrir. Analyse heuristique + Google Safe Browsing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="https://exemple.com/lien-a-verifier"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") scan(); }}
          />
          <Button onClick={scan} disabled={scanning || !url.trim()}>
            {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : "Analyser"}
          </Button>
        </div>

        {result && rs && (
          <div className={`border rounded-lg p-3 space-y-2 ${result.risk === "dangerous" ? "border-red-300 dark:border-red-900/50" : result.risk === "suspicious" ? "border-amber-300 dark:border-amber-900/50" : "border-emerald-300 dark:border-emerald-900/50"}`}>
            <div className="flex items-center gap-2">
              <rs.icon className={`w-5 h-5 ${result.risk === "dangerous" ? "text-red-600" : result.risk === "suspicious" ? "text-amber-600" : "text-emerald-600"}`} />
              <Badge className={`${rs.badge} border-0`}>{rs.label}</Badge>
              <span className="text-sm font-mono text-muted-foreground truncate">{result.domain}</span>
            </div>
            {result.reasons.length > 0 ? (
              <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
                {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Aucun signal de risque détecté.</p>
            )}
            <div className="flex gap-2 pt-1">
              {result.risk === "safe" ? (
                <Button size="sm" variant="outline" onClick={openSafely}>
                  <ExternalLink className="w-3 h-3 mr-1" /> Ouvrir le lien
                </Button>
              ) : (
                <div className="text-xs font-medium text-red-600 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {result.risk === "dangerous" ? "Ouverture bloquée — ne cliquez pas." : "Prudence recommandée."}
                </div>
              )}
              {result.risk !== "safe" && (
                <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={openSafely}>
                  Ouvrir quand même
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Scanner de fichier ────────────────────────────────────────────────────────
function FileScannerCard({ onScanned }: { onScanned: () => void }) {
  const [result, setResult] = useState<{ name: string; res: FileScanResult } | null>(null);
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const onFile = async (file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "Fichier trop volumineux", description: "Maximum 15 Mo.", variant: "destructive" });
      return;
    }
    setScanning(true);
    setResult(null);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const s = String(reader.result);
          resolve(s.includes(",") ? s.split(",")[1] : s);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const res = await fetch(`${SECURITY_API}/scan-document`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: base64, filename: file.name }),
      });
      if (res.ok) {
        setResult({ name: file.name, res: await res.json() });
        onScanned();
      } else {
        toast({ title: "Erreur", description: "Analyse impossible.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur", description: "Lecture du fichier impossible.", variant: "destructive" });
    } finally {
      setScanning(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileSearch className="w-5 h-5 text-purple-600" />
          Scanner un fichier
        </CardTitle>
        <CardDescription>Antivirus avant ouverture : extensions dangereuses, signatures binaires, EICAR.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
        />
        <Button variant="outline" onClick={() => inputRef.current?.click()} disabled={scanning}>
          {scanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileSearch className="w-4 h-4 mr-1" />}
          Choisir un fichier
        </Button>

        {result && (
          <div className={`border rounded-lg p-3 ${result.res.safe ? "border-emerald-300 dark:border-emerald-900/50" : "border-red-300 dark:border-red-900/50"}`}>
            <div className="flex items-center gap-2">
              {result.res.safe
                ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                : <XCircle className="w-5 h-5 text-red-600" />}
              <Badge className={`border-0 ${result.res.safe ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                {result.res.safe ? "Aucune menace" : "DANGEREUX"}
              </Badge>
              <span className="text-sm font-mono text-muted-foreground truncate">{result.name}</span>
            </div>
            {!result.res.safe && result.res.threats.length > 0 && (
              <ul className="text-xs text-red-600 mt-2 space-y-0.5 list-disc list-inside">
                {result.res.threats.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Menaces récentes ──────────────────────────────────────────────────────────
function RecentScansCard({ scans }: { scans: ProtectionStatus["recentScans"] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-500" />
          Activité de sécurité récente
        </CardTitle>
        <CardDescription>Derniers liens, fichiers, appels et messages analysés.</CardDescription>
      </CardHeader>
      <CardContent>
        {scans.length === 0 ? (
          <div className="border rounded-lg p-6 text-center">
            <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Aucune analyse récente. Tout est calme.</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {scans.map((s) => {
              const Icon = KIND_ICON[s.kind] ?? Shield;
              const rs = RISK_STYLE[s.verdict];
              return (
                <div key={s.id} className="flex items-center gap-2 border rounded p-2 text-xs">
                  <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Badge className={`${rs.badge} border-0 text-[9px] shrink-0`}>{rs.label}</Badge>
                  <span className="truncate flex-1">{s.target}</span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(s.at).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Partenaires : NextDNS + Bitdefender (échafaudage) ─────────────────────────
function PartnersCard() {
  const [nextdnsId, setNextdnsId] = useState("");
  const { toast } = useToast();

  return (
    <Card className="border-blue-200 dark:border-blue-900/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          Protection étendue (partenaires)
        </CardTitle>
        <CardDescription>
          Renforcez votre sécurité avec un filtrage DNS et un antivirus professionnel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* NextDNS */}
        <div className="border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-indigo-600" />
            <h4 className="text-sm font-semibold">NextDNS — Filtrage Internet</h4>
            <Badge variant="outline" className="text-[9px] ml-auto">Configuration</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Bloque les sites de phishing, publicités et trackers sur tout l'appareil.
            Créez un profil sur nextdns.io, puis collez son identifiant ici.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="ID de profil NextDNS (ex: abc123)"
              value={nextdnsId}
              onChange={(e) => setNextdnsId(e.target.value)}
              className="text-sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!nextdnsId.trim()) {
                  window.open("https://my.nextdns.io/signup", "_blank", "noopener,noreferrer");
                } else {
                  toast({ title: "Profil enregistré", description: "Suivez le guide d'installation pour activer le DNS sur vos appareils." });
                }
              }}
            >
              {nextdnsId.trim() ? "Enregistrer" : "Créer un compte"}
            </Button>
          </div>
          {nextdnsId.trim() && (
            <a
              href={`https://my.nextdns.io/${encodeURIComponent(nextdnsId.trim())}/setup`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3" /> Guide d'installation pour ce profil
            </a>
          )}
        </div>

        {/* Bitdefender */}
        <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
          <div className="flex items-center gap-2">
            <Bug className="w-4 h-4 text-rose-600" />
            <h4 className="text-sm font-semibold">Bitdefender — Antivirus professionnel</h4>
            <Badge variant="outline" className="text-[9px] ml-auto">Partenariat à venir</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Offre antivirus en marque blanche pour vos postes de travail. L'activation
            nécessite la signature du partenariat Bitdefender (en cours).
          </p>
          <Button variant="outline" size="sm" disabled className="opacity-70">
            <ServerCog className="w-3 h-3 mr-1" /> Bientôt disponible
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SecuritePage() {
  const [status, setStatus] = useState<ProtectionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SECURITY_API}/protection-status`, { credentials: "include" });
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shadow-lg">
          <ShieldCheck className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Centre de sécurité</h1>
          <p className="text-sm text-muted-foreground">
            Votre concierge numérique : analysez liens, fichiers, appels et messages en un seul endroit.
          </p>
        </div>
      </div>

      <ProtectionStatusCard status={status} loading={loading} onRefresh={fetchStatus} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LinkScannerCard onScanned={fetchStatus} />
        <FileScannerCard onScanned={fetchStatus} />
      </div>

      <RecentScansCard scans={status?.recentScans ?? []} />

      <PartnersCard />
    </div>
  );
}
