import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  Brain, Shield, ShieldAlert, ShieldCheck, AlertTriangle, AlertCircle, Info,
  CheckCircle2, PhoneMissed, UserMinus, UserX, Clock, Star, TrendingDown,
  Timer, Flag, Mail, MailWarning, FileWarning, Repeat, ChevronRight,
  Loader2, RefreshCw, ChevronDown, ChevronUp, Activity, Zap, Eye
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { useRequestAiRecognition, type AiRecognitionResult } from "@workspace/api-client-react";

type RecognitionContextValue = {
  data: AiRecognitionResult | undefined;
  isPending: boolean;
  refresh: () => void;
};

const RecognitionContext = createContext<RecognitionContextValue | null>(null);

export function RecognitionProvider({ children }: { children: ReactNode }) {
  const recognition = useRequestAiRecognition();

  useEffect(() => {
    recognition.mutate({ data: {} });
  }, []);

  return (
    <RecognitionContext.Provider value={{
      data: recognition.data,
      isPending: recognition.isPending,
      refresh: () => recognition.mutate({ data: {} }),
    }}>
      {children}
    </RecognitionContext.Provider>
  );
}

function useRecognition() {
  const ctx = useContext(RecognitionContext);
  if (!ctx) {
    const recognition = useRequestAiRecognition();
    useEffect(() => { recognition.mutate({ data: {} }); }, []);
    return { data: recognition.data, isPending: recognition.isPending, refresh: () => recognition.mutate({ data: {} }) };
  }
  return ctx;
}

const ICON_MAP: Record<string, React.ReactNode> = {
  "phone-missed": <PhoneMissed className="w-4 h-4" />,
  "alert-triangle": <AlertTriangle className="w-4 h-4" />,
  "user-x": <UserX className="w-4 h-4" />,
  "trending-down": <TrendingDown className="w-4 h-4" />,
  "clock": <Clock className="w-4 h-4" />,
  "timer": <Timer className="w-4 h-4" />,
  "repeat": <Repeat className="w-4 h-4" />,
  "alert-circle": <AlertCircle className="w-4 h-4" />,
  "flag": <Flag className="w-4 h-4" />,
  "check-circle": <CheckCircle2 className="w-4 h-4" />,
  "mail-warning": <MailWarning className="w-4 h-4" />,
  "mail": <Mail className="w-4 h-4" />,
  "user-minus": <UserMinus className="w-4 h-4" />,
  "file-warning": <FileWarning className="w-4 h-4" />,
  "star": <Star className="w-4 h-4" />,
};

const SEVERITE_CONFIG: Record<string, { bg: string; text: string; border: string; label: string; dot: string }> = {
  critique: { bg: "bg-red-50 dark:bg-red-950/30", text: "text-red-700 dark:text-red-300", border: "border-red-200 dark:border-red-900/50", label: "Critique", dot: "bg-red-500" },
  alerte: { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-300", border: "border-amber-200 dark:border-amber-900/50", label: "Alerte", dot: "bg-amber-500" },
  attention: { bg: "bg-orange-50 dark:bg-orange-950/20", text: "text-orange-700 dark:text-orange-300", border: "border-orange-200 dark:border-orange-900/50", label: "Attention", dot: "bg-orange-400" },
  info: { bg: "bg-blue-50 dark:bg-blue-950/20", text: "text-blue-700 dark:text-blue-300", border: "border-blue-200 dark:border-blue-900/50", label: "Info", dot: "bg-blue-500" },
  positif: { bg: "bg-emerald-50 dark:bg-emerald-950/20", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-200 dark:border-emerald-900/50", label: "Positif", dot: "bg-emerald-500" },
};

const CATEGORIE_LABELS: Record<string, string> = {
  appels: "Appels",
  contacts: "Contacts",
  taches: "Taches",
  messages: "Messages",
  performance: "Performance",
  reconnaissance: "Reconnaissance",
};

function getScoreColor(score: number) {
  if (score >= 85) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 70) return "text-blue-600 dark:text-blue-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function getScoreProgressColor(score: number) {
  if (score >= 85) return "bg-emerald-500";
  if (score >= 70) return "bg-blue-500";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function getHealthIcon(niveau: string) {
  switch (niveau) {
    case "excellent": return <ShieldCheck className="w-6 h-6 text-emerald-500" />;
    case "bon": return <Shield className="w-6 h-6 text-blue-500" />;
    case "moyen": return <Shield className="w-6 h-6 text-amber-500" />;
    case "critique": return <ShieldAlert className="w-6 h-6 text-red-500" />;
    default: return <Shield className="w-6 h-6" />;
  }
}

function getHealthLabel(niveau: string) {
  switch (niveau) {
    case "excellent": return "Excellent";
    case "bon": return "Bon";
    case "moyen": return "Moyen";
    case "critique": return "Critique";
    default: return niveau;
  }
}

export function AiRecognitionPanel() {
  const recognition = useRecognition();
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeFilter, setActiveFilter] = useState<string>("all");

  const data = recognition.data;

  const filteredDetections = data?.detections?.filter(d =>
    activeFilter === "all" || d.categorie === activeFilter
  ) ?? [];

  const categories = data?.detections
    ? [...new Set(data.detections.map(d => d.categorie))]
    : [];

  if (recognition.isPending) {
    return (
      <Card className="border-purple-200/50 dark:border-purple-800/30 bg-gradient-to-r from-purple-50/50 via-indigo-50/30 to-blue-50/50 dark:from-purple-950/20 dark:via-indigo-950/10 dark:to-blue-950/20">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Brain className="w-6 h-6 text-purple-500" />
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-purple-400 rounded-full animate-ping" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                <span className="text-sm font-medium text-purple-700 dark:text-purple-300">Analyse en cours...</span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Reconnaissance de motifs et detection d'anomalies sur toutes les donnees</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="border-dashed border-purple-300/50 dark:border-purple-700/30">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Brain className="w-5 h-5 text-purple-500" />
            <div>
              <p className="text-sm font-medium">Reconnaissance IA</p>
              <p className="text-xs text-muted-foreground">Analysez votre bureau pour des detections intelligentes</p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={recognition.refresh} className="border-purple-300 text-purple-700 hover:bg-purple-50 dark:border-purple-700 dark:text-purple-300">
            <Eye className="w-4 h-4 mr-1.5" />
            Scanner
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { resume, detections } = data;

  return (
    <Card className="border-purple-200/50 dark:border-purple-800/30 overflow-hidden">
      <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-indigo-900 px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="relative">
              {getHealthIcon(resume.niveauSante)}
              <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${resume.niveauSante === "excellent" ? "bg-emerald-400" : resume.niveauSante === "bon" ? "bg-blue-400" : resume.niveauSante === "moyen" ? "bg-amber-400" : "bg-red-400"}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-white font-semibold text-sm">Reconnaissance IA</h3>
                <Badge variant="outline" className="border-white/20 text-white/80 text-[10px] h-5 px-1.5">
                  {getHealthLabel(resume.niveauSante)}
                </Badge>
              </div>
              <p className="text-white/50 text-[11px] mt-0.5">{resume.totalDetections} detection(s) - Score global de sante</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className={`text-2xl font-bold ${getScoreColor(resume.scoreGlobal)} drop-shadow-lg`} style={{ textShadow: "0 0 20px currentColor" }}>
                  {resume.scoreGlobal}
                </div>
                <div className="text-white/40 text-[10px] uppercase tracking-wider">/ 100</div>
              </div>
              <div className="w-24 h-2 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-1000 ${getScoreProgressColor(resume.scoreGlobal)}`} style={{ width: `${resume.scoreGlobal}%` }} />
              </div>
            </div>

            <div className="flex items-center gap-1.5 border-l border-white/10 pl-4">
              {resume.critiques > 0 && (
                <Badge className="bg-red-500/20 text-red-300 border-red-500/30 text-[10px] h-5 px-1.5">
                  {resume.critiques} critique{resume.critiques > 1 ? "s" : ""}
                </Badge>
              )}
              {resume.alertes > 0 && (
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] h-5 px-1.5">
                  {resume.alertes} alerte{resume.alertes > 1 ? "s" : ""}
                </Badge>
              )}
              {resume.positifs > 0 && (
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] h-5 px-1.5">
                  {resume.positifs} positif{resume.positifs > 1 ? "s" : ""}
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-1 border-l border-white/10 pl-3">
              <Button variant="ghost" size="icon" className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10" onClick={recognition.refresh}>
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-white/60 hover:text-white hover:bg-white/10" onClick={() => setIsExpanded(!isExpanded)}>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {isExpanded && (
        <CardContent className="p-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/30 overflow-x-auto">
            <button
              onClick={() => setActiveFilter("all")}
              className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${activeFilter === "all" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              Tout ({detections.length})
            </button>
            {categories.map(cat => {
              const catCount = detections.filter(d => d.categorie === cat).length;
              const hasCritical = detections.some(d => d.categorie === cat && d.severite === "critique");
              return (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${activeFilter === cat ? "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                >
                  {hasCritical && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />}
                  {CATEGORIE_LABELS[cat] || cat} ({catCount})
                </button>
              );
            })}
          </div>

          <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
            {filteredDetections.map(det => {
              const sev = SEVERITE_CONFIG[det.severite] || SEVERITE_CONFIG.info;
              return (
                <div key={det.id} className={`flex items-center gap-3 px-4 py-3 ${sev.bg} hover:brightness-95 dark:hover:brightness-110 transition-all group`}>
                  <div className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${sev.text} ${sev.border} border bg-white/80 dark:bg-white/5`}>
                    {ICON_MAP[det.icone] || <Activity className="w-4 h-4" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-sm font-semibold ${sev.text}`}>{det.titre}</span>
                      <Badge variant="outline" className={`h-4 px-1 text-[9px] shrink-0 ${sev.border} ${sev.text}`}>
                        {sev.label}
                      </Badge>
                      <Badge variant="outline" className="h-4 px-1 text-[9px] text-muted-foreground shrink-0">
                        {CATEGORIE_LABELS[det.categorie] || det.categorie}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-1">{det.description}</p>
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    <div className={`text-lg font-bold ${sev.text} tabular-nums`}>
                      {det.valeur}
                    </div>
                    {det.lien && (
                      <Link href={det.lien}>
                        <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity">
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}

            {filteredDetections.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Aucune detection dans cette categorie.
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

export function AiHealthBadge() {
  const recognition = useRecognition();

  if (!recognition.data) return null;

  const { resume } = recognition.data;
  const scoreColor = resume.scoreGlobal >= 85 ? "bg-emerald-500" : resume.scoreGlobal >= 70 ? "bg-blue-500" : resume.scoreGlobal >= 50 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-muted/80 border border-border">
      <div className="relative">
        <Brain className="w-4 h-4 text-purple-500" />
        <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${scoreColor} border border-background`} />
      </div>
      <span className="text-xs font-semibold tabular-nums">{resume.scoreGlobal}</span>
      {resume.critiques > 0 && (
        <span className="flex items-center gap-0.5 text-[10px] text-red-600 dark:text-red-400 font-medium">
          <AlertTriangle className="w-3 h-3" />
          {resume.critiques}
        </span>
      )}
    </div>
  );
}
