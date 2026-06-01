import { useState, useEffect, useCallback } from "react";
import {
  Brain, RefreshCw, Loader2, ThumbsUp, ThumbsDown, Phone, Clock,
  ListChecks, Lightbulb, Inbox, TrendingUp, TrendingDown,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

const LEARNING_API = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api/ai-learning";

interface Preference {
  kind: string;
  key: string;
  upCount: number;
  downCount: number;
  score: number;
  updatedAt: string;
}
interface Pattern {
  patternType: string;
  label: string;
  value: string;
  occurrences: number;
  lastSeenAt: string | null;
}
interface Profile {
  preferences: Preference[];
  patterns: Pattern[];
}

const SUGGESTION_LABELS: Record<string, string> = {
  overdue_task: "Tâches en retard",
  missed_call_followup: "Rappels d'appels manqués",
  calendar_conflict: "Conflits d'agenda",
};
const CATEGORY_LABELS: Record<string, string> = {
  calls: "Appels", tasks: "Tâches", finance: "Finance", contacts: "Contacts",
  projets: "Projets", prospects: "Prospects", general: "Général",
};

function prefLabel(p: Preference): string {
  if (p.kind === "suggestion_type") return SUGGESTION_LABELS[p.key] ?? p.key;
  return CATEGORY_LABELS[p.key] ?? p.key;
}

export default function IaApprentissagePage() {
  const { toast } = useToast();
  const [profile, setProfile] = useState<Profile>({ preferences: [], patterns: [] });
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${LEARNING_API}/profile`, { credentials: "include" });
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setProfile({ preferences: data.preferences ?? [], patterns: data.patterns ?? [] });
    } catch {
      toast({ title: "Erreur", description: "Impossible de charger ce que l'IA a appris.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const res = await fetch(`${LEARNING_API}/recompute`, { method: "POST", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        toast({ title: "Patientez", description: data.error ?? "Réessayez dans un instant." });
      } else if (res.status === 403) {
        toast({ title: "Accès refusé", description: "Réservé aux administrateurs.", variant: "destructive" });
      } else if (!res.ok) {
        throw new Error("recompute");
      } else {
        setProfile({ preferences: data.profile?.preferences ?? [], patterns: data.profile?.patterns ?? [] });
        toast({ title: "Mémoire mise à jour", description: "L'IA a réanalysé vos préférences et habitudes." });
      }
    } catch {
      toast({ title: "Erreur", description: "Le recalcul a échoué.", variant: "destructive" });
    } finally {
      setRecomputing(false);
    }
  };

  const liked = profile.preferences.filter((p) => p.score >= 0.34 && p.upCount + p.downCount >= 1);
  const disliked = profile.preferences.filter((p) => p.score <= -0.34 && p.upCount + p.downCount >= 1);
  const callers = profile.patterns.filter((p) => p.patternType === "frequent_caller");
  const hours = profile.patterns.filter((p) => p.patternType === "busy_hour");
  const themes = profile.patterns.filter((p) => p.patternType === "task_theme");

  const isEmpty = !loading && profile.preferences.length === 0 && profile.patterns.length === 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Brain className="h-6 w-6 text-violet-500" />
            Ce que l'IA a appris
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            À partir de vos retours (👍/👎) et de vos habitudes, l'assistant adapte ses réponses à votre organisation.
          </p>
        </div>
        <Button onClick={recompute} disabled={recomputing}>
          {recomputing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Réanalyser
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <Inbox className="h-12 w-12 text-muted-foreground/40" />
            <CardTitle className="text-lg">L'IA n'a encore rien appris</CardTitle>
            <CardDescription className="max-w-md">
              Notez les suggestions de l'assistant proactif (👍/👎) et votez sur les analyses : l'IA mémorisera vos
              préférences et habitudes pour personnaliser ses réponses.
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ThumbsUp className="h-4 w-4 text-emerald-600" /> Préférences apprises
              </CardTitle>
              <CardDescription>Ce que vous appréciez ou souhaitez éviter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {liked.length === 0 && disliked.length === 0 && (
                <p className="text-sm text-muted-foreground">Pas encore assez de retours pour dégager une préférence.</p>
              )}
              {liked.map((p) => (
                <div key={`up-${p.kind}-${p.key}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-emerald-600 shrink-0" /> {prefLabel(p)}
                  </span>
                  <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                    {p.upCount} 👍
                  </Badge>
                </div>
              ))}
              {disliked.map((p) => (
                <div key={`down-${p.kind}-${p.key}`} className="flex items-center justify-between gap-2">
                  <span className="text-sm flex items-center gap-2">
                    <TrendingDown className="h-4 w-4 text-red-600 shrink-0" /> {prefLabel(p)}
                  </span>
                  <Badge className="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
                    {p.downCount} 👎
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" /> Habitudes détectées
              </CardTitle>
              <CardDescription>Motifs récurrents repérés dans votre activité.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {callers.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Phone className="h-3.5 w-3.5" /> Interlocuteurs fréquents
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {callers.slice(0, 6).map((c) => (
                      <Badge key={c.value} variant="outline">{c.label} · {c.occurrences}×</Badge>
                    ))}
                  </div>
                </div>
              )}
              {hours.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <Clock className="h-3.5 w-3.5" /> Heures d'appels les plus chargées
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {hours.map((h) => (
                      <Badge key={h.value} variant="outline">{h.label}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {themes.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
                    <ListChecks className="h-3.5 w-3.5" /> Thèmes de tâches récurrents
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {themes.map((t) => (
                      <Badge key={t.value} variant="outline">{t.label} · {t.occurrences}×</Badge>
                    ))}
                  </div>
                </div>
              )}
              {callers.length === 0 && hours.length === 0 && themes.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucune habitude récurrente détectée pour l'instant.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
