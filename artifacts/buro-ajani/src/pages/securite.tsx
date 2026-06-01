import { useState, useEffect, useCallback, useRef } from "react";
import {
  ShieldCheck, Shield, Link2, FileSearch, Loader2,
  RefreshCw, ExternalLink, AlertTriangle, CheckCircle2, XCircle, Lock,
  Wifi, Mail, Phone, MessageCircle, Bug, ServerCog, Sparkles,
  Ban, ListChecks, Trash2, Plus, Globe, Bell, ShieldAlert,
  Gauge, Lightbulb, ArrowRight, Info,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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

interface PiiFinding {
  kind: string;
  label: string;
  count: number;
  samples: string[];
}

interface PiiResult {
  hasPii: boolean;
  findings: PiiFinding[];
  summary: string;
}

interface FileScanResult {
  safe: boolean;
  threats: string[];
  pii?: PiiResult;
  engine?: string;
  engineDetail?: string;
}

interface ProtectionStatus {
  layers: Record<string, { active: boolean; label: string }>;
  summary: { total: number; dangerous: number; suspicious: number; last24h: number };
  recentScans: Array<{
    id: string; kind: string; target: string; verdict: Risk; details: string; at: string; engine?: string;
  }>;
}

interface SecurityAlert {
  id: string;
  kind: string;
  verdict: Risk;
  target: string;
  message: string;
  at: string;
}

interface SecurityScore {
  score: number;
  rating: "excellent" | "bon" | "moyen" | "faible";
  strengths: string[];
  recommendations: Array<{ id: string; severity: "high" | "medium" | "low"; title: string; detail: string }>;
  breakdown: Array<{ label: string; impact: number }>;
  notes: string[];
  threats7d: { dangerous: number; suspicious: number };
  computedAt: string;
}

const RATING_STYLE: Record<SecurityScore["rating"], { ring: string; text: string; label: string }> = {
  excellent: { ring: "text-emerald-600", text: "text-emerald-700 dark:text-emerald-400", label: "Excellent" },
  bon:       { ring: "text-blue-600",    text: "text-blue-700 dark:text-blue-400",       label: "Bon" },
  moyen:     { ring: "text-amber-600",   text: "text-amber-700 dark:text-amber-400",     label: "Moyen" },
  faible:    { ring: "text-red-600",     text: "text-red-700 dark:text-red-400",         label: "Faible" },
};

const SEVERITY_STYLE: Record<"high" | "medium" | "low", string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  medium: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const RISK_STYLE: Record<Risk, { badge: string; icon: typeof ShieldCheck; label: string }> = {
  safe: { badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400", icon: CheckCircle2, label: "Sûr" },
  suspicious: { badge: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: AlertTriangle, label: "Suspect" },
  dangerous: { badge: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: XCircle, label: "Dangereux" },
};

const KIND_ICON: Record<string, typeof Link2> = {
  url: Link2, file: FileSearch, whatsapp: MessageCircle, call: Phone, email: Mail,
};

// ── Score de sécurité + recommandations ───────────────────────────────────────
function ScorePanelCard({ score, loading }: { score: SecurityScore | null; loading: boolean }) {
  const style = score ? RATING_STYLE[score.rating] : RATING_STYLE.moyen;
  const pct = score?.score ?? 0;
  const circumference = 2 * Math.PI * 42;
  const dash = (pct / 100) * circumference;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-blue-600" />
          Score de sécurité
        </CardTitle>
        <CardDescription>Évaluation globale de votre posture de sécurité et pistes d'amélioration.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !score ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : !score ? (
          <p className="text-sm text-muted-foreground">Score indisponible.</p>
        ) : (
          <div className="flex flex-col md:flex-row gap-6">
            {/* Jauge circulaire */}
            <div className="flex flex-col items-center justify-center shrink-0">
              <div className="relative w-28 h-28">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="stroke-slate-200 dark:stroke-slate-700" />
                  <circle
                    cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round"
                    className={style.ring}
                    stroke="currentColor"
                    strokeDasharray={`${dash} ${circumference}`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={`text-3xl font-bold ${style.text}`}>{score.score}</span>
                  <span className="text-[10px] text-muted-foreground">/ 100</span>
                </div>
              </div>
              <Badge className={`mt-2 border-0 ${SEVERITY_STYLE[score.rating === "faible" ? "high" : score.rating === "moyen" ? "medium" : "low"]}`}>
                {style.label}
              </Badge>
            </div>

            {/* Forces + recommandations */}
            <div className="flex-1 space-y-4">
              {score.strengths.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Points forts
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {score.strengths.map((s, i) => (
                      <Badge key={i} className="border-0 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Lightbulb className="w-3.5 h-3.5 text-amber-500" /> Recommandations
                </p>
                {score.recommendations.length === 0 ? (
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> Tout est en ordre, aucune action requise.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {score.recommendations.map((r) => (
                      <div key={r.id} className="border rounded-lg p-2.5 flex items-start gap-2">
                        <Badge className={`border-0 text-[9px] mt-0.5 ${SEVERITY_STYLE[r.severity]}`}>
                          {r.severity === "high" ? "Priorité" : r.severity === "medium" ? "Conseillé" : "Optionnel"}
                        </Badge>
                        <div className="flex-1">
                          <p className="text-sm font-medium flex items-center gap-1">
                            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            {r.title}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">{r.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {score.notes.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {score.notes.map((n, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {n}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

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

// ── Affichage RGPD (données personnelles détectées) ───────────────────────────
function PiiFindings({ pii }: { pii: PiiResult }) {
  if (!pii.hasPii) return null;
  return (
    <div className="mt-2 border border-amber-300 dark:border-amber-900/50 rounded-lg p-2.5 bg-amber-50/50 dark:bg-amber-950/20">
      <div className="flex items-center gap-1.5 mb-1.5">
        <ShieldAlert className="w-4 h-4 text-amber-600" />
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Données personnelles détectées (RGPD)</span>
      </div>
      <ul className="space-y-1">
        {pii.findings.map((f) => (
          <li key={f.kind} className="text-xs flex items-center gap-2">
            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-0 text-[9px] shrink-0">
              {f.count}
            </Badge>
            <span className="font-medium">{f.label}</span>
            <span className="text-muted-foreground truncate">{f.samples.join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
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
        <CardDescription>Antivirus avant ouverture : heuristique (extensions, signatures, EICAR) + moteur VirusTotal si configuré.</CardDescription>
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
              {result.res.engine && (
                <Badge variant="outline" className="text-[9px] gap-1">
                  <ServerCog className="w-2.5 h-2.5" /> {result.res.engine}
                </Badge>
              )}
              <span className="text-sm font-mono text-muted-foreground truncate">{result.name}</span>
            </div>
            {result.res.engineDetail && (
              <p className="text-[11px] text-muted-foreground mt-1.5">{result.res.engineDetail}</p>
            )}
            {!result.res.safe && result.res.threats.length > 0 && (
              <ul className="text-xs text-red-600 mt-2 space-y-0.5 list-disc list-inside">
                {result.res.threats.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}
            {result.res.pii && <PiiFindings pii={result.res.pii} />}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Scanner de texte (RGPD) ───────────────────────────────────────────────────
function TextScannerCard() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<PiiResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const { toast } = useToast();

  const scan = async () => {
    if (!text.trim()) return;
    setScanning(true);
    setResult(null);
    try {
      const res = await fetch(`${SECURITY_API}/scan-text`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) setResult(await res.json());
      else toast({ title: "Erreur", description: "Analyse impossible.", variant: "destructive" });
    } catch {
      toast({ title: "Erreur réseau", description: "Vérifiez votre connexion.", variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-amber-600" />
          Vérifier un texte (RGPD)
        </CardTitle>
        <CardDescription>
          Collez un texte (email, message, extrait de document) pour repérer IBAN, n° de sécurité sociale,
          carte bancaire, SIRET et coordonnées avant de le partager.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Collez ici le texte à vérifier…"
          rows={4}
          className="w-full rounded-md border bg-background p-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-amber-500/40"
        />
        <Button variant="outline" onClick={scan} disabled={scanning || !text.trim()}>
          {scanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ShieldAlert className="w-4 h-4 mr-1" />}
          Analyser le texte
        </Button>
        {result && (
          result.hasPii
            ? <PiiFindings pii={result} />
            : (
              <div className="border border-emerald-300 dark:border-emerald-900/50 rounded-lg p-3 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span className="text-sm">Aucune donnée personnelle sensible détectée.</span>
              </div>
            )
        )}
      </CardContent>
    </Card>
  );
}

// ── Alertes temps réel ────────────────────────────────────────────────────────
function AlertsCard({ alerts }: { alerts: SecurityAlert[] }) {
  return (
    <Card className={alerts.length > 0 ? "border-red-200 dark:border-red-900/50" : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-red-500" />
          Alertes de sécurité
          {alerts.length > 0 && (
            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-0">
              {alerts.length}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Menaces dangereuses détectées en temps réel. Vous êtes aussi notifié sur WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="border rounded-lg p-6 text-center">
            <ShieldCheck className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Aucune alerte. Aucune menace dangereuse détectée.</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {alerts.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? Shield;
              return (
                <div key={a.id} className="flex items-start gap-2 border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 rounded p-2 text-xs">
                  <Icon className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                  <span className="flex-1">{a.message}</span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(a.at).toLocaleString("fr-FR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
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
                  {s.engine && (
                    <Badge variant="outline" className="text-[9px] shrink-0 hidden sm:inline-flex">{s.engine}</Badge>
                  )}
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

// ── Listes personnalisées (blocage / autorisation) ────────────────────────────
type ListEntryType = "domain" | "phone";
type ListKind = "block" | "allow";

interface ListEntry {
  id: number;
  entryType: ListEntryType;
  listKind: ListKind;
  value: string;
  note: string | null;
  createdAt: string;
}

function ListManagerCard() {
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entryType, setEntryType] = useState<ListEntryType>("domain");
  const [listKind, setListKind] = useState<ListKind>("block");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SECURITY_API}/lists`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
      }
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const add = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch(`${SECURITY_API}/lists`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryType, listKind, value: trimmed, note: note.trim() || undefined }),
      });
      if (res.ok) {
        setValue("");
        setNote("");
        await fetchEntries();
        toast({ title: "Ajouté", description: listKind === "block" ? "Élément bloqué." : "Élément autorisé." });
      } else {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Erreur", description: err.error ?? "Ajout impossible.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [entryType, listKind, value, note, fetchEntries, toast]);

  const remove = useCallback(async (id: number) => {
    try {
      const res = await fetch(`${SECURITY_API}/lists/${id}`, { method: "DELETE", credentials: "include" });
      if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id));
      else toast({ title: "Erreur", description: "Suppression impossible.", variant: "destructive" });
    } catch {
      toast({ title: "Erreur réseau", variant: "destructive" });
    }
  }, [toast]);

  const blocked = entries.filter((e) => e.listKind === "block");
  const allowed = entries.filter((e) => e.listKind === "allow");

  const renderEntry = (e: ListEntry) => (
    <div key={e.id} className="flex items-center gap-2 border rounded p-2 text-xs">
      {e.entryType === "domain"
        ? <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        : <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <span className="truncate flex-1 font-mono">{e.value}</span>
      {e.note && <span className="text-muted-foreground truncate max-w-[40%] italic">{e.note}</span>}
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-red-600" onClick={() => remove(e.id)}>
        <Trash2 className="w-3.5 h-3.5" />
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-teal-600" />
          Mes listes personnalisées
        </CardTitle>
        <CardDescription>
          Bloquez ou autorisez vous-même des sites web et des numéros de téléphone.
          Vos règles ont toujours le dernier mot sur l'analyse automatique.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Formulaire d'ajout */}
        <div className="border rounded-lg p-3 space-y-2 bg-muted/20">
          <div className="flex flex-wrap gap-2">
            <div className="flex rounded-md border overflow-hidden">
              <button
                type="button"
                onClick={() => setEntryType("domain")}
                className={`px-3 py-1.5 text-xs font-medium ${entryType === "domain" ? "bg-teal-600 text-white" : "bg-background text-muted-foreground"}`}
              >
                <Globe className="w-3 h-3 inline mr-1" /> Site web
              </button>
              <button
                type="button"
                onClick={() => setEntryType("phone")}
                className={`px-3 py-1.5 text-xs font-medium ${entryType === "phone" ? "bg-teal-600 text-white" : "bg-background text-muted-foreground"}`}
              >
                <Phone className="w-3 h-3 inline mr-1" /> Téléphone
              </button>
            </div>
            <div className="flex rounded-md border overflow-hidden">
              <button
                type="button"
                onClick={() => setListKind("block")}
                className={`px-3 py-1.5 text-xs font-medium ${listKind === "block" ? "bg-red-600 text-white" : "bg-background text-muted-foreground"}`}
              >
                <Ban className="w-3 h-3 inline mr-1" /> Bloquer
              </button>
              <button
                type="button"
                onClick={() => setListKind("allow")}
                className={`px-3 py-1.5 text-xs font-medium ${listKind === "allow" ? "bg-emerald-600 text-white" : "bg-background text-muted-foreground"}`}
              >
                <CheckCircle2 className="w-3 h-3 inline mr-1" /> Autoriser
              </button>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              placeholder={entryType === "domain" ? "exemple.com" : "+33 6 12 34 56 78"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              className="text-sm"
            />
            <Input
              placeholder="Note (facultatif)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") add(); }}
              className="text-sm sm:max-w-[40%]"
            />
            <Button onClick={add} disabled={saving || !value.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4 mr-1" /> Ajouter</>}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold flex items-center gap-1 text-red-600">
                <Ban className="w-3.5 h-3.5" /> Bloqués ({blocked.length})
              </h4>
              {blocked.length === 0
                ? <p className="text-xs text-muted-foreground">Aucun élément bloqué.</p>
                : <div className="space-y-1.5 max-h-56 overflow-y-auto">{blocked.map(renderEntry)}</div>}
            </div>
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="w-3.5 h-3.5" /> Autorisés ({allowed.length})
              </h4>
              {allowed.length === 0
                ? <p className="text-xs text-muted-foreground">Aucun élément autorisé.</p>
                : <div className="space-y-1.5 max-h-56 overflow-y-auto">{allowed.map(renderEntry)}</div>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Réglages : synthèse hebdomadaire de sécurité (opt-in) ─────────────────────
function SecuritySettingsCard() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${SECURITY_API}/settings`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          setEnabled(Boolean(data.weeklySecurityEmail));
        }
      } catch { /* ignore */ } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = useCallback(async (next: boolean) => {
    setSaving(true);
    setEnabled(next);
    try {
      const res = await fetch(`${SECURITY_API}/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklySecurityEmail: next }),
      });
      if (!res.ok) {
        setEnabled(!next);
        toast({ title: "Erreur", description: "Modification impossible.", variant: "destructive" });
      } else {
        toast({
          title: next ? "Synthèse activée" : "Synthèse désactivée",
          description: next
            ? "Vous recevrez un récapitulatif de sécurité chaque semaine par email."
            : "Vous ne recevrez plus la synthèse hebdomadaire.",
        });
      }
    } catch {
      setEnabled(!next);
      toast({ title: "Erreur réseau", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }, [toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="w-5 h-5 text-emerald-600" />
          Synthèse hebdomadaire par email
        </CardTitle>
        <CardDescription>
          Recevez chaque semaine un récapitulatif : score de sécurité, menaces bloquées et recommandations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 border rounded-lg p-3">
          <div className="flex-1">
            <Label htmlFor="weekly-security-email" className="text-sm font-medium">
              Activer la synthèse hebdomadaire
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Envoyée à l'adresse email de votre organisation.
            </p>
          </div>
          <Switch
            id="weekly-security-email"
            checked={enabled}
            disabled={loading || saving}
            onCheckedChange={toggle}
          />
        </div>
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
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [score, setScore] = useState<SecurityScore | null>(null);
  const [scoreLoading, setScoreLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SECURITY_API}/protection-status`, { credentials: "include" });
      if (res.ok) setStatus(await res.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  const fetchScore = useCallback(async () => {
    setScoreLoading(true);
    try {
      const res = await fetch(`${SECURITY_API}/score`, { credentials: "include" });
      if (res.ok) setScore(await res.json());
    } catch { /* ignore */ } finally {
      setScoreLoading(false);
    }
  }, []);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch(`${SECURITY_API}/alerts`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setAlerts(Array.isArray(data.alerts) ? data.alerts : []);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchStatus(); fetchAlerts(); fetchScore(); }, [fetchStatus, fetchAlerts, fetchScore]);

  // Rafraîchissement temps réel : la couche SSE (use-realtime-sync) diffuse un
  // évènement "realtime-sync" pour chaque évènement serveur. On réagit au type
  // "security" pour recharger alertes + statut et notifier l'utilisateur.
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail as { type?: string; meta?: { message?: string } } | undefined;
      if (detail?.type !== "security") return;
      fetchAlerts();
      fetchStatus();
      fetchScore();
      toast({
        title: "Alerte de sécurité",
        description: detail.meta?.message ?? "Une menace dangereuse a été détectée.",
        variant: "destructive",
      });
    };
    window.addEventListener("realtime-sync", onSync);
    return () => window.removeEventListener("realtime-sync", onSync);
  }, [fetchAlerts, fetchStatus, fetchScore, toast]);

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

      <ScorePanelCard score={score} loading={scoreLoading} />

      <ProtectionStatusCard status={status} loading={loading} onRefresh={fetchStatus} />

      <AlertsCard alerts={alerts} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <LinkScannerCard onScanned={fetchStatus} />
        <FileScannerCard onScanned={fetchStatus} />
      </div>

      <TextScannerCard />

      <ListManagerCard />

      <RecentScansCard scans={status?.recentScans ?? []} />

      <SecuritySettingsCard />

      <PartnersCard />
    </div>
  );
}
